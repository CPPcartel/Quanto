/**
 * Isometric projection.
 *
 * The server thinks in a flat world of (x, z) world-units — unchanged from the
 * 3D build. The renderer maps that onto a classic 2:1 isometric grid, which is
 * what lets a 2D city still read *height*, and height is the whole point here:
 * a building's height is its live share price.
 */

/** 2:1 iso: a tile is twice as wide as it is tall. 64x32 is the classic. */
export const TILE_W = 64;
export const TILE_H = 32;

/** World units per tile. The server world spans +/-190 units. */
export const UNITS_PER_TILE = 4;

/** Pixels of screen rise per world unit of building height. */
export const PIXELS_PER_HEIGHT_UNIT = 5.5;

export interface ScreenPos {
  sx: number;
  sy: number;
}

/**
 * World (x, z) -> screen. `elevation` lifts a point off the ground plane
 * without changing its footprint, which is how towers and floating labels sit
 * above their tile.
 */
export function worldToScreen(x: number, z: number, elevation = 0): ScreenPos {
  const tx = x / UNITS_PER_TILE;
  const tz = z / UNITS_PER_TILE;
  return {
    sx: (tx - tz) * (TILE_W / 2),
    sy: (tx + tz) * (TILE_H / 2) - elevation,
  };
}

/** Inverse of the ground-plane projection; used for click-to-inspect. */
export function screenToWorld(sx: number, sy: number): { x: number; z: number } {
  const tx = sx / TILE_W + sy / TILE_H;
  const tz = sy / TILE_H - sx / TILE_W;
  return { x: tx * UNITS_PER_TILE, z: tz * UNITS_PER_TILE };
}

/**
 * Painter's-algorithm depth key. In an iso scene, things further "back"
 * (smaller x+z) must draw first so nearer things overlap them correctly.
 * Pixi sorts a container's children by `zIndex` when `sortableChildren` is on.
 */
export function depthOf(x: number, z: number): number {
  return x + z;
}

/** Eight-way facing index (0 = south, clockwise) from a yaw in radians. */
export function facingFromYaw(yaw: number): number {
  // Server yaw is atan2(worldX, worldZ); rotate into iso screen space so that
  // "walking right on screen" picks the sprite that faces right.
  const isoYaw = yaw - Math.PI / 4;
  const normalized = ((isoYaw % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  return Math.round(normalized / (Math.PI / 4)) % 8;
}

export function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

export function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}
