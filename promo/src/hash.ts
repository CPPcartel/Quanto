/**
 * Two hashes, on purpose.
 *
 * ---------------------------------------------------------------------------
 * `gameHash` — must stay byte-identical to the game
 *
 * A copy of `hashString` in `client/src/pixi/art.ts`, divisor included. The
 * filler-block layout is derived from it, and the whole claim that this video
 * shows the real city rests on producing the same blocks in the same places.
 * Do not "improve" this one: a better hash here means a different city.
 *
 * ---------------------------------------------------------------------------
 * `mix` — for everything cosmetic
 *
 * Plain FNV-1a has a weakness that bit this project. The final multiply by
 * 16777619 is a 24-bit prime, so the last character of the input mostly moves
 * the LOW bits — and the top bits are what survive the divide into a float.
 * Strings that differ only at the end therefore hash to almost the same number:
 *
 *   hash("sx0") = 0.4033..., hash("sx1") = 0.4059..., hash("sx2") = 0.4085...
 *
 * Twenty-two storm shards seeded that way all landed within 35px of each other,
 * off the bottom of the frame, and the "downpour" rendered as a single shard.
 * The same flaw was quietly flattening tower window patterns and the club crowd,
 * because those seeds also vary at the end (`${id}:${row}:${col}`).
 *
 * `mix` runs an avalanche finaliser so a one-character change scrambles the
 * whole word. Use it for anything that only has to look varied.
 */

/** Byte-for-byte the game's `hashString`. Used where the layout must match. */
export function gameHash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967295;
}

/** FNV-1a plus an avalanche finaliser. Returns 0..1. */
export function mix(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  // MurmurHash3's finaliser — this is the part plain FNV-1a is missing.
  h ^= h >>> 16;
  h = Math.imul(h, 2246822507);
  h ^= h >>> 13;
  h = Math.imul(h, 3266489909);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
