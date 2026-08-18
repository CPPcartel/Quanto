import { Container, Sprite } from "pixi.js";
import { world } from "../net/world";
import { worldToScreen, depthOf, facingFromYaw } from "./iso";
import { characterSet, hashString } from "./art";
import { worldTint } from "./daylight";
import { roadLines, ROAD_HALF, CITY_HALF } from "./plan";

/**
 * NPC pedestrians.
 *
 * An empty street with a dog on it is still an empty street. Crowds are what
 * make the city read as inhabited when few players are online — which, at
 * launch, is most of the time.
 *
 * Three deliberate economies:
 *
 *   No new art. `characterSet()` already returns [direction][frame] textures
 *   and is exactly what real players render from; NPCs take the same rig with a
 *   muted palette.
 *
 *   No pathfinding. They walk the kerbs the city plan already defines, turning
 *   at junctions. `isPavement()` existed and had no callers — this is the job
 *   it was written for.
 *
 *   No server. Like the sky and the animals, this pays nothing and gates
 *   nothing, so spending bandwidth on it at 150 players would be waste.
 *
 * Their starting positions and colours are seeded, so the crowd looks the same
 * on every reload. Their *walk* is not synchronised between clients and is not
 * meant to be — it depends on frame timing, and nothing anywhere depends on two
 * players seeing the same pedestrian on the same corner.
 *
 * ---------------------------------------------------------------------------
 * They must never be mistaken for players.
 *
 * In a multiplayer game that confusion is corrosive — you wave at someone who
 * isn't there, or read the city as busier than it is. So an NPC gets no
 * nameplate, no crew tag, no speech bubble and no emote, ever, and draws from a
 * desaturated palette that shares no colour with the player one. The rule a
 * player can actually use: if there's a name above it, it's a person.
 */

/** Desaturated and deliberately drab. No overlap with the player palette. */
const CROWD_COLORS = [
  "#4A4F5E",
  "#5A5348",
  "#3F4A52",
  "#544A55",
  "#4E5647",
  "#5C5158",
  "#454C5C",
  "#5A5A62",
];

/** Below this zoom a pedestrian is two pixels; stop simulating them. */
const CROWD_LOD = 0.5;

/** Hard ceiling on population, whatever the density curve asks for. */
const MAX_WALKERS = 90;

const WALK_FPS = 7;
const SPEED = 3.4;

/** Pedestrians walk this far from a road centreline — on the pavement. */
const KERB_OFFSET = ROAD_HALF + 2.5;

/** The street grid never changes, so compute it once rather than per frame. */
const ROAD_LINES = roadLines();

interface Walker {
  sprite: Sprite;
  colour: string;
  x: number;
  z: number;
  /** Unit heading in world space; always axis-aligned along the grid. */
  dx: number;
  dz: number;
  /** Where this leg of the walk ends. */
  goalX: number;
  goalZ: number;
  frame: number;
  frameTime: number;
  dir: number;
  /** Active walkers are drawn; the rest are parked offscreen for reuse. */
  live: boolean;
  /** True when the current goal is the map boundary, not a real junction. */
  atEdge: boolean;
}

export class CrowdLayer {
  readonly root = new Container();

  private built = false;
  private walkers: Walker[] = [];
  private lastDayTint = -1;
  /** Recomputed on a slow timer, not per frame. */
  private wanted = 0;
  /**
   * Seeded high so the very first update samples density immediately. Starting
   * at zero left the streets visibly empty for the first two seconds after the
   * city loaded, which read as the crowd failing to appear.
   */
  private sinceDensity = Number.MAX_SAFE_INTEGER;

  constructor() {
    this.root.sortableChildren = true;
    // Pedestrians are scenery: clicks must pass through to the buildings.
    this.root.eventMode = "none";
  }

  build() {
    if (this.built) return;
    this.built = true;

    const rand = seededFrom("crowd");
    for (let i = 0; i < MAX_WALKERS; i++) {
      const colour = CROWD_COLORS[Math.floor(rand() * CROWD_COLORS.length)];
      const sprite = new Sprite(characterSet(colour)[0][0]);
      sprite.anchor.set(0.5, 1);
      sprite.visible = false;
      this.root.addChild(sprite);

      const walker: Walker = {
        sprite,
        colour,
        x: 0,
        z: 0,
        dx: 1,
        dz: 0,
        goalX: 0,
        goalZ: 0,
        frame: 0,
        frameTime: rand(),
        dir: 0,
        live: false,
        atEdge: false,
      };
      this.spawn(walker, rand);
      this.walkers.push(walker);
    }
  }

  /** Put a walker on a random kerb, heading along it. */
  private spawn(w: Walker, rand: () => number) {
    const alongX = rand() < 0.5;
    const line = ROAD_LINES[Math.floor(rand() * ROAD_LINES.length)];
    const side = rand() < 0.5 ? -1 : 1;
    const t = (rand() * 2 - 1) * CITY_HALF;

    if (alongX) {
      // Walking parallel to the X axis, on a kerb of a constant-z road.
      w.x = t;
      w.z = line + KERB_OFFSET * side;
      w.dx = rand() < 0.5 ? 1 : -1;
      w.dz = 0;
    } else {
      w.x = line + KERB_OFFSET * side;
      w.z = t;
      w.dx = 0;
      w.dz = rand() < 0.5 ? 1 : -1;
    }
    this.retarget(w);
  }

  /**
   * Pick the end of this leg: the next junction along the current heading.
   *
   * That is the whole of the "pathfinding" — walk to the crossing, then either
   * carry on or turn onto the crossing street. Nothing here needs to know about
   * obstacles, because the kerbs are laid out so there aren't any.
   *
   * `atEdge` records that the target is the map boundary rather than a real
   * road, because you cannot turn onto a street that isn't there.
   */
  private retarget(w: Walker) {
    const along = w.dx !== 0 ? w.x : w.z;
    const dir = w.dx !== 0 ? w.dx : w.dz;

    let next = dir > 0 ? CITY_HALF : -CITY_HALF;
    let found = false;
    for (const line of ROAD_LINES) {
      if (dir > 0 && line > along + 2 && line < next) {
        next = line;
        found = true;
      }
      if (dir < 0 && line < along - 2 && line > next) {
        next = line;
        found = true;
      }
    }

    w.atEdge = !found;
    if (w.dx !== 0) {
      w.goalX = next;
      w.goalZ = w.z;
    } else {
      w.goalX = w.x;
      w.goalZ = next;
    }
  }

  /**
   * Arrive at the end of a leg and choose the next one.
   *
   * Two things this has to get right, and neither is obvious:
   *
   * **Turning must step onto the new street's kerb.** A walker travelling along
   * X stops at the crossing road's *centreline*; turning there without moving
   * sideways left it walking straight down the middle of the carriageway.
   *
   * **A turn and an edge-reversal must not both apply.** Setting `dx` for the
   * edge after a turn had already set `dz` left both axes non-zero, and the
   * walker set off diagonally across the block.
   */
  private atJunction(w: Walker, rand: () => number) {
    // The boundary is not a junction: there is no cross street to turn onto,
    // so the only option is to go back the way we came.
    if (w.atEdge) {
      w.dx = -w.dx;
      w.dz = -w.dz;
      this.retarget(w);
      return;
    }

    if (rand() < 0.4) {
      const side = rand() < 0.5 ? 1 : -1;
      if (w.dx !== 0) {
        // Turning off an X-run onto the north-south street we just reached.
        // Step across to that street's kerb before heading down it.
        w.x = w.goalX + KERB_OFFSET * side;
        w.dz = side;
        w.dx = 0;
      } else {
        w.z = w.goalZ + KERB_OFFSET * side;
        w.dx = side;
        w.dz = 0;
      }
    }

    this.retarget(w);
  }

  // -------------------------------------------------------------------------

  /**
   * How many pedestrians the city should have right now.
   *
   * Busy while the market is open, thinning after dark, sparse in the small
   * hours. The street being empty at 3am is information, and it costs nothing
   * to express — the numbers it reads from already exist.
   */
  private density(): number {
    const sun = world.daylight?.sun ?? 1;
    const open = world.phase === "open";
    // Daylight sets the baseline; an open market adds the commuters.
    const base = 0.18 + sun * 0.62;
    return Math.round(MAX_WALKERS * Math.min(1, base + (open ? 0.2 : 0)));
  }

  update(dt: number, zoom: number) {
    if (!this.built) return;

    const visible = zoom >= CROWD_LOD;
    this.root.visible = visible;
    if (!visible) return;

    // Density is a slow-moving function of the sun and the market; sampling it
    // every frame would be pure waste.
    this.sinceDensity += dt;
    if (this.sinceDensity > 2) {
      this.sinceDensity = 0;
      this.wanted = this.density();
    }

    const day = worldTint(world.daylight?.sun ?? 1);
    const retint = day !== this.lastDayTint;
    if (retint) this.lastDayTint = day;

    /**
     * Turn decisions use plain randomness.
     *
     * A seeded generator re-created from a per-second key restarted the same
     * sequence every frame, so every walker arriving at a junction inside the
     * same second drew the same first value and turned the same way — the crowd
     * visibly herded. Nothing depends on these being reproducible.
     */
    const rand = Math.random;

    for (let i = 0; i < this.walkers.length; i++) {
      const w = this.walkers[i];
      const shouldBeLive = i < this.wanted;

      if (w.live !== shouldBeLive) {
        w.live = shouldBeLive;
        w.sprite.visible = shouldBeLive;
      }
      if (!shouldBeLive) continue;
      if (retint) w.sprite.tint = day;

      const dx = w.goalX - w.x;
      const dz = w.goalZ - w.z;

      if (Math.abs(dx) + Math.abs(dz) < 0.8) {
        this.atJunction(w, rand);
      } else {
        const len = Math.hypot(dx, dz) || 1;
        w.x += (dx / len) * SPEED * dt;
        w.z += (dz / len) * SPEED * dt;
      }

      w.frameTime += dt;
      if (w.frameTime > 1 / WALK_FPS) {
        w.frameTime = 0;
        w.frame = (w.frame + 1) % 4;
      }

      // Same facing convention as real players: the sheet has eight directions
      // and iso.ts already owns the rotation from world heading into screen
      // space. Rolling a private four-way mapping here would have pointed every
      // pedestrian the wrong way.
      w.dir = facingFromYaw(Math.atan2(w.dx, w.dz));
      const set = characterSet(w.colour);
      w.sprite.texture = set[w.dir][w.frame % set[w.dir].length];

      const { sx, sy } = worldToScreen(w.x, w.z);
      w.sprite.position.set(sx, sy);
      w.sprite.zIndex = depthOf(w.x, w.z);
    }
  }
}

function seededFrom(key: string) {
  let s = Math.floor(hashString(key) * 2147483647) || 12345;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}
