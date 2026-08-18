import { Container, Sprite, Texture } from "pixi.js";
import { worldToScreen, depthOf } from "./iso";
import { worldTint } from "./daylight";
import { world } from "../net/world";
import {
  art,
  makeStreetlight,
  makeTree,
  makeCar,
  makeStreetProp,
  PALETTE,
} from "./art";
import { propSites, carSites, type PropSite } from "./plan";

/**
 * Street furniture: lamps, trees, parked cars, benches, bins, hydrants.
 *
 * This is what turns a grid of towers into somewhere that looks inhabited. All
 * of it is placed deterministically from the city plan, so the same street
 * looks the same every session — players navigate by landmarks, and furniture
 * that moved between visits would undermine that.
 *
 * Everything shares a handful of cached textures and sorts into the same depth
 * order as buildings and characters, so a lamp correctly stands in front of the
 * tower behind it.
 */

/**
 * Below this zoom the objects themselves are sub-pixel noise and go away.
 */
const PROP_LOD = 0.42;

/**
 * The light pools outlive the lamp posts that cast them, though.
 *
 * Pulling back, the street grid picked out in light is the most striking thing
 * in the view — and it costs a few hundred additive sprites, which batch.
 *
 * The cutoff is set by the renderer rather than fixed here, because the zoom
 * floor now depends on window size: a constant that sat safely below the old
 * 0.12 floor would sit *above* the floor on a small window and blank the lights
 * at exactly the zoom where they matter most. See pixi/zoom.ts.
 */
const GLOW_LOD_SEED = 0.2;

export class PropLayer {
  readonly root = new Container();
  /** Light pools sit under everything, on the road surface. */
  readonly glowRoot = new Container();
  /** Last daylight tint written to the static props. */
  private lastDayTint = -1;
  /** Zoom below which light pools are dropped; set from the fitted floor. */
  private glowLod = GLOW_LOD_SEED;
  /**
   * Solid props only — never the additive glow sprites. The lamp bulb lives in
   * `root` alongside the posts, so tinting the container wholesale would dim
   * the bulb at night, which is precisely backwards.
   */
  private solids: Sprite[] = [];

  private built = false;
  private lit: Sprite[] = [];
  private t = 0;

  private texCache = new Map<string, Texture>();

  constructor() {
    this.root.sortableChildren = true;
  }

  private tex(key: string, make: () => Texture): Texture {
    let t = this.texCache.get(key);
    if (!t) {
      t = make();
      this.texCache.set(key, t);
    }
    return t;
  }

  /** Set by the renderer whenever the window — and so the zoom floor — changes. */
  setGlowLod(value: number) {
    this.glowLod = value;
  }

  build() {
    if (this.built) return;
    this.built = true;

    for (const site of propSites()) this.place(site);
    for (const site of carSites()) this.place(site);
  }

  private place(site: PropSite) {
    const { sx, sy } = worldToScreen(site.x, site.z);
    const depth = depthOf(site.x, site.z);

    if (site.kind === "lamp") {
      // The pool of light on the ground, beneath everything.
      const pool = new Sprite(art().glow.amber);
      pool.anchor.set(0.5, 0.5);
      pool.position.set(sx, sy + 2);
      pool.width = 96;
      pool.height = 52;
      pool.blendMode = "add";
      pool.alpha = 0.22;
      this.glowRoot.addChild(pool);
      this.lit.push(pool);

      const lamp = new Sprite(this.tex("lamp", makeStreetlight));
      lamp.anchor.set(0.5, 1);
      lamp.position.set(sx, sy);
      lamp.zIndex = depth;
      this.root.addChild(lamp);
      this.solids.push(lamp);

      // A small bloom right at the bulb.
      const bulb = new Sprite(art().glow.amber);
      bulb.anchor.set(0.5, 0.5);
      bulb.position.set(sx - 5, sy - 35);
      bulb.width = 26;
      bulb.height = 26;
      bulb.blendMode = "add";
      bulb.alpha = 0.55;
      bulb.zIndex = depth + 0.1;
      this.root.addChild(bulb);
      this.lit.push(bulb);
      return;
    }

    if (site.kind === "tree") {
      const variant = Math.floor(site.seed * 4);
      const tree = new Sprite(this.tex(`tree${variant}`, () => makeTree(site.seed)));
      tree.anchor.set(0.5, 1);
      tree.position.set(sx, sy);
      tree.zIndex = depth;
      // Slight scale variation so a row of trees isn't obviously cloned.
      tree.scale.set(0.9 + site.seed * 0.3);
      this.root.addChild(tree);
      this.solids.push(tree);
      return;
    }

    if (site.kind === "car") {
      const variant = Math.floor(site.seed * 6);
      const car = new Sprite(
        this.tex(`car${variant}${site.alongX ? "x" : "z"}`, () =>
          makeCar(site.seed, site.alongX)
        )
      );
      car.anchor.set(0.5, 0.8);
      car.position.set(sx, sy);
      car.zIndex = depth;
      this.root.addChild(car);
      this.solids.push(car);
      return;
    }

    const kind = site.kind as "planter" | "bench" | "bin" | "hydrant";
    const prop = new Sprite(this.tex(kind, () => makeStreetProp(kind)));
    prop.anchor.set(0.5, 1);
    prop.position.set(sx, sy);
    prop.zIndex = depth;
    this.root.addChild(prop);
    this.solids.push(prop);
  }

  /**
   * Lamps rise and fall with the daylight, and carry a faint flicker so the
   * street never looks like a static image.
   *
   * `lamps` is continuous (0 at noon, 1 in the dark) rather than a boolean.
   * A threshold made the whole street grid snap on in a single frame at dusk,
   * which read as a bug; easing across the transition is the entire point of
   * having a smooth curve behind it.
   */
  update(dt: number, zoom: number, lamps: number) {
    /**
     * Solid street furniture takes the daylight tint; the glow pools below do
     * not, because a lamp's light should not dim just because it is night —
     * that is exactly when it matters. Guarded so hundreds of sprites are only
     * touched when the light actually moves.
     */
    const day = worldTint(world.daylight?.sun ?? 1);
    if (day !== this.lastDayTint) {
      this.lastDayTint = day;
      for (const s of this.solids) s.tint = day;
    }

    this.root.visible = zoom >= PROP_LOD;
    this.glowRoot.visible = zoom >= this.glowLod;
    if (!this.glowRoot.visible) return;

    this.t += dt;

    // Never fully off: an unlit lamp at noon still catches light, and dropping
    // the pools to zero makes the road grid vanish when zoomed out.
    const target = 0.55 + 0.45 * Math.max(0, Math.min(1, lamps));
    const flicker = 0.94 + Math.sin(this.t * 2.3) * 0.06;

    /**
     * Pools intensify as you pull back. Individually they're subtle at street
     * level; from above they're the only thing tracing the street grid, so they
     * need to carry more.
     */
    const pull = zoom < PROP_LOD ? 1.9 : 1;

    for (let i = 0; i < this.lit.length; i++) {
      const s = this.lit[i];
      const onGround = s.parent === this.glowRoot;
      const base = onGround ? 0.24 * pull : 0.55;
      s.alpha = base * target * flicker;
    }
  }
}

export { PALETTE };
