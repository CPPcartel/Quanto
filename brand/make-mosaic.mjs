/**
 * Every Resident, in one square.
 *
 * All 3,338 of them, re-rendered from their own published traits rather than
 * decoded from the PNGs on disk — the collection's encoder writes PNGs but does
 * not read them, and re-drawing is both faster and provably the same art.
 *
 * The geometry is the whole problem here, and it is arithmetic rather than
 * taste. Pixel art rescaled at a non-integer ratio turns to mush, so every step
 * from the 32px portrait to the 1500px canvas has to be a clean integer.
 *
 *   32 -> 8    each portrait sampled 4:1, one pixel per 4x4 block
 *   62 x 62    3,844 cells at 8px = 496px, so the field bleeds to the edge
 *   500        canvas, with 2px of slack rather than a visible frame
 *   x3         500 * 3 = 1500 exactly
 *
 * 3,338 does not tile neatly into anything: it factors as 2 x 1669, and 1669 is
 * prime. The grid is therefore larger than the collection and wraps back to the
 * start rather than leaving a ragged hole in the bottom row. Every token appears
 * at least once, which is what "all of them" has to mean, and at eight pixels a
 * face the repeats are invisible.
 *
 *   node brand/make-mosaic.mjs
 */
import { writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Grid, encodePng } from "../collection/src/png.mjs";
import { drawPortrait } from "../collection/src/art.mjs";
import { resolve, TRAIT_SLOTS, TRAIT_NAMES } from "../collection/src/traits.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "out");
const META = join(HERE, "..", "collection", "out", "metadata");

const PORTRAIT = 32;
const CELL = 8; // 32 / 4, an exact 4:1 sample
const COLS = 62;
const ROWS = 62;
const CANVAS = 500;
const SCALE = 3; // 500 * 3 = 1500
const MOSAIC = COLS * CELL; // 464
const MARGIN = Math.floor((CANVAS - MOSAIC) / 2); // 18

const INK = "#11131a";

/** Read one token's trait indices from its published metadata. */
function traitsOf(id) {
  const file = join(META, `${id}.json`);
  if (!existsSync(file)) return null;
  const meta = JSON.parse(readFileSync(file, "utf8"));
  const named = Object.fromEntries(
    (meta.attributes ?? []).map((a) => [String(a.trait_type).toLowerCase(), String(a.value)])
  );
  const indices = {};
  for (const slot of TRAIT_SLOTS) {
    const i = TRAIT_NAMES[slot].indexOf(named[slot]);
    if (i < 0) return null;
    indices[slot] = i;
  }
  return { indices, tier: (named.tier ?? "resident").toLowerCase(), tower: named.tower ?? null };
}

// ---------------------------------------------------------------------------

const ids = [];
for (let id = 1; id <= 4000 && ids.length < 3338; id++) {
  if (existsSync(join(META, `${id}.json`))) ids.push(id);
}
console.log(`found ${ids.length} tokens`);

const canvas = new Grid(CANVAS);
canvas.clear(INK);

let drawn = 0;
for (let cell = 0; cell < COLS * ROWS; cell++) {
  // Wrap past the end so the final row has no gap.
  const id = ids[cell % ids.length];
  const t = traitsOf(id);
  if (!t) continue;

  const portrait = drawPortrait(
    resolve(t.indices),
    t.tier,
    t.tower,
    (0xca11ed + id) >>> 0
  );

  const cx = MARGIN + (cell % COLS) * CELL;
  const cy = MARGIN + Math.floor(cell / COLS) * CELL;

  for (let y = 0; y < CELL; y++) {
    for (let x = 0; x < CELL; x++) {
      /**
       * The centre of each 4x4 block, not its corner.
       *
       * Sampling the corner catches whatever happens to sit on a boundary,
       * which for this art is often an outline — the mosaic came out darker and
       * flatter than the collection actually looks. The centre lands on the
       * body of a shape and keeps each face's real colour.
       */
      const [r, g, b] = portrait.get(
        Math.min(PORTRAIT - 1, x * 4 + 2),
        Math.min(PORTRAIT - 1, y * 4 + 2)
      );
      canvas.set(cx + x, cy + y, `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`);
    }
  }
  drawn++;
}

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, "mosaic.png"), encodePng(canvas, SCALE));

console.log(`mosaic.png  ${CANVAS * SCALE}x${CANVAS * SCALE}`);
console.log(`  ${COLS}x${ROWS} cells, ${drawn} portraits drawn`);
console.log(`  ${ids.length} unique tokens, ${COLS * ROWS - ids.length} repeated to fill the last row`);
