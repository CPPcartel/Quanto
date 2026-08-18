import { Container, Sprite, Texture } from "pixi.js";
import { world, type ParkView } from "../net/world";
import { worldToScreen, depthOf } from "./iso";
import { art, makeTree, makeStreetProp, hashString } from "./art";
import { worldTint } from "./daylight";
import {
  makeParkGround,
  makeRipples,
  makeHedge,
  makeFlowerbed,
  makeFountain,
  makeCascade,
} from "./parkArt";

/**
 * Parks, ponds and the central plaza.
 *
 * Positions come from replicated state and are never recomputed here — the
 * server owns the layout because standing in a park changes CHARGE
 * regeneration. What this file decides is only what *grows* in a lot, seeded
 * from the park's own seed so the same bench is under the same tree on every
 * reload. Players navigate by landmarks, and landmarks that move are not
 * landmarks.
 *
 * Three containers, because they sort differently:
 *   groundRoot — flat surfaces, under everything, unsorted
 *   root       — objects that must interleave with buildings and players
 *   glowRoot   — additive water shimmer, exempt from the daylight tint
 */

/** Below this zoom the contents of a park are sub-pixel; the ground stays. */
const DETAIL_LOD = 0.42;
/** Water animation rate, in frames per second. */
const WATER_FPS = 4;
const WATER_FRAMES = 4;

interface Decor {
  sprite: Sprite;
  /** Additive water sprites keep their brightness at night. */
  lit: boolean;
}

export class ParkLayer {
  readonly groundRoot = new Container();
  readonly root = new Container();
  readonly glowRoot = new Container();

  private built = false;
  private t = 0;
  private frame = -1;
  private lastDayTint = -1;

  /** Solid decorations, tinted by daylight. Water and glow are excluded. */
  private solids: Sprite[] = [];
  /** Ripple overlays, swapped per animation frame. */
  private water: Array<{ sprite: Sprite; half: number; seed: number }> = [];
  /** Animated fountains and the cascade. */
  private jets: Array<{ sprite: Sprite; kind: "fountain" | "cascade" }> = [];

  private texCache = new Map<string, Texture>();

  constructor() {
    this.root.sortableChildren = true;
    this.groundRoot.eventMode = "none";
    this.glowRoot.eventMode = "none";
  }

  get isBuilt() {
    return this.built;
  }

  private tex(key: string, make: () => Texture): Texture {
    let t = this.texCache.get(key);
    if (!t) {
      t = make();
      this.texCache.set(key, t);
    }
    return t;
  }

  build() {
    if (this.built || world.parks.length === 0) return;
    this.built = true;

    for (const park of world.parks) {
      // The Vault has its own layer — it is a venue, not a park.
      if (park.kind === "club") continue;
      this.placeGround(park);
      if (park.kind === "plaza") this.placePlaza(park);
      else this.placeLot(park);
    }
  }

  // -------------------------------------------------------------------------

  private placeGround(park: ParkView) {
    const { sx, sy } = worldToScreen(park.x, park.z);
    const ground = new Sprite(
      this.tex(`g${park.half}${park.kind}${park.seed.toFixed(4)}`, () =>
        makeParkGround(park.half, park.kind, park.seed)
      )
    );
    ground.anchor.set(0.5, 0.5);
    ground.position.set(sx, sy);
    this.groundRoot.addChild(ground);
    this.solids.push(ground);

    if (park.kind === "water" || park.kind === "plaza") {
      const ripple = new Sprite(
        this.tex(`r${park.half}0${park.seed.toFixed(4)}`, () =>
          makeRipples(park.half, 0, park.seed)
        )
      );
      ripple.anchor.set(0.5, 0.5);
      ripple.position.set(sx, sy);
      ripple.blendMode = "add";
      ripple.alpha = 0.5;
      this.glowRoot.addChild(ripple);
      this.water.push({ sprite: ripple, half: park.half, seed: park.seed });
    }
  }

  /**
   * An ordinary park lot: hedges on the corners, trees, a flowerbed or two,
   * and a fountain if the seed says so.
   */
  private placeLot(park: ParkView) {
    const rand = seededFrom(`${park.id}:decor`);
    const inset = park.half - 1.5;

    // Hedges mark the corners so the lot reads as enclosed without walling it
    // off — a full perimeter hid everything inside at street zoom.
    for (const [dx, dz] of [
      [-inset, -inset],
      [inset, -inset],
      [inset, inset],
      [-inset, inset],
    ] as const) {
      this.addSprite(
        park.x + dx,
        park.z + dz,
        this.tex(`hedge${Math.floor(rand() * 4)}`, () => makeHedge(rand())),
        0.5,
        1
      );
    }

    const trees = 2 + Math.floor(rand() * 3);
    for (let i = 0; i < trees; i++) {
      const tx = park.x + (rand() - 0.5) * inset * 1.6;
      const tz = park.z + (rand() - 0.5) * inset * 1.6;
      const variant = Math.floor(rand() * 4);
      this.addSprite(tx, tz, this.tex(`ptree${variant}`, () => makeTree(rand())), 0.5, 1);
    }

    const beds = Math.floor(rand() * 3);
    for (let i = 0; i < beds; i++) {
      const bx = park.x + (rand() - 0.5) * inset * 1.5;
      const bz = park.z + (rand() - 0.5) * inset * 1.5;
      this.addSprite(bx, bz, this.tex(`bed${Math.floor(rand() * 4)}`, () => makeFlowerbed(rand())), 0.5, 1);
    }

    if (rand() < 0.6) {
      const bx = park.x + (rand() - 0.5) * inset;
      const bz = park.z + (rand() - 0.5) * inset;
      this.addSprite(bx, bz, this.tex("pbench", () => makeStreetProp("bench")), 0.5, 1);
    }

    // Green lots get a fountain sometimes; water lots always read as a pond.
    if (park.kind === "green" && rand() < 0.35) {
      const jet = this.addSprite(
        park.x,
        park.z,
        this.tex("fountain0", () => makeFountain(0)),
        0.5,
        1,
        false
      );
      this.jets.push({ sprite: jet, kind: "fountain" });
      this.addGlow(park.x, park.z, 34);
    }
  }

  /** The central plaza: a terraced cascade, ringed with planting. */
  private placePlaza(park: ParkView) {
    const rand = seededFrom("plaza:decor");

    const cascade = this.addSprite(
      0,
      0,
      this.tex("cascade0", () => makeCascade(0)),
      0.5,
      0.75,
      false
    );
    this.jets.push({ sprite: cascade, kind: "cascade" });
    this.addGlow(0, 0, 120);

    // A ring of trees and beds just inside the rim, so the plaza has an edge.
    const ring = park.half - 7;
    for (let i = 0; i < 16; i++) {
      const angle = (i / 16) * Math.PI * 2;
      const x = Math.cos(angle) * ring;
      const z = Math.sin(angle) * ring;
      const tex =
        i % 3 === 0
          ? this.tex(`ptree${i % 4}`, () => makeTree(rand()))
          : this.tex(`bed${i % 4}`, () => makeFlowerbed(rand()));
      this.addSprite(x, z, tex, 0.5, 1);
    }

    for (let i = 0; i < 8; i++) {
      const angle = ((i + 0.5) / 8) * Math.PI * 2;
      this.addSprite(
        Math.cos(angle) * (ring - 6),
        Math.sin(angle) * (ring - 6),
        this.tex("pbench", () => makeStreetProp("bench")),
        0.5,
        1
      );
    }
  }

  /**
   * Place a decoration.
   *
   * `solid` decides whether it takes the daylight tint. Water does not: a
   * fountain that dims at night is just a grey lump, and the point of the neon
   * palette is that lit things stay lit after dark.
   */
  private addSprite(
    x: number,
    z: number,
    texture: Texture,
    ax: number,
    ay: number,
    solid = true
  ): Sprite {
    const { sx, sy } = worldToScreen(x, z);
    const s = new Sprite(texture);
    s.anchor.set(ax, ay);
    s.position.set(sx, sy);
    s.zIndex = depthOf(x, z);
    this.root.addChild(s);
    if (solid) this.solids.push(s);
    return s;
  }

  /** A soft pool of light under water features, so they read after dark. */
  private addGlow(x: number, z: number, size: number) {
    const { sx, sy } = worldToScreen(x, z);
    const glow = new Sprite(art().glow.cyan);
    glow.anchor.set(0.5, 0.5);
    glow.position.set(sx, sy);
    glow.width = size;
    glow.height = size * 0.55;
    glow.blendMode = "add";
    glow.alpha = 0.22;
    this.glowRoot.addChild(glow);
  }

  // -------------------------------------------------------------------------

  update(dt: number, zoom: number) {
    if (!this.built) return;

    // Ground is always drawn — it is what makes a lot read as a park at any
    // zoom. Only the contents drop out when they become sub-pixel.
    const detail = zoom >= DETAIL_LOD;
    this.root.visible = detail;

    const day = worldTint(world.daylight?.sun ?? 1);
    if (day !== this.lastDayTint) {
      this.lastDayTint = day;
      for (const s of this.solids) s.tint = day;
    }

    this.t += dt;
    const frame = Math.floor(this.t * WATER_FPS) % WATER_FRAMES;
    if (frame === this.frame) return;
    this.frame = frame;

    for (const w of this.water) {
      w.sprite.texture = this.tex(`r${w.half}${frame}${w.seed.toFixed(4)}`, () =>
        makeRipples(w.half, frame, w.seed)
      );
    }
    // Jets only animate when you can see them.
    if (!detail) return;
    for (const j of this.jets) {
      j.sprite.texture =
        j.kind === "cascade"
          ? this.tex(`cascade${frame}`, () => makeCascade(frame))
          : this.tex(`fountain${frame}`, () => makeFountain(frame));
    }
  }
}

/** Deterministic per-park randomness, so the same bench sits under the same tree. */
function seededFrom(key: string) {
  let s = Math.floor(hashString(key) * 2147483647) || 12345;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}
