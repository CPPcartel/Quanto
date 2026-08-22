/**
 * $BLOCK — the coin mark.
 *
 * A coin has a face on it. Every real currency in history puts a person on the
 * obverse, and the reason is not decoration: a portrait is the most recognisable
 * shape a human eye can resolve, at any size, from any angle. A skyline is not.
 *
 * The first version put one inside the rim anyway, and it made a fine picture of
 * a city and a weak coin — nothing on it was recognisably THIS project rather
 * than any other crypto product with a chart in a circle. This one strikes an
 * actual Resident into the metal, drawn by the collection's own renderer from a
 * real token's traits. The coin and the collection are then the same object,
 * which is the whole reason for having both.
 *
 * Token #2439 is on it: the AMD penthouse. Chosen for legibility rather than
 * rarity, though it happens to be both. Teal hair against an amber visor is the
 * highest-contrast pairing in the trait set, and it still reads at 48 pixels,
 * which is where a logo is actually judged.
 *
 *   node brand/make-coin.mjs
 */
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Grid, encodePng, mix, shade, tintUp } from "../collection/src/png.mjs";
import { drawPortrait } from "../collection/src/art.mjs";
import { resolve, TRAIT_SLOTS, TRAIT_NAMES } from "../collection/src/traits.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "out");

/**
 * 48, not 32.
 *
 * The portrait is drawn on a fixed 32 grid and has to sit inside a rim without
 * being scaled, because resampling pixel art at a non-integer ratio is the one
 * reliable way to make it look cheap. A 48 grid leaves exactly 8 pixels of rim
 * on every side, which is enough to read as struck metal.
 */
const GRID = 48;
const PORTRAIT = 32;
const OFFSET = (GRID - PORTRAIT) / 2;
const C = (GRID - 1) / 2;

/** From client/src/styles.css, via promo/src/theme.ts. */
const AMBER = "#e5a85c";
const INK = "#11131a";

const dist = (x, y) => Math.hypot(x - C, y - C);

/**
 * The struck-metal look, in one function.
 *
 * A flat disc reads as a sticker. Light landing from the top-left and falling
 * away to the bottom-right is what makes a shape read as metal, and it costs one
 * dot product.
 */
function bevel(x, y, base, strength) {
  const nx = (x - C) / (GRID / 2);
  const ny = (y - C) / (GRID / 2);
  const lit = -(nx * 0.7071 + ny * 0.7071);
  return lit >= 0 ? tintUp(base, lit * strength) : shade(base, -lit * strength * 1.15);
}

/**
 * Which token is struck into the coin.
 *
 * #66 is the NVDA penthouse: the flagship ticker, the first tower in the city,
 * and a low enough id to be worth saying out loud. It carries no accessory,
 * which matters more than it sounds — the halo and antenna float clear of the
 * head, and a circular crop turns them into a stray bar hanging in the sky.
 */
const TOKEN_ID = 66;

/**
 * Read the traits from the token's own metadata rather than transcribing them.
 *
 * Copying six indices by hand is a silent way to end up with a coin that shows a
 * face nobody owns. Reading the published attributes means the mark is provably
 * this token, and it stays right if the collection is ever regenerated.
 */
function traitsOf(id) {
  const file = join(HERE, "..", "collection", "out", "metadata", `${id}.json`);
  const meta = JSON.parse(readFileSync(file, "utf8"));
  const named = Object.fromEntries(
    (meta.attributes ?? []).map((a) => [String(a.trait_type).toLowerCase(), String(a.value)])
  );

  const indices = {};
  for (const slot of TRAIT_SLOTS) {
    const wanted = named[slot];
    const i = TRAIT_NAMES[slot].indexOf(wanted);
    if (i < 0) throw new Error(`token ${id}: unknown ${slot} "${wanted}"`);
    indices[slot] = i;
  }
  return { indices, tower: named.tower ?? "", tier: named.tier ?? "" };
}

const TOKEN = { id: TOKEN_ID, ...traitsOf(TOKEN_ID) };

function drawCoin() {
  const g = new Grid(GRID);

  // The encoder is RGB with no alpha, so the corners take the game's own
  // background. Every surface this lands on looks like that anyway.
  g.clear(INK);

  const R_OUTER = 23.4;
  const R_INNER = 20.6;
  const R_FIELD = 19.7;

  const traits = resolve(TOKEN.indices);
  /**
   * Drawn as a resident, worn by a penthouse.
   *
   * The tier decides two things in the renderer: the backdrop and a frame. The
   * frame is a gold rectangle around the edge of the portrait, which is exactly
   * where this coin already has a rim — two frames fighting for the same
   * millimetre, and the square one loses badly against a circle. Requesting the
   * plain backdrop drops it. The traits are still #2439's, so the face on the
   * coin is genuinely that token's.
   */
  const portrait = drawPortrait(traits, "resident", null, (0xca11ed + TOKEN.id) >>> 0);

  for (let y = 0; y < GRID; y++) {
    for (let x = 0; x < GRID; x++) {
      const d = dist(x, y);
      if (d > R_OUTER) continue;

      if (d > R_INNER) {
        g.set(x, y, bevel(x, y, AMBER, 0.44));
      } else if (d > R_FIELD) {
        // A dark step between rim and portrait, so the two read as separate
        // planes rather than one gradient. Without it the amber bleeds into the
        // artwork and both lose their edge.
        g.set(x, y, bevel(x, y, shade(AMBER, 0.68), 0.25));
      } else {
        const px = x - OFFSET;
        const py = y - OFFSET;
        if (px >= 0 && py >= 0 && px < PORTRAIT && py < PORTRAIT) {
          const [r, gg, b] = portrait.get(px, py);
          const hex = `#${[r, gg, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
          /**
           * Pulled a few percent toward the coin's ground.
           *
           * The portrait was drawn to be looked at on its own at 1024px. Inside
           * a rim at 48 it competes with the metal, and darkening it slightly
           * lets the amber stay the brightest thing on the mark, which is what
           * makes it read as a coin rather than a sticker of a face.
           */
          g.set(x, y, mix(hex, INK, 0.12));
        } else {
          // Inside the field but outside the portrait's square: the corners.
          g.set(x, y, mix(INK, AMBER, 0.1));
        }
      }
    }
  }

  drawSheen(g, R_OUTER, R_INNER);
  return g;
}

/** A highlight on the upper-left rim. Cheap, and it sells the metal. */
function drawSheen(g, rOuter, rInner) {
  for (let y = 0; y < GRID; y++) {
    for (let x = 0; x < GRID; x++) {
      const d = dist(x, y);
      if (d > rOuter || d < rInner) continue;
      const nx = (x - C) / (GRID / 2);
      const ny = (y - C) / (GRID / 2);
      /**
       * A narrow band, not a bright region.
       *
       * Lighting the whole upper-left quadrant made the rim look out of focus.
       * Metal catches light in a line; widening that line reads as blur.
       */
      const lit = -(nx * 0.7071 + ny * 0.7071);
      if (lit > 0.80 && lit < 0.94) g.set(x, y, "#fff3de");
    }
  }
}

// ---------------------------------------------------------------------------

mkdirSync(OUT, { recursive: true });
const coin = drawCoin();

/**
 * Scales are exact multiples of the grid so nearest-neighbour stays crisp. A
 * non-multiple resamples and turns hard pixel edges into mush.
 */
const SIZES = [
  [1152, 24], // OpenSea, token registries
  [960, 20],
  [576, 12], // X avatar; the platform downscales cleanly from here
  [384, 8],
  [192, 4],
  [96, 2], // smallest legible
];

for (const [px, scale] of SIZES) {
  writeFileSync(join(OUT, `block-coin-${px}.png`), encodePng(coin, scale));
}

console.log(`Coin written to ${OUT}`);
console.log(`  Resident #${TOKEN.id} — ${TOKEN.tower} ${TOKEN.tier} — struck into the face`);
console.log("  " + TRAIT_SLOTS.map((s) => `${s}=${TRAIT_NAMES[s][TOKEN.indices[s]]}`).join(" "));
for (const [px] of SIZES) console.log(`  block-coin-${px}.png`);
