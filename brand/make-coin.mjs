/**
 * $BLOCK — the coin mark.
 *
 * Drawn with the collection's own renderer rather than a lookalike, on the same
 * 32x32 grid and out of the same palette. That is the whole point: the coin is
 * not merchandise sitting next to the art, it is a piece of the art. Anyone who
 * has seen a Resident should recognise the hand that drew this.
 *
 * Two decisions carry the design.
 *
 * It is ROUND, and the collection is square. The silhouette has to survive at 48
 * pixels in a timeline where it sits beside a thousand other circles, so the
 * shape does the identifying before any detail is legible. A square coin would
 * read as "another pfp"; a round portrait would read as a mistake.
 *
 * The face is a SKYLINE, not a letter. "The skyline is the chart" is the entire
 * product thesis, so the mark states it rather than initialising it. Five towers
 * at five heights is also, conveniently, a bar chart — which is the joke and the
 * explanation at once.
 *
 *   node brand/make-coin.mjs
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Grid, encodePng, mix, shade, tintUp } from "../collection/src/png.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "out");

const GRID = 32;
const C = (GRID - 1) / 2; // 15.5 — the coin's centre, between pixels

/** Straight from client/src/styles.css, via promo/src/theme.ts. */
const PALETTE = {
  ink: "#11131a",
  inkSoft: "#171a24",
  amber: "#e5a85c",
  violet: "#8d8af2",
  up: "#5fb37e",
  cyan: "#3fc9d6",
};

/** Distance from centre, for circle work. */
const dist = (x, y) => Math.hypot(x - C, y - C);

/**
 * The struck-metal look, in one function.
 *
 * A flat amber disc reads as a sticker. Light landing from the top-left and
 * falling away to the bottom-right is what makes a shape read as *metal*, and it
 * costs one dot product. The face is lit the opposite way — recessed, so it
 * catches light on its lower edge — which is what sells the idea that the middle
 * is stamped into the coin rather than printed on it.
 */
function bevel(x, y, base, strength = 0.34) {
  const nx = (x - C) / (GRID / 2);
  const ny = (y - C) / (GRID / 2);
  // Light from the top-left.
  const lit = -(nx * 0.7071 + ny * 0.7071);
  return lit >= 0
    ? tintUp(base, lit * strength)
    : shade(base, -lit * strength * 1.15);
}

function drawCoin() {
  const g = new Grid(GRID);

  /**
   * Transparent is not available — the encoder is RGB, no alpha. So the corners
   * are the game's own background, which is also what every surface this mark
   * lands on looks like. A PNG with a matching ground beats a PNG with a halo.
   */
  g.clear(PALETTE.ink);

  const R_OUTER = 15.4;
  const R_RIM = 13.5;
  const R_FACE = 12.6;

  // --- the disc, rim first -------------------------------------------------
  for (let y = 0; y < GRID; y++) {
    for (let x = 0; x < GRID; x++) {
      const d = dist(x, y);
      if (d > R_OUTER) continue;

      if (d > R_RIM) {
        // Outer rim: the brightest metal, and the edge that defines the circle.
        g.set(x, y, bevel(x, y, PALETTE.amber, 0.42));
      } else if (d > R_FACE) {
        // A darker step between rim and face, so the two read as planes rather
        // than one gradient.
        g.set(x, y, bevel(x, y, shade(PALETTE.amber, 0.34), 0.3));
      } else {
        // The recessed face. Deep, so the towers have something to glow against.
        g.set(x, y, bevel(x, y, mix(PALETTE.ink, PALETTE.amber, 0.08), -0.22));
      }
    }
  }

  drawSkyline(g, R_FACE);
  drawSheen(g, R_OUTER);
  return g;
}

/**
 * A city, not a face.
 *
 * The first version put four small towers and two sky specks in the middle of a
 * large dark field, and at thumbnail size it read unmistakably as a face — the
 * specks became eyes and the ground line became a mouth. Pareidolia is not a
 * matter of taste; once seen it cannot be unseen, and a logo that reads as a
 * smiley is finished as a logo.
 *
 * The fix is density and width. Towers now span nearly the full chord and are
 * chunky enough to survive 48 pixels, so the eye resolves "skyline" before it
 * can assemble a face. The sky specks are gone for the same reason: any two
 * marks above a horizontal line become eyes.
 *
 * Heights are hand-set and deliberately irregular, peaking right of centre. A
 * symmetrical skyline reads as a crown; an irregular one reads as a city.
 */
function drawSkyline(g, rFace) {
  const GROUND = 27;
  const towers = [
    { x: 5, w: 2, h: 6, tone: 0.55 },
    { x: 7, w: 3, h: 10, tone: 0.9 },
    { x: 10, w: 2, h: 7, tone: 0.4 },
    { x: 12, w: 3, h: 14, tone: 0.75 },
    { x: 15, w: 2, h: 9, tone: 0.5 },
    { x: 17, w: 3, h: 17, hot: true },
    { x: 20, w: 2, h: 11, tone: 0.85 },
    { x: 22, w: 3, h: 8, tone: 0.45 },
    { x: 25, w: 2, h: 5, tone: 0.65 },
  ];

  for (const t of towers) {
    for (let i = 0; i < t.w; i++) {
      for (let j = 0; j < t.h; j++) {
        const x = t.x + i;
        const y = GROUND - j;
        // Clip to the recessed face; a tower crossing the rim breaks the coin.
        if (dist(x, y) > rFace - 0.4) continue;

        const top = j === t.h - 1;
        /**
         * Amber towers on a dark sky, not cool ones. Amber is the game's hero
         * colour and the currency's colour, so the mark should be warm at a
         * glance — a cool coin would belong to a different product.
         */
        /**
         * `tone` varies each tower's brightness. A single amber for every
         * building collapsed into one brown mass; staggering them reads as
         * depth, which is what a skyline actually looks like.
         */
        let colour = t.hot
          ? (top ? "#fff3dd" : mix(PALETTE.amber, "#ffffff", 0.42))
          : mix(shade(PALETTE.amber, 0.52), PALETTE.amber, t.tone ?? 0.6);
        if (!t.hot && top) colour = tintUp(colour, 0.22);

        // Left column catches the light, exactly as the rim does.
        g.set(x, y, i === 0 ? tintUp(colour, 0.1) : colour);
      }
    }
  }

  // Fill everything below the skyline, so the city sits on solid ground rather
  // than floating in the middle of the coin.
  for (let y = GROUND + 1; y < 32; y++) {
    for (let x = 0; x < 32; x++) {
      if (dist(x, y) <= rFace - 0.4) {
        g.set(x, y, mix(PALETTE.ink, PALETTE.amber, 0.42));
      }
    }
  }
}

/** A two-pixel highlight on the upper-left rim. Cheap, and it sells the metal. */
function drawSheen(g, rOuter) {
  const spots = [
    [9, 5],
    [10, 4],
    [12, 3],
    [13, 3],
  ];
  for (const [x, y] of spots) {
    if (dist(x, y) <= rOuter && dist(x, y) > 12.4) {
      g.set(x, y, "#fff1d8");
    }
  }
}

// ---------------------------------------------------------------------------

mkdirSync(OUT, { recursive: true });
const coin = drawCoin();

/**
 * Every size anything actually asks for.
 *
 * Scales are exact multiples of 32 so nearest-neighbour stays crisp — a
 * non-multiple resamples and turns hard pixel edges into mush, which is the one
 * way to make pixel art look cheap.
 */
const SIZES = [
  [1024, 32], // OpenSea / token registries
  [512, 16], // general
  [400, null], // X avatar — see below
  [256, 8],
  [128, 4],
  [64, 2],
];

for (const [px, scale] of SIZES) {
  if (scale === null) continue;
  writeFileSync(join(OUT, `block-coin-${px}.png`), encodePng(coin, scale));
}

console.log(`Coin written to ${OUT}`);
console.log("  block-coin-1024.png   OpenSea, token lists");
console.log("  block-coin-512.png    general purpose");
console.log("  block-coin-256.png    docs, favicons");
console.log("  block-coin-128.png    inline UI");
console.log("  block-coin-64.png     smallest legible size");
