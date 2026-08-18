import { Application, Container } from "pixi.js";
import { AdvancedBloomFilter } from "pixi-filters";
import { world, markUiDirty } from "../net/world";
import { Predictor } from "../net/prediction";
import { sampleInput, camera as camInput, isPressed } from "../net/input";
import { worldToScreen, screenToWorld, clamp, lerp } from "./iso";
import { CityLayer, LOD_ZOOM } from "./City";
import { CITY_HALF } from "./plan";
import { fitZoom, glowLod, ZOOM_MAX } from "./zoom";
import { ActorLayer } from "./Actors";
import { FxLayer, ShardLayer, SignLayer, SkyLayer } from "./Fx";
import { PropLayer } from "./Props";
import { ParkLayer } from "./Parks";
import { CritterLayer } from "./Critters";
import { CrowdLayer } from "./Crowd";
import { art } from "./art";

/**
 * Pixi bootstrap and the main loop.
 *
 * React never re-renders on game state: this loop reads the mutable `world`
 * object directly at 60fps, and React only draws the DOM HUD on a slow
 * coalesced cadence.
 */

/** Street level. The game opens here — you arrive as your character, not as a map. */
const ZOOM_DEFAULT = 1.0;

/**
 * How far the view may be dragged away from the player.
 *
 * Derived from the city's own screen extent rather than picked by eye, and
 * separately per axis: the isometric projection is 2:1, so the city is 6400px
 * wide but only 3200px tall. A single limit generous enough for X let you drag
 * a thousand pixels of empty ground into view vertically.
 *
 * Clamped relative to the player, not absolutely — the limit is "how far you
 * may look from your character", not a wall at the map edge, which would stop
 * you panning at all once you walked near the boundary.
 */
const CITY_CORNERS = [
  worldToScreen(-CITY_HALF, -CITY_HALF),
  worldToScreen(CITY_HALF, -CITY_HALF),
  worldToScreen(CITY_HALF, CITY_HALF),
  worldToScreen(-CITY_HALF, CITY_HALF),
];
const PAN_LIMIT_X =
  (Math.max(...CITY_CORNERS.map((c) => c.sx)) - Math.min(...CITY_CORNERS.map((c) => c.sx))) / 2;
const PAN_LIMIT_Y =
  (Math.max(...CITY_CORNERS.map((c) => c.sy)) - Math.min(...CITY_CORNERS.map((c) => c.sy))) / 2;

export interface GameHandle {
  destroy: () => void;
}

export async function startGame(host: HTMLDivElement): Promise<GameHandle> {
  const app = new Application();

  // If the host hasn't been laid out yet, resizeTo would give us a 0x0 canvas
  // and the screen would simply be black. Fall back to the window.
  const initialW = host.clientWidth || window.innerWidth;
  const initialH = host.clientHeight || window.innerHeight;

  await app.init({
    width: initialW,
    height: initialH,
    resizeTo: host,
    antialias: false,
    backgroundColor: 0x07080f,
    preference: "webgl",
  });
  // Defensive: a remount should never leave two canvases stacked in the host.
  host.replaceChildren();
  host.appendChild(app.canvas);
  world.debug.canvas = `${app.screen.width}x${app.screen.height}`;
  world.debug.fatal = "";

  // Warm the texture cache before the first frame so nothing pops in.
  art();

  /**
   * Layer structure matters for the filter.
   *
   * bloomHost is untransformed and screen-sized, so its filterArea can be
   * app.screen. The camera transform lives on `stage` *inside* it. Applying
   * the filter to the transformed world container instead would make Pixi
   * allocate a framebuffer the size of the whole city (~6700x3400px) — which
   * is what produced a blank screen.
   */
  const bloomHost = new Container();
  const stage = new Container();
  const city = new CityLayer();
  const props = new PropLayer();
  const parks = new ParkLayer();
  const critters = new CritterLayer();
  const crowd = new CrowdLayer();
  const shards = new ShardLayer();
  const signs = new SignLayer();
  const actors = new ActorLayer();

  // Light pools sit on the road under everything; props sort with buildings.
  stage.addChild(
    city.root,
    // Park ground sits on the city's ground plane, under every upright thing.
    parks.groundRoot,
    props.glowRoot,
    parks.glowRoot,
    props.root,
    parks.root,
    // Living things sort with the buildings, like players do.
    crowd.root,
    critters.root,
    shards.root,
    signs.root,
    actors.root
  );
  bloomHost.addChild(stage);

  // Threshold bloom: only pixels brighter than `threshold` glow, so neon and
  // lit windows bleed while dark building bodies stay crisp pixel art.
  const bloom = new AdvancedBloomFilter({
    threshold: 0.5,
    bloomScale: 1.2,
    brightness: 1.0,
    blur: 5,
    quality: 4,
  });

  const fx = new FxLayer();
  const sky = new SkyLayer();

  /**
   * Order matters. The sky is added first so it sits behind the world, and it
   * lives OUTSIDE bloomHost — running a large flat gradient through the bloom
   * filter would bleed the whole screen and defeat the threshold that keeps
   * neon crisp.
   */
  app.stage.addChild(sky.root);
  app.stage.addChild(bloomHost);
  app.stage.addChild(fx.root);

  const predictor = new Predictor();
  let zoom = ZOOM_DEFAULT;
  let camX = 0;
  let camY = 0;

  /**
   * Drag-to-pan.
   *
   * The camera still follows the player; `pan` is an offset laid over that
   * follow rather than a replacement for it. Keeping the two separate means the
   * follow can stay eased (which looks right when walking) while the drag stays
   * exactly 1:1 with the pointer (which is the only thing that feels right when
   * dragging) — easing the drag makes the map feel like it is on elastic.
   *
   * Stored in camera space, so it is divided by zoom on the way in: a 100px
   * drag must move the map 100px whether you are zoomed into a doorway or
   * looking at the whole city.
   */
  let panX = 0;
  let panY = 0;
  let dragging = false;
  let dragPointer = -1;
  let lastDragX = 0;
  let lastDragY = 0;
  /** Total pointer travel this press, used to tell a click from a drag. */
  let dragTravel = 0;
  /** Set by the HUD button; eases the view back onto the player. */
  let recentring = false;
  let initialised = false;
  let bloomOn = false;

  const applyFilterArea = () => {
    // Clip the filter to the viewport rather than the world's bounds.
    bloomHost.filterArea = app.screen.clone();
  };

  const resize = () => {
    fx.resize(app.screen.width, app.screen.height);
    sky.resize(app.screen.width, app.screen.height);

    /**
     * Recompute the zoom floor for the new window, and re-clamp the current
     * zoom into it. Without the re-clamp, shrinking the window would leave the
     * camera below its own new floor — legal to reach, impossible to return to.
     */
    const fit = fitZoom(app.screen.width, app.screen.height);
    camInput.min = fit;
    camInput.max = ZOOM_MAX;
    camInput.zoom = clamp(camInput.zoom, fit, ZOOM_MAX);
    props.setGlowLod(glowLod(fit));
    applyFilterArea();
    world.debug.canvas = `${app.screen.width}x${app.screen.height}`;
  };
  resize();
  const onResize = () => resize();
  window.addEventListener("resize", onResize);

  /**
   * Pointer picking. Screen position is converted back through the camera
   * transform into world space, then matched to the nearest tower.
   */
  const pickFromEvent = (event: PointerEvent): string => {
    if (!city.isBuilt) return "";
    const rect = app.canvas.getBoundingClientRect();
    const localX = (event.clientX - rect.left - stage.position.x) / zoom;
    const localY = (event.clientY - rect.top - stage.position.y) / zoom;
    const { x, z } = screenToWorld(localX, localY);
    return city.pickAt(x, z);
  };

  /**
   * How far the pointer may travel and still count as a click.
   *
   * Without a threshold, selecting a tower and dragging the map are the same
   * gesture, and every drag that happens to start over a building would also
   * open its panel. A few pixels of slack absorbs the shake in an ordinary
   * click without swallowing a deliberate drag.
   */
  const CLICK_SLOP = 5;

  const onPointerMove = (event: PointerEvent) => {
    if (dragging && event.pointerId === dragPointer) {
      const dx = event.clientX - lastDragX;
      const dy = event.clientY - lastDragY;
      lastDragX = event.clientX;
      lastDragY = event.clientY;
      dragTravel += Math.abs(dx) + Math.abs(dy);

      // Divided by zoom so the map tracks the cursor exactly at any scale.
      panX -= dx / zoom;
      panY -= dy / zoom;
      world.panned = panX !== 0 || panY !== 0;
      return;
    }

    world.hovered = pickFromEvent(event);
    app.canvas.style.cursor = world.hovered ? "pointer" : "grab";
  };

  const onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0) return;
    dragging = true;
    dragPointer = event.pointerId;
    lastDragX = event.clientX;
    lastDragY = event.clientY;
    dragTravel = 0;
    // Capture so a drag that leaves the canvas — or the window — still tracks,
    // and still ends properly instead of leaving the map stuck to the cursor.
    app.canvas.setPointerCapture(event.pointerId);
    app.canvas.style.cursor = "grabbing";
  };

  const onPointerUp = (event: PointerEvent) => {
    if (!dragging || event.pointerId !== dragPointer) return;
    dragging = false;
    dragPointer = -1;
    if (app.canvas.hasPointerCapture(event.pointerId)) {
      app.canvas.releasePointerCapture(event.pointerId);
    }

    // Only a press that barely moved is a click. Selection happens here rather
    // than on pointerdown precisely because we cannot know which gesture it was
    // until the pointer comes back up.
    if (dragTravel <= CLICK_SLOP) {
      const hit = pickFromEvent(event);
      // Clicking the same tower again closes it; clicking empty ground clears.
      world.selected = hit && hit !== world.selected ? hit : "";
      markUiDirty();
    }

    world.hovered = pickFromEvent(event);
    app.canvas.style.cursor = world.hovered ? "pointer" : "grab";
  };

  app.canvas.addEventListener("pointermove", onPointerMove);
  app.canvas.addEventListener("pointerdown", onPointerDown);
  app.canvas.addEventListener("pointerup", onPointerUp);
  // A cancelled pointer (browser gesture, device switch) must not leave the
  // map welded to the cursor.
  app.canvas.addEventListener("pointercancel", onPointerUp);
  app.canvas.style.cursor = "grab";

  app.ticker.add((ticker) => {
    // Recorded first: if a later stage throws, a non-zero fps still proves the
    // loop itself is alive and isolates the fault to the frame body.
    world.debug.fps = Math.round(ticker.FPS);

    const dt = Math.min(ticker.deltaMS / 1000, 0.1);

    // ---- simulation ------------------------------------------------------
    if (world.conn === "connected") {
      predictor.step(dt, sampleInput);
      predictor.reconcile();
    }

    // ---- build the city once state arrives -------------------------------
    /**
     * Parks must have arrived before the city is built, not merely eventually.
     * `buildFiller` skips lots covered by a park, so building a frame early —
     * while `world.parks` is still empty — would put a block on every park in
     * the city and there is no second pass to take it back.
     */
    if (
      !city.isBuilt &&
      world.tickers.size > 0 &&
      world.districts.length > 0 &&
      world.parks.length > 0
    ) {
      try {
        city.build();
        props.build();
        parks.build();
        critters.build();
        crowd.build();
        const p = worldToScreen(world.local.x, world.local.z);
        camX = p.sx;
        camY = p.sy;
        initialised = true;
        world.debug.built = true;
      } catch (err) {
        // Surface it once rather than throwing every frame forever.
        world.debug.fatal = `city.build(): ${(err as Error)?.message ?? err}`;
        console.error("[pixi] city.build() failed", err);
        city.markFailed();
      }
    }

    // ---- camera ----------------------------------------------------------
    zoom = lerp(zoom, clamp(camInput.zoom, camInput.min, camInput.max), Math.min(1, dt * 8));

    const target = worldToScreen(world.local.x, world.local.z);

    /**
     * What the camera centres on, blended between the player and the city.
     *
     * Fitting the zoom to the window is only half of "show me the whole map" —
     * the camera still centres on the player, so from a corner you would fit the
     * city into the window and then look at the empty ground beside it. As the
     * view opens out the target eases to the city centre (which is the screen
     * origin, since worldToScreen(0,0) is 0,0), so zooming all the way out
     * frames the city; zooming back in hands the camera to your character.
     */
    const fit = camInput.min;
    /**
     * The handover completes at street zoom, not at a multiple of the fit.
     * Scaling the range by the fit looks fine at 1080p and breaks on a 4K
     * screen, where the fit is 0.57 and the blend would still be only 63% done
     * at the default zoom — leaving your character sitting off-centre the
     * moment you loaded the game. If the city already fits at street zoom there
     * is nothing to frame, so the camera just follows the player.
     */
    const frame =
      fit >= ZOOM_DEFAULT ? 1 : clamp((zoom - fit) / (ZOOM_DEFAULT - fit), 0, 1);
    const aimX = lerp(0, target.sx, frame);
    const aimY = lerp(0, target.sy, frame);

    const follow = initialised ? Math.min(1, dt * (zoom > 0.6 ? 6 : 2.5)) : 1;
    camX = lerp(camX, aimX, follow);
    camY = lerp(camY, aimY, follow);

    /**
     * Walking pulls the camera back to the player.
     *
     * Without this, panning away and then pressing W walks you off the edge of
     * your own screen — you are moving a character you cannot see. Easing the
     * pan out rather than snapping it keeps the recovery legible, and it only
     * runs when you are not actively dragging so the map never fights the hand
     * holding it.
     */
    const walking =
      isPressed("KeyW") || isPressed("KeyA") || isPressed("KeyS") || isPressed("KeyD") ||
      isPressed("ArrowUp") || isPressed("ArrowLeft") || isPressed("ArrowDown") || isPressed("ArrowRight");

    // The HUD raises a flag rather than calling in, so it needs no handle on
    // the renderer. Consumed here and cleared immediately.
    if (world.recentre) {
      world.recentre = false;
      recentring = true;
    }

    if (!dragging && (walking || recentring)) {
      // An explicit "back to me" press should feel answered, so it returns
      // faster than the gentle drift that walking applies — being yanked back
      // mid-stride is a different, worse feeling.
      const k = Math.min(1, dt * (recentring ? 9 : 3));
      panX = lerp(panX, 0, k);
      panY = lerp(panY, 0, k);
      // Snap the last sliver so `panned` actually reaches false and the HUD
      // affordance disappears instead of lingering on a rounding error.
      if (Math.abs(panX) < 0.5 && Math.abs(panY) < 0.5) {
        panX = 0;
        panY = 0;
        recentring = false;
      }
    }

    /**
     * Keep the view over the city.
     *
     * Clamped against the player's position rather than absolutely, so the
     * limit is "how far you may look from your character", not a hard wall at
     * the map edge — which would otherwise stop you panning at all once you
     * walked near the boundary.
     */
    panX = clamp(panX, -PAN_LIMIT_X, PAN_LIMIT_X);
    panY = clamp(panY, -PAN_LIMIT_Y, PAN_LIMIT_Y);
    world.panned = panX !== 0 || panY !== 0;

    stage.scale.set(zoom);
    stage.position.set(
      app.screen.width / 2 - (camX + panX) * zoom,
      app.screen.height / 2 - (camY + panY) * zoom
    );

    // Bloom only once there is something to bloom, and never in Skyline Mode
    // where it just smears. Filtering an empty container is a no-op at best.
    const wantBloom = city.isBuilt && zoom >= LOD_ZOOM;
    if (wantBloom !== bloomOn) {
      bloomOn = wantBloom;
      bloomHost.filters = wantBloom ? [bloom] : [];
      applyFilterArea();
    }

    // ---- layers ----------------------------------------------------------
    // One bad frame must not kill the loop permanently; report and continue.
    try {
      // Sky first: it publishes world.daylight, which the layers below read.
      sky.update(dt);
      city.update(zoom, dt);
      parks.update(dt, zoom);
      crowd.update(dt, zoom);
      critters.update(dt, zoom);
      // Street lamps follow darkness, not trading hours. Keying them off the
      // market meant a lit city at noon on a Sunday and dark streets at 8pm on
      // a weekday — exactly backwards.
      props.update(dt, zoom, world.daylight?.lamps ?? 1);
      shards.update(dt);
      signs.update(dt, zoom < LOD_ZOOM);
      actors.update(zoom, dt);
      fx.update(dt);
    } catch (err) {
      if (!world.debug.fatal) {
        world.debug.fatal = `frame: ${(err as Error)?.message ?? err}`;
        console.error("[pixi] frame update failed", err);
      }
    }

    world.zoom = zoom;
    world.zoomMin = camInput.min;
  });

  return {
    destroy: () => {
      window.removeEventListener("resize", onResize);
      // Every listener added above must come off here. `pointerup` and
      // `pointercancel` were added with drag-to-pan and missed on the way out,
      // which left two handlers bound to a canvas that no longer exists.
      app.canvas.removeEventListener("pointermove", onPointerMove);
      app.canvas.removeEventListener("pointerdown", onPointerDown);
      app.canvas.removeEventListener("pointerup", onPointerUp);
      app.canvas.removeEventListener("pointercancel", onPointerUp);
      app.destroy(true, { children: true });
    },
  };
}
