/**
 * The city plan — one source of truth, in world space.
 *
 * Previously the ground texture painted its roads on a texture-space period
 * (`row % 8`) while buildings avoided a world-space grid (`x % 52`). The two
 * never lined up, so painted roads ran under buildings and the real gaps
 * between blocks were blank. Everything now derives from the functions here,
 * so streets, buildings and street furniture agree by construction.
 */

/** Distance between road centrelines, in world units. */
export const ROAD_SPACING = 52;
/** Half the carriageway width. Roads are 2x this across. */
export const ROAD_HALF = 9;
/** Pavement each side of the carriageway, where props stand. */
export const KERB = 4;
/** The playfield extends this far from the centre in each direction. */
export const CITY_HALF = 200;

/** Distance from the nearest road centreline on a given axis. */
function offsetFromRoad(v: number): number {
  const m = ((v % ROAD_SPACING) + ROAD_SPACING) % ROAD_SPACING;
  return Math.min(m, ROAD_SPACING - m);
}

export function isRoad(x: number, z: number): boolean {
  return offsetFromRoad(x) <= ROAD_HALF || offsetFromRoad(z) <= ROAD_HALF;
}

/** True on the pavement strip beside a road — where lights and trees go. */
export function isPavement(x: number, z: number): boolean {
  const dx = offsetFromRoad(x);
  const dz = offsetFromRoad(z);
  const onX = dx > ROAD_HALF && dx <= ROAD_HALF + KERB;
  const onZ = dz > ROAD_HALF && dz <= ROAD_HALF + KERB;
  return (onX && dz > ROAD_HALF) || (onZ && dx > ROAD_HALF) || (onX && onZ);
}

/** True where a building may stand: clear of road and pavement. */
export function isBuildable(x: number, z: number): boolean {
  return offsetFromRoad(x) > ROAD_HALF + KERB && offsetFromRoad(z) > ROAD_HALF + KERB;
}

/** Road centrelines across the playfield, for drawing the carriageways. */
export function roadLines(): number[] {
  const lines: number[] = [];
  const first = -Math.floor(CITY_HALF / ROAD_SPACING) * ROAD_SPACING;
  for (let v = first; v <= CITY_HALF; v += ROAD_SPACING) lines.push(v);
  return lines;
}

/** Every crossroads — where crossings are painted. */
export function intersections(): Array<{ x: number; z: number }> {
  const lines = roadLines();
  const out: Array<{ x: number; z: number }> = [];
  for (const x of lines) for (const z of lines) out.push({ x, z });
  return out;
}

// ---------------------------------------------------------------------------
// Street furniture placement
// ---------------------------------------------------------------------------

export type PropKind = "lamp" | "tree" | "car" | "hydrant" | "bench" | "bin" | "planter";

export interface PropSite {
  x: number;
  z: number;
  kind: PropKind;
  /** Stable per-site randomness so the city is identical every session. */
  seed: number;
  /** Which way the object faces, for cars and benches. */
  alongX: boolean;
}

function hash(a: number, b: number): number {
  let h = 2166136261 ^ Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

/**
 * Lay street furniture along both kerbs of every road.
 *
 * Deterministic: the same city every reload, which matters because players
 * navigate by landmarks. Density is deliberately uneven — a perfectly regular
 * spacing reads as a tech demo rather than a place.
 */
export function propSites(): PropSite[] {
  const sites: PropSite[] = [];
  const kerbOffset = ROAD_HALF + 2.5;

  for (const line of roadLines()) {
    // Step along the road, placing on both kerbs. `step` counts positions so
    // lamps can be spaced by index — deriving them from `t` with modular
    // arithmetic silently produced none at all, because t never landed on a
    // multiple of the lamp spacing given this start offset and stride.
    let step = 0;
    for (let t = -CITY_HALF; t <= CITY_HALF; t += 13, step++) {
      // Skip junctions — furniture in the middle of a crossing looks wrong.
      if (offsetFromRoad(t) <= ROAD_HALF + KERB) continue;

      for (const side of [-1, 1]) {
        // Along the Z-axis roads (constant x)
        const ax = line + kerbOffset * side;
        const az = t;
        const s1 = hash(ax * 7, az * 13);
        const kind1 = pickKind(s1, step);
        if (kind1) sites.push({ x: ax, z: az, kind: kind1, seed: s1, alongX: false });

        // Along the X-axis roads (constant z)
        const bx = t;
        const bz = line + kerbOffset * side;
        const s2 = hash(bx * 17, bz * 5);
        const kind2 = pickKind(s2, step);
        if (kind2) sites.push({ x: bx, z: bz, kind: kind2, seed: s2, alongX: true });
      }
    }
  }

  return sites;
}

/**
 * Lamps are regular because they light the street — every other position, so
 * their pools overlap slightly and the pavement is never fully dark. Everything
 * else is scattered so a stretch of kerb doesn't read as a repeating pattern.
 */
function pickKind(seed: number, step: number): PropKind | null {
  if (step % 2 === 0) return "lamp";
  if (seed < 0.34) return "tree";
  if (seed < 0.46) return "planter";
  if (seed < 0.56) return "bench";
  if (seed < 0.64) return "bin";
  if (seed < 0.7) return "hydrant";
  return null;
}

/** Parked cars, in bays along the carriageway edge. */
export function carSites(): PropSite[] {
  const sites: PropSite[] = [];
  const bay = ROAD_HALF - 2.5;

  for (const line of roadLines()) {
    for (let t = -CITY_HALF; t <= CITY_HALF; t += 11) {
      if (offsetFromRoad(t) <= ROAD_HALF + KERB) continue;

      for (const side of [-1, 1]) {
        const sA = hash(line * 31 + t, side * 3);
        if (sA < 0.55) {
          sites.push({ x: line + bay * side, z: t, kind: "car", seed: sA, alongX: false });
        }
        const sB = hash(t, line * 23 + side * 9);
        if (sB < 0.55) {
          sites.push({ x: t, z: line + bay * side, kind: "car", seed: sB, alongX: true });
        }
      }
    }
  }

  return sites;
}
