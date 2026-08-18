import { DISTRICTS, TICKERS, layoutFor } from "./tickers.js";

/**
 * Parks, ponds and the central plaza.
 *
 * The server owns this layout, and the client renders only what is replicated —
 * it never recomputes park positions of its own. That is deliberate. Parks now
 * affect CHARGE regeneration, so the server has to know where they are, and the
 * moment two sides derive the same geometry independently they get a chance to
 * disagree. This project already paid for that lesson once, when the ground
 * texture painted roads on a texture-space period while buildings avoided a
 * world-space grid, and the two silently never lined up.
 *
 * The layout reuses the gaps the city already leaves. `buildFiller()` on the
 * client skips roughly a third of its lots to leave courtyards, and those gaps
 * have always rendered as bare ground. Parks claim about half of them.
 */

/** Distance between road centrelines, in world units. Mirrors the city plan. */
const ROAD_SPACING = 52;
const ROAD_HALF = 9;
const KERB = 4;

/** The filler grid the client walks, so parks land on the same lots. */
const LOT_STEP = 13;
const LOT_RANGE = 190;

/**
 * Radius of the central plaza.
 *
 * The client already refuses to place filler within 40 units of the origin, so
 * the heart of the city is a bare disc today. It becomes the one landmark in
 * the city — the only place a waterfall works without inventing terrain in a
 * flat isometric world.
 */
export const PLAZA_RADIUS = 34;

/** Half-extent of an ordinary park lot, kept inside the lot so it never touches
 *  the pavement. */
const LOT_HALF = 6;

/** Clearance around a hero tower plot, matching the client's filler rule. */
const TOWER_CLEARANCE = 24;

export type ParkKind = "green" | "water" | "plaza";

export interface ParkLot {
  id: string;
  x: number;
  z: number;
  /** Half-extent; parks are square, the plaza is a disc of this radius. */
  half: number;
  kind: ParkKind;
  /** Stable randomness for what grows here. Same city every restart. */
  seed: number;
  /** District this park sits in, so it can borrow the local accent colour. */
  district: string;
}

function hash(a: number, b: number): number {
  let h = 2166136261 ^ Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

/**
 * FNV-1a over "x,z" — byte for byte the client's `hashString`.
 *
 * This has to be the *same* function, not merely a similar one. It decides
 * which lots the client's filler leaves as courtyards, and parks are supposed
 * to take those lots. An independent hash agreed with it only 58% of the time,
 * which meant parks were bulldozing lots that would have had buildings while
 * genuinely empty lots stayed bare — the opposite of "reuse the gaps the city
 * already leaves".
 */
function fillerSeedAt(x: number, z: number): number {
  const s = `${x},${z}`;
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967295;
}

function offsetFromRoad(v: number): number {
  const m = ((v % ROAD_SPACING) + ROAD_SPACING) % ROAD_SPACING;
  return Math.min(m, ROAD_SPACING - m);
}

/** True where a building may stand: clear of both carriageway and pavement. */
function isBuildable(x: number, z: number): boolean {
  return offsetFromRoad(x) > ROAD_HALF + KERB && offsetFromRoad(z) > ROAD_HALF + KERB;
}

function nearestDistrict(x: number, z: number): string {
  let best = DISTRICTS[0]?.id ?? "";
  let bestDist = Infinity;
  for (const d of DISTRICTS) {
    const dist = Math.hypot(d.cx - x, d.cz - z);
    if (dist < bestDist) {
      bestDist = dist;
      best = d.id;
    }
  }
  return best;
}

let cached: ParkLot[] | null = null;

/**
 * Every park in the city, including the central plaza.
 *
 * Computed once and cached: the layout is a pure function of constants, and it
 * is read on every join and on every CHARGE tick.
 */
export function parkLots(): ParkLot[] {
  if (cached) return cached;

  const towers = TICKERS.map((t) => layoutFor(t));
  const lots: ParkLot[] = [];

  // The plaza first, so it is always present regardless of the grid.
  lots.push({
    id: "plaza",
    x: 0,
    z: 0,
    half: PLAZA_RADIUS,
    kind: "plaza",
    seed: 0.5,
    district: "downtown",
  });

  for (let x = -LOT_RANGE; x <= LOT_RANGE; x += LOT_STEP) {
    for (let z = -LOT_RANGE; z <= LOT_RANGE; z += LOT_STEP) {
      if (!isBuildable(x, z)) continue;
      // Inside the plaza, and far enough out not to crowd its edge.
      if (Math.hypot(x, z) < PLAZA_RADIUS + LOT_HALF + 6) continue;

      // Hero tower plots are spoken for.
      let blocked = false;
      for (const t of towers) {
        if (Math.abs(t.x - x) < TOWER_CLEARANCE && Math.abs(t.z - z) < TOWER_CLEARANCE) {
          blocked = true;
          break;
        }
      }
      if (blocked) continue;

      /**
       * Only lots the city was already leaving empty.
       *
       * The client's filler treats `seed < 0.32` as "stay a courtyard", so
       * taking parks from exactly that set costs the skyline nothing: building
       * density is identical with parks and without them. A park takes about
       * half of the courtyards, leaving the rest as the bare lots they were.
       */
      if (fillerSeedAt(x, z) >= 0.32) continue;
      if (hash(x * 19 + 5, z * 23 + 11) >= 0.55) continue;

      const seed = hash(x * 31 + 7, z * 37 + 13);
      lots.push({
        id: `p${x}_${z}`,
        x,
        z,
        half: LOT_HALF,
        // Roughly one park in four has water in it. Enough to be a landmark,
        // rare enough to stay one.
        kind: seed < 0.26 ? "water" : "green",
        seed,
        district: nearestDistrict(x, z),
      });
    }
  }

  cached = lots;
  return lots;
}

/**
 * Is this position inside a park?
 *
 * Squares and one disc, so a plain containment test — no spatial index. It runs
 * per player per accrual tick (a few times a minute), not per frame.
 */
export function parkAt(x: number, z: number): ParkLot | null {
  for (const lot of parkLots()) {
    if (lot.kind === "plaza") {
      if (Math.hypot(x - lot.x, z - lot.z) <= lot.half) return lot;
      continue;
    }
    if (Math.abs(x - lot.x) <= lot.half && Math.abs(z - lot.z) <= lot.half) return lot;
  }
  return null;
}
