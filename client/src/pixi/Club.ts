import { Container, Sprite, Texture } from "pixi.js";
import { world, type ParkView } from "../net/world";
import { worldToScreen, depthOf } from "./iso";
import { art, canvas, toTexture, mix } from "./art";
import { isoFootprint } from "./parkArt";
import { worldTint } from "./daylight";

/**
 * The Vault — the holders-only club.
 *
 * Open-topped on purpose. The world is flat and there is no interior render
 * mode; a roof would mean hiding the only thing worth looking at. An open venue
 * lets the isometric camera see straight in, which is the whole design: a gated
 * space nobody can see is not a perk, it is a private server.
 *
 * Everything that reads from outside — the light spill, the beams, the glow on
 * the street — exists so people who cannot get in know exactly what they are
 * missing. That is the feature.
 */

/** Below this zoom the venue is a lit rectangle; the detail goes away. */
const DETAIL_LOD = 0.42;

/** Dance floor grid, per axis. 12x12 = 144 tiles, measured not guessed. */
const TILES = 12;

/** Beats per second at rest and at full tilt — drives the visual pulse. */
const BPM_CALM = 110;
const BPM_PEAK = 150;

const NEON = {
  up: "#3BFF8F",
  down: "#FF4D5E",
  cyan: "#22E8FF",
  magenta: "#FF2D95",
  amber: "#FFB347",
  violet: "#A855F7",
};

interface Tile {
  sprite: Sprite;
  /** Position in the grid, used for the sweep pattern. */
  gx: number;
  gz: number;
  phase: number;
}

export class ClubLayer {
  /** Floor and spill sit under everything upright. */
  readonly groundRoot = new Container();
  /** Walls, booth, speakers — sorted with buildings and players. */
  readonly root = new Container();
  /** Additive light, exempt from the daylight tint. */
  readonly glowRoot = new Container();

  private built = false;
  private t = 0;
  private beat = 0;
  private lastDayTint = -1;

  private tiles: Tile[] = [];
  private solids: Sprite[] = [];
  private beams: Sprite[] = [];
  private spill: Sprite[] = [];
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
    if (this.built) return;
    const club = world.parks.find((p) => p.kind === "club");
    if (!club) return;
    this.built = true;

    this.buildSpill(club);
    this.buildFloor(club);
    this.buildWalls(club);
    this.buildFixtures(club);
    this.buildBeams(club);
  }

  // -------------------------------------------------------------------------

  /**
   * Light on the street outside.
   *
   * Drawn first and largest, under everything. This is what a player three
   * blocks away sees — the reason they walk over.
   */
  private buildSpill(club: ParkView) {
    const { sx, sy } = worldToScreen(club.x, club.z);
    for (const [size, alpha] of [
      [7.5, 0.16],
      [4.6, 0.2],
      [2.6, 0.26],
    ] as const) {
      const glow = new Sprite(art().glow.magenta);
      glow.anchor.set(0.5, 0.5);
      glow.position.set(sx, sy);
      const foot = isoFootprint(club.half);
      glow.width = foot.width * size * 0.42;
      glow.height = foot.height * size * 0.42;
      glow.blendMode = "add";
      glow.alpha = alpha;
      this.groundRoot.addChild(glow);
      this.spill.push(glow);
    }
  }

  /** The dance floor: a grid of tiles that pulse with the beat and the tape. */
  private buildFloor(club: ParkView) {
    const step = (club.half * 2) / TILES;
    const tile = this.tex("tile", () => makeTile());

    for (let gx = 0; gx < TILES; gx++) {
      for (let gz = 0; gz < TILES; gz++) {
        const wx = club.x - club.half + step * (gx + 0.5);
        const wz = club.z - club.half + step * (gz + 0.5);
        const { sx, sy } = worldToScreen(wx, wz);

        const s = new Sprite(tile);
        s.anchor.set(0.5, 0.5);
        s.position.set(sx, sy);
        s.width = (step / 4) * 64;
        s.height = (step / 4) * 32;
        s.blendMode = "add";
        s.alpha = 0.25;
        this.groundRoot.addChild(s);

        this.tiles.push({
          sprite: s,
          gx,
          gz,
          // Diagonal offset, so the sweep runs across the room rather than
          // every tile firing at once.
          phase: (gx + gz) / (TILES * 2),
        });
      }
    }
  }

  /**
   * A low wall around three sides, with a gap for the door.
   *
   * Low on purpose: tall enough to read as a venue, short enough that
   * nameplates inside carry over it. Being able to see who is in there from the
   * street is the mechanism, so nothing may occlude it.
   */
  private buildWalls(club: ParkView) {
    const h = club.half;
    const wall = this.tex("wall", () => makeWall());

    const runs: Array<[number, number, number, number]> = [
      [club.x - h, club.z - h, club.x + h, club.z - h],
      [club.x - h, club.z - h, club.x - h, club.z + h],
      [club.x + h, club.z - h, club.x + h, club.z + h],
    ];

    for (const [x1, z1, x2, z2] of runs) {
      const steps = Math.ceil(Math.max(Math.abs(x2 - x1), Math.abs(z2 - z1)) / 2);
      for (let i = 0; i <= steps; i++) {
        const t = steps === 0 ? 0 : i / steps;
        const wx = x1 + (x2 - x1) * t;
        const wz = z1 + (z2 - z1) * t;
        this.addSolid(wx, wz, wall, 0.5, 1);
      }
    }

    // The rope: the south side is the entrance, marked rather than walled.
    const rope = this.tex("rope", () => makeRope());
    for (const dx of [-h + 2, -h + 5, h - 5, h - 2]) {
      this.addSolid(club.x + dx, club.z + h, rope, 0.5, 1);
    }
  }

  /** DJ booth, speakers, bar — the things that say "venue" at a glance. */
  private buildFixtures(club: ParkView) {
    const h = club.half;
    const booth = this.tex("booth", () => makeBooth());
    this.addSolid(club.x, club.z - h + 3, booth, 0.5, 1);

    const speaker = this.tex("speaker", () => makeSpeaker());
    this.addSolid(club.x - 7, club.z - h + 3, speaker, 0.5, 1);
    this.addSolid(club.x + 7, club.z - h + 3, speaker, 0.5, 1);

    const bar = this.tex("bar", () => makeBar());
    this.addSolid(club.x - h + 4, club.z + 4, bar, 0.5, 1);

    // Glow behind the booth, so the stage end reads as the loud end.
    const { sx, sy } = worldToScreen(club.x, club.z - h + 3);
    const glow = new Sprite(art().glow.cyan);
    glow.anchor.set(0.5, 0.5);
    glow.position.set(sx, sy - 8);
    glow.width = 190;
    glow.height = 90;
    glow.blendMode = "add";
    glow.alpha = 0.3;
    this.glowRoot.addChild(glow);
  }

  /**
   * Sweeping light shafts above the venue.
   *
   * These are the "something is happening over there" signal, and they are the
   * only part of the club visible above the skyline from a distance.
   */
  private buildBeams(club: ParkView) {
    const { sx, sy } = worldToScreen(club.x, club.z);
    const beam = this.tex("beam", () => makeBeam());
    for (let i = 0; i < 4; i++) {
      const s = new Sprite(beam);
      s.anchor.set(0.5, 1);
      s.position.set(sx, sy - 6);
      s.blendMode = "add";
      s.alpha = 0;
      this.glowRoot.addChild(s);
      this.beams.push(s);
    }
  }

  private addSolid(x: number, z: number, texture: Texture, ax: number, ay: number) {
    const { sx, sy } = worldToScreen(x, z);
    const s = new Sprite(texture);
    s.anchor.set(ax, ay);
    s.position.set(sx, sy);
    s.zIndex = depthOf(x, z);
    this.root.addChild(s);
    this.solids.push(s);
  }

  // -------------------------------------------------------------------------

  update(dt: number, zoom: number) {
    if (!this.built) return;

    const detail = zoom >= DETAIL_LOD;
    this.root.visible = detail;

    /**
     * Intensity and colour come from replicated state — the same numbers the
     * skyline is built from. The room reacts to the real market because it is
     * rendering the real market.
     */
    const intensity = world.clubIntensity || 0.28;
    const bpm = BPM_CALM + (BPM_PEAK - BPM_CALM) * intensity;
    this.t += dt;
    this.beat = (this.beat + dt * (bpm / 60)) % 1;

    // Green tape runs the room green, red runs it red.
    const mood = world.marketMood ?? 0;
    const base = mood >= 0 ? NEON.up : NEON.down;
    const accent = world.stormSymbol ? NEON.magenta : NEON.cyan;

    // Solids take the daylight tint; the neon does not, or the club would go
    // grey at night — which is precisely when it should be loudest.
    const day = worldTint(world.daylight?.sun ?? 1);
    if (day !== this.lastDayTint) {
      this.lastDayTint = day;
      for (const s of this.solids) s.tint = day;
    }

    this.updateFloor(base, accent, intensity, detail);
    this.updateBeams(accent, intensity);
    this.updateSpill(intensity);
  }

  private updateFloor(base: string, accent: string, intensity: number, detail: boolean) {
    for (const tile of this.tiles) {
      // A wave crossing the floor, timed to the beat.
      const wave = (this.beat + tile.phase) % 1;
      const hit = wave < 0.18 ? 1 - wave / 0.18 : 0;

      tile.sprite.alpha = 0.12 + hit * (0.35 + intensity * 0.5);
      // The leading edge takes the accent, the body the tape colour.
      tile.sprite.tint = Number(`0x${(hit > 0.7 ? accent : base).slice(1)}`);
      tile.sprite.visible = detail || hit > 0.4;
    }
  }

  private updateBeams(accent: string, intensity: number) {
    const tintValue = Number(`0x${accent.slice(1)}`);
    this.beams.forEach((s, i) => {
      // Each beam sweeps at its own rate, so they cross rather than march.
      const sweep = this.t * (0.35 + i * 0.11) + i * 1.7;
      s.rotation = Math.sin(sweep) * 0.55;
      s.alpha = (0.1 + intensity * 0.35) * (0.7 + Math.sin(sweep * 3 + i) * 0.3);
      s.tint = tintValue;
      s.scale.set(1, 0.85 + intensity * 0.5);
    });
  }

  private updateSpill(intensity: number) {
    // The pulse on the street is what pulls people over, so it tracks the beat
    // rather than sitting at a constant brightness.
    const pulse = 0.75 + Math.sin(this.beat * Math.PI * 2) * 0.25;
    this.spill.forEach((s, i) => {
      s.alpha = (0.1 + intensity * 0.22) * pulse * (1 - i * 0.18);
    });
  }
}

// ---------------------------------------------------------------------------
// Art. Same canvas-to-texture recipe as the rest of the city.
// ---------------------------------------------------------------------------

function makeTile(): Texture {
  const { c, ctx } = canvas(64, 32);
  // A filled iso diamond; colour comes from the tint at render time.
  ctx.beginPath();
  ctx.moveTo(32, 1);
  ctx.lineTo(63, 16);
  ctx.lineTo(32, 31);
  ctx.lineTo(1, 16);
  ctx.closePath();
  ctx.fillStyle = "#FFFFFF";
  ctx.fill();
  return toTexture(c);
}

function makeWall(): Texture {
  const { c, ctx } = canvas(10, 22);
  ctx.fillStyle = "#171B29";
  ctx.fillRect(0, 6, 10, 16);
  ctx.fillStyle = "#232A42";
  ctx.fillRect(0, 4, 10, 3);
  // A neon strip along the top — the venue's edge, readable from outside.
  ctx.fillStyle = "#FF2D95";
  ctx.fillRect(0, 3, 10, 1);
  return toTexture(c);
}

function makeRope(): Texture {
  const { c, ctx } = canvas(8, 16);
  ctx.fillStyle = "#2A3150";
  ctx.fillRect(3, 5, 2, 11);
  ctx.fillStyle = "#FFD166";
  ctx.fillRect(2, 3, 4, 3);
  ctx.fillStyle = "#8A1B45";
  ctx.fillRect(0, 7, 8, 2);
  return toTexture(c);
}

function makeBooth(): Texture {
  const { c, ctx } = canvas(40, 28);
  ctx.fillStyle = "#12151F";
  ctx.fillRect(2, 10, 36, 18);
  ctx.fillStyle = "#1D2136";
  ctx.fillRect(2, 8, 36, 3);
  // Deck lights.
  ctx.fillStyle = "#22E8FF";
  for (let x = 6; x < 34; x += 5) ctx.fillRect(x, 12, 2, 2);
  ctx.fillStyle = "#FF2D95";
  ctx.fillRect(4, 16, 32, 1);
  return toTexture(c);
}

function makeSpeaker(): Texture {
  const { c, ctx } = canvas(14, 30);
  ctx.fillStyle = "#0D0F1A";
  ctx.fillRect(1, 4, 12, 26);
  ctx.fillStyle = "#1B2033";
  ctx.fillRect(2, 6, 10, 10);
  ctx.fillRect(2, 18, 10, 8);
  ctx.fillStyle = "#2A3150";
  ctx.fillRect(4, 8, 6, 6);
  return toTexture(c);
}

function makeBar(): Texture {
  const { c, ctx } = canvas(30, 22);
  ctx.fillStyle = "#171B29";
  ctx.fillRect(1, 8, 28, 14);
  ctx.fillStyle = "#FFB347";
  ctx.fillRect(1, 6, 28, 2);
  // Bottles.
  for (let i = 0; i < 5; i++) {
    ctx.fillStyle = i % 2 ? "#3BFF8F" : "#22E8FF";
    ctx.fillRect(4 + i * 5, 2, 2, 4);
  }
  return toTexture(c);
}

function makeBeam(): Texture {
  const { c, ctx } = canvas(26, 150);
  // A soft cone, widest at the top, fading upward.
  for (let y = 0; y < 150; y++) {
    const t = y / 150;
    const w = 2 + (1 - t) * 22;
    ctx.fillStyle = mix("#FFFFFF", "#000000", 0.15 + t * 0.8);
    ctx.fillRect(13 - w / 2, y, w, 1);
  }
  return toTexture(c);
}
