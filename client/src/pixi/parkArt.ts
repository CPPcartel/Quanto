import { Texture } from "pixi.js";
import { TILE_W, TILE_H, UNITS_PER_TILE } from "./iso";
import { canvas, toTexture, seeded, mix, PALETTE } from "./art";

/**
 * Parks, water and wildlife.
 *
 * Same recipe as the rest of the art — blocky pixels onto a 2D canvas, handed
 * to Pixi as a nearest-neighbour texture — but kept in its own module because
 * `art.ts` was already 700 lines before any of this existed.
 *
 * Footprints are derived from world units rather than chosen by eye, so a
 * park's diamond on screen is exactly the rectangle the server tests the player
 * against. The picture and the rule are the same shape, which is the only way
 * "stand in the park to rest" can be honest.
 */

/** Park greens, dark to light. Cooler than street trees so they read apart. */
const GRASS = ["#16351F", "#1B4227", "#215030", "#27603A"];
const WATER = ["#0E2A44", "#12395C", "#175075", "#1E6A96"];
const STONE = ["#20263A", "#272E46", "#2E3654", "#39426A"];

/** Bright water highlights, used additively so they survive the night tint. */
export const WATER_LIT = "#6FD2FF";
export const WATER_FOAM = "#A9E8FF";

/**
 * Screen size of a world-space square with the given half-extent.
 *
 * An axis-aligned world square projects to a diamond: one world unit is a
 * quarter of a tile, so the diamond is `half/2 * TILE_W` across and
 * `half/2 * TILE_H` tall.
 */
export function isoFootprint(half: number): { width: number; height: number } {
  return {
    width: (half / UNITS_PER_TILE) * TILE_W * 2,
    height: (half / UNITS_PER_TILE) * TILE_H * 2,
  };
}

/** Trace an iso diamond centred in a canvas of the given size. */
function diamondPath(ctx: CanvasRenderingContext2D, w: number, h: number, inset = 0) {
  const cx = w / 2;
  const cy = h / 2;
  ctx.beginPath();
  ctx.moveTo(cx, inset);
  ctx.lineTo(w - inset, cy);
  ctx.lineTo(cx, h - inset);
  ctx.lineTo(inset, cy);
  ctx.closePath();
}

/**
 * The ground of a park, pond or plaza: one diamond sprite per lot.
 *
 * A single texture rather than tiled cells — a park is small and static, so one
 * sprite is one draw call, and there are only a few dozen in the city.
 */
export function makeParkGround(half: number, kind: string, seed: number): Texture {
  const { width, height } = isoFootprint(half);
  const { c, ctx } = canvas(width, height);
  const rand = seeded(seed || 0.5);
  const ramp = kind === "water" ? WATER : kind === "plaza" ? STONE : GRASS;

  ctx.fillStyle = ramp[1];
  diamondPath(ctx, width, height);
  ctx.fill();

  // Mottling. A flat fill at this size reads as a sticker rather than ground.
  ctx.save();
  diamondPath(ctx, width, height);
  ctx.clip();
  const patches = Math.round((width * height) / 900);
  for (let i = 0; i < patches; i++) {
    ctx.fillStyle = ramp[Math.floor(rand() * ramp.length)];
    ctx.fillRect(
      Math.floor(rand() * width),
      Math.floor(rand() * height),
      4 + Math.floor(rand() * 10),
      2
    );
  }
  ctx.restore();

  // A pale rim just inside the edge, so the lot reads as a kerbed plot.
  ctx.strokeStyle = kind === "water" ? STONE[3] : ramp[3];
  ctx.lineWidth = 2;
  diamondPath(ctx, width, height, 2);
  ctx.stroke();

  return toTexture(c);
}

/**
 * Animated ripple overlay for ponds and the plaza.
 *
 * Separate from the ground so the ripples can cycle without redrawing the lot,
 * and so the highlight can blend additively while the ground beneath still
 * takes the daylight tint.
 */
export function makeRipples(half: number, frame: number, seed: number): Texture {
  const { width, height } = isoFootprint(half);
  const { c, ctx } = canvas(width, height);
  const rand = seeded((seed || 0.5) + frame * 0.137);

  ctx.save();
  diamondPath(ctx, width, height);
  ctx.clip();
  const lines = Math.max(3, Math.round(width / 26));
  for (let i = 0; i < lines; i++) {
    ctx.fillStyle = i % 2 ? WATER_LIT : WATER_FOAM;
    ctx.globalAlpha = 0.3 + rand() * 0.3;
    ctx.fillRect(
      Math.floor(rand() * width * 0.75),
      Math.floor(rand() * height),
      6 + Math.floor(rand() * 18),
      1
    );
  }
  ctx.restore();
  return toTexture(c);
}

/** A clipped hedge, used to edge park lots. */
export function makeHedge(seed: number): Texture {
  const { c, ctx } = canvas(18, 16);
  const rand = seeded(seed || 0.3);
  ctx.fillStyle = "#122C1B";
  ctx.fillRect(1, 7, 16, 8);
  ctx.fillStyle = "#1B4227";
  ctx.fillRect(1, 5, 16, 5);
  for (let i = 0; i < 10; i++) {
    ctx.fillStyle = rand() > 0.5 ? "#215030" : "#27603A";
    ctx.fillRect(2 + Math.floor(rand() * 14), 4 + Math.floor(rand() * 6), 2, 2);
  }
  return toTexture(c);
}

/** A bed of flowers — the only saturated colour at ground level. */
export function makeFlowerbed(seed: number): Texture {
  const { c, ctx } = canvas(20, 14);
  const rand = seeded(seed || 0.7);
  const blooms = ["#FF6B9D", "#FFD166", "#C77DFF", "#FF8C42", "#7BE0AD"];

  ctx.fillStyle = "#2A2418";
  ctx.fillRect(2, 7, 16, 5);
  ctx.fillStyle = "#1B4227";
  ctx.fillRect(2, 5, 16, 4);
  for (let i = 0; i < 14; i++) {
    ctx.fillStyle = blooms[Math.floor(rand() * blooms.length)];
    ctx.fillRect(3 + Math.floor(rand() * 14), 4 + Math.floor(rand() * 6), 2, 2);
  }
  return toTexture(c);
}

/** A fountain. Four frames of jet, for the centre of larger parks. */
export function makeFountain(frame: number): Texture {
  const { c, ctx } = canvas(34, 42);

  ctx.fillStyle = STONE[1];
  ctx.fillRect(4, 28, 26, 8);
  ctx.fillStyle = WATER[2];
  ctx.fillRect(6, 29, 22, 5);
  ctx.fillStyle = STONE[3];
  ctx.fillRect(4, 27, 26, 2);

  ctx.fillStyle = STONE[2];
  ctx.fillRect(14, 18, 6, 11);

  // The jet rises and falls across the frames.
  const lift = [0, 3, 5, 3][frame % 4];
  ctx.fillStyle = WATER_FOAM;
  ctx.fillRect(16, 12 - lift, 2, 8 + lift);
  ctx.fillStyle = WATER_LIT;
  for (let i = 0; i < 5; i++) {
    const spread = 3 + i * 2;
    const y = 14 - lift + i * 3;
    ctx.fillRect(17 - spread, y, 2, 2);
    ctx.fillRect(15 + spread, y, 2, 2);
  }
  return toTexture(c);
}

/**
 * The plaza cascade — the city's one waterfall.
 *
 * A flat isometric city has no terrain to fall down, so the water falls off a
 * terraced stone plinth instead. That is the honest way to get a waterfall here
 * without inventing hills the rest of the map does not have.
 */
export function makeCascade(frame: number): Texture {
  const { c, ctx } = canvas(112, 104);

  const steps = [
    { x: 32, y: 18, w: 48, h: 10 },
    { x: 20, y: 36, w: 72, h: 11 },
    { x: 8, y: 56, w: 96, h: 12 },
  ];
  for (const s of steps) {
    ctx.fillStyle = STONE[1];
    ctx.fillRect(s.x, s.y, s.w, s.h);
    ctx.fillStyle = STONE[3];
    ctx.fillRect(s.x, s.y, s.w, 2);
    ctx.fillStyle = WATER[2];
    ctx.fillRect(s.x + 3, s.y + 2, s.w - 6, 3);
  }

  // Falling sheets between terraces, offset per frame so the water flows.
  const off = (frame % 4) * 2;
  ctx.fillStyle = WATER_LIT;
  for (const [x, y, w] of [
    [36, 28, 40],
    [24, 47, 64],
  ] as const) {
    for (let i = 0; i < w; i += 5) ctx.fillRect(x + i, y + ((i + off) % 6), 3, 6);
  }
  ctx.fillStyle = WATER_FOAM;
  for (let i = 0; i < 96; i += 7) ctx.fillRect(8 + i, 68 + ((i + off) % 4), 3, 2);

  return toTexture(c);
}

/** A dog. Four frames: two of trot, two of pause. */
export function makeDog(seed: number, frame: number): Texture {
  const { c, ctx } = canvas(17, 15);
  const rand = seeded(seed || 0.42);
  const coats = ["#8A6A45", "#5E4A38", "#C2A278", "#3A3A42", "#A8703C"];
  const coat = coats[Math.floor(rand() * coats.length)];

  const bob = frame % 2;
  ctx.fillStyle = coat;
  ctx.fillRect(3, 6 + bob, 9, 4);
  ctx.fillRect(11, 4 + bob, 4, 4);
  ctx.fillRect(1, 5 + bob, 3, 2);

  // Legs alternate so a trot reads even at this size.
  ctx.fillStyle = mix(coat, "#000000", 0.25);
  const stride = frame < 2 ? 0 : 1;
  ctx.fillRect(4, 10 + bob, 2, 3 - stride);
  ctx.fillRect(9, 10 + bob, 2, 2 + stride);

  ctx.fillStyle = mix(coat, "#000000", 0.4);
  ctx.fillRect(11, 3 + bob, 2, 2);
  ctx.fillStyle = "#12141C";
  ctx.fillRect(13, 5 + bob, 1, 1);
  return toTexture(c);
}

/** A cat, sitting. Cats do not need frames. */
export function makeCat(seed: number): Texture {
  const { c, ctx } = canvas(12, 14);
  const rand = seeded(seed || 0.61);
  const coats = ["#3A3A42", "#8A7A5E", "#C9C4BA", "#5A4438"];
  const coat = coats[Math.floor(rand() * coats.length)];

  ctx.fillStyle = coat;
  ctx.fillRect(3, 6, 6, 6);
  ctx.fillRect(4, 2, 5, 5);
  ctx.fillRect(8, 7, 3, 2);
  ctx.fillStyle = mix(coat, "#000000", 0.35);
  ctx.fillRect(4, 1, 2, 2);
  ctx.fillRect(7, 1, 2, 2);
  // Eyes catch the neon, like the trees do.
  ctx.fillStyle = PALETTE.neonLime;
  ctx.fillRect(5, 4, 1, 1);
  ctx.fillRect(7, 4, 1, 1);
  return toTexture(c);
}

/** A bird. Two frames: wings up, wings down. */
export function makeBird(frame: number): Texture {
  const { c, ctx } = canvas(10, 8);
  ctx.fillStyle = "#3E4657";
  ctx.fillRect(4, 3, 3, 2);
  ctx.fillStyle = "#59637A";
  if (frame % 2 === 0) {
    ctx.fillRect(1, 2, 3, 1);
    ctx.fillRect(7, 2, 3, 1);
  } else {
    ctx.fillRect(1, 4, 3, 1);
    ctx.fillRect(7, 4, 3, 1);
  }
  return toTexture(c);
}
