import { Container, Sprite, Graphics, Texture } from "pixi.js";
import { world } from "../net/world";
import { art, PALETTE, makeNeonSign, FLOOR_H } from "./art";
import { lerp, worldToScreen, depthOf } from "./iso";
import { daylight, mixColor } from "./daylight";

/**
 * Atmosphere: rain when the tape is red, fog and colour grade from the market
 * session. Everything here reads live oracle state, so the weather is the
 * actual market rather than a timer.
 */

const DROPS = 500;

interface Drop {
  sprite: Graphics;
  vy: number;
  vx: number;
}

export class FxLayer {
  /** Sits above the world but below the DOM HUD. */
  readonly root = new Container();
  private rain = new Container();
  private drops: Drop[] = [];
  private vignette = new Sprite(Texture.WHITE);
  private grade = new Sprite(Texture.WHITE);
  private width = 0;
  private height = 0;

  constructor() {
    this.grade.alpha = 0;
    this.grade.tint = 0x0a0d1a;

    this.vignette.alpha = 0;

    this.root.addChild(this.grade);
    this.root.addChild(this.rain);

    for (let i = 0; i < DROPS; i++) {
      const g = new Graphics();
      g.rect(0, 0, 1, 7).fill({ color: 0x9fb6d4, alpha: 0.5 });
      g.alpha = 0;
      this.rain.addChild(g);
      this.drops.push({ sprite: g, vy: 700 + Math.random() * 500, vx: -90 });
    }
  }

  resize(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.grade.width = width;
    this.grade.height = height;
    this.drops.forEach((d) => {
      d.sprite.x = Math.random() * width;
      d.sprite.y = Math.random() * height;
    });
  }

  update(dt: number) {
    const closed = world.phase === "closed";

    /**
     * Colour grade: the city dims when the market shuts.
     *
     * Scaled down by daylight rather than added to it. The two effects overlap
     * for most of the year — the market is shut precisely when it's dark — and
     * stacking a full closed-market grade on top of a night sky drove the city
     * to near-black. Night already supplies the darkness; at night this only
     * needs to contribute the *difference*.
     */
    const sun = world.daylight?.sun ?? 1;
    const targetGrade = (closed ? 0.42 : 0.08) * (0.35 + 0.65 * sun);
    this.grade.alpha = lerp(this.grade.alpha, targetGrade, 0.03);

    // Rain scales with how red the broad tape is. Green days stay dry.
    const wetness = Math.max(0, Math.min(1, -world.marketMood / 0.6));
    const active = wetness > 0.02;

    this.rain.visible = active;
    if (!active) return;

    for (const drop of this.drops) {
      drop.sprite.alpha = wetness * 0.55;
      drop.sprite.y += drop.vy * dt;
      drop.sprite.x += drop.vx * dt;
      if (drop.sprite.y > this.height) {
        drop.sprite.y = -10;
        drop.sprite.x = Math.random() * (this.width + 200);
      }
      if (drop.sprite.x < -20) drop.sprite.x = this.width + 20;
    }
  }
}

/**
 * The sky.
 *
 * Screen-space and untransformed on purpose: it must not scale, pan or rotate
 * with the camera, because a sky that slides around as you walk stops reading
 * as a sky. It sits at the very back of the stage, behind the ground plane.
 *
 * Two tinted sprites rather than a gradient repainted each frame: a flat
 * zenith, and a fade over it carrying the horizon colour. Re-baking a gradient
 * to follow the sun would upload a new texture 60 times a second; tinting two
 * fixed sprites costs nothing and is indistinguishable at this scale.
 */
export class SkyLayer {
  readonly root = new Container();
  /** Flat zenith colour behind everything. */
  private zenith = new Sprite(Texture.WHITE);
  /** Transparent at the top, opaque at the bottom — the horizon glow. */
  private horizon: Sprite;
  /** Eased, so a tab left open across sunset fades rather than jumps. */
  private topColor = 0x04050b;
  private bottomColor = 0x0b0f1c;

  constructor() {
    /**
     * A 1×N canvas gradient, white and fading upward, stretched to the screen
     * and tinted with the horizon colour.
     *
     * Built as a canvas texture rather than a Pixi Graphics gradient to match
     * how the rest of the art is made, and because tinting a Sprite is the one
     * path guaranteed to behave identically across renderers. Authored once at
     * a fixed height and scaled — a soft vertical fade loses nothing to
     * stretching, and rebuilding it per resize would re-upload the texture.
     */
    this.horizon = new Sprite(verticalFade(GRADIENT_H));
    this.horizon.anchor.set(0, 0);

    this.root.addChild(this.zenith, this.horizon);
    // The sky is scenery; clicks must reach the buildings behind it.
    this.root.eventMode = "none";
  }

  resize(width: number, height: number) {
    this.zenith.width = width;
    this.zenith.height = height;
    this.horizon.width = width;
    this.horizon.height = height;
  }

  update(dt: number) {
    const sky = daylight(world.serverTime);

    // dt-scaled so the fade runs at the same speed on any frame rate.
    const k = Math.min(1, dt * 1.5);
    this.topColor = mixColor(this.topColor, sky.skyTop, k);
    this.bottomColor = mixColor(this.bottomColor, sky.skyBottom, k);

    this.zenith.tint = this.topColor;
    this.horizon.tint = this.bottomColor;

    // Published for the HUD and for anything else that should know whether it
    // is dark — street lamps, chiefly.
    world.daylight = sky;
  }
}

/** Height the horizon gradient is authored at before scaling. */
const GRADIENT_H = 256;

/** White, transparent at the top and opaque at the bottom. Tinted at use. */
function verticalFade(height: number): Texture {
  const c = document.createElement("canvas");
  c.width = 1;
  c.height = height;
  const ctx = c.getContext("2d")!;
  const grad = ctx.createLinearGradient(0, 0, 0, height);
  grad.addColorStop(0, "rgba(255,255,255,0)");
  grad.addColorStop(1, "rgba(255,255,255,1)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 1, height);
  // Linear, not nearest: this one is a smooth ramp, and nearest-sampling it
  // across a full screen height produces visible banding.
  const tex = Texture.from(c);
  tex.source.scaleMode = "linear";
  return tex;
}

/**
 * Storm shards — the Data Runner pickups. Rendered in world space so they sit
 * among the buildings; spawned and claimed authoritatively by the server.
 */
export class ShardLayer {
  readonly root = new Container();
  private sprites = new Map<string, Sprite>();
  private t = 0;

  update(dt: number) {
    this.t += dt;
    const seen = new Set<string>();

    world.shards.forEach((shard, id) => {
      seen.add(id);
      let s = this.sprites.get(id);
      if (!s) {
        s = new Sprite(art().shard);
        s.anchor.set(0.5, 0.5);
        s.blendMode = "add";
        s.tint = Number(`0x${PALETTE.neonCyan.slice(1)}`);
        this.root.addChild(s);
        this.sprites.set(id, s);
      }
      s.position.set(shard.sx, shard.sy);
      // Bob and pulse so shards read as collectible, not scenery.
      const phase = this.t * 3 + shard.phase;
      s.y += Math.sin(phase) * 3;
      s.scale.set(0.9 + Math.sin(phase * 1.5) * 0.12);
      s.alpha = 0.75 + Math.sin(phase * 2) * 0.2;
    });

    this.sprites.forEach((s, id) => {
      if (seen.has(id)) return;
      s.destroy();
      this.sprites.delete(id);
    });
  }
}

/**
 * Player-crafted neon signs mounted on tower facades.
 *
 * These are the most personal thing in the city — somebody paid shards to hang
 * that — so they get their own additive glow behind the board.
 */
export class SignLayer {
  readonly root = new Container();
  private mounted = new Map<string, Container>();
  private t = 0;

  constructor() {
    this.root.sortableChildren = true;
  }

  update(dt: number, lod: boolean) {
    this.t += dt;
    this.root.visible = !lod;
    if (lod) return;

    const seen = new Set<string>();

    world.signs.forEach((sign, id) => {
      const ticker = world.tickers.get(sign.symbol);
      if (!ticker) return;
      seen.add(id);

      let node = this.mounted.get(id);
      if (!node) {
        node = new Container();

        const glow = new Sprite(art().glow.white);
        glow.anchor.set(0.5, 0.5);
        glow.tint = Number(`0x${sign.color.slice(1)}`);
        glow.blendMode = "add";
        glow.alpha = 0.45;
        glow.width = 48;
        glow.height = 64;

        const board = new Sprite(makeNeonSign(sign.text, sign.color));
        board.anchor.set(0.5, 0.5);

        node.addChild(glow, board);
        this.root.addChild(node);
        this.mounted.set(id, node);
      }

      // Hang off the facade at the sign's floor, just clear of the wall.
      const { sx, sy } = worldToScreen(ticker.x, ticker.z);
      node.position.set(sx + 30, sy - sign.floor * FLOOR_H - 20);
      node.zIndex = depthOf(ticker.x, ticker.z) + 0.5;

      // Slow flicker — neon that never wavers reads as plastic.
      const flicker = 0.86 + Math.sin(this.t * 7 + sign.floor) * 0.06;
      node.alpha = flicker;
    });

    this.mounted.forEach((node, id) => {
      if (seen.has(id)) return;
      node.destroy({ children: true });
      this.mounted.delete(id);
    });
  }
}
