/**
 * Every Resident, as a field.
 *
 * All 3,338 of them, re-rendered from their own published traits rather than
 * decoded from the PNGs on disk — the collection's encoder writes PNGs but does
 * not read them, and re-drawing is both faster and provably the same art.
 *
 * The geometry is arithmetic rather than taste. Pixel art rescaled at a
 * non-integer ratio turns to mush, so every step from the 32px portrait to the
 * final canvas has to be a clean integer, and 32 only divides cleanly by
 * 1, 2, 4, 8, 16 and 32. That constraint decides both layouts below; neither
 * cell size was chosen for looks.
 *
 * SQUARE  1500x1500, 8px sample, 62x62 cells, 24px per face.
 * WIDE    1500x500 for an X header. A band of the square one would only show
 *         about 1,300 faces, so this is its own grid: a 4px sample at 125x42
 *         puts all 3,338 in the header at 12px each, which is the largest a
 *         face can be while every token still fits.
 *
 * 3,338 tiles into nothing — it factors as 2 x 1669, and 1669 is prime — so
 * both grids are deliberately larger than the collection and wrap back to the
 * start rather than leaving a ragged hole in the final row. Every token appears
 * at least once, which is what "all of them" has to mean, and at this size the
 * repeats are invisible.
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
const INK = "#11131a";

const LAYOUTS = [
  {
    name: "mosaic.png",
    cell: 8, // 32 / 4
    cols: 62,
    rows: 62,
    width: 500,
    height: 500,
    scale: 3, // 1500 x 1500
  },
  {
    name: "mosaic-wide.png",
    cell: 4, // 32 / 8
    cols: 125,
    rows: 42,
    width: 500,
    height: 168,
    scale: 3, // 1500 x 504, cropped to 500 by the header that uses it
  },
  {
    /**
     * The header field, and the only layout where a face is genuinely legible.
     *
     * The other two answer "how do we fit them all in", and the answer costs
     * exactly the thing the picture is for: at 24px a Resident is a smudge with
     * a hair colour, and at 12px it is a speck. Nobody looking at either learns
     * that this collection is made of characters.
     *
     * So this one inverts the question. The portrait is used at its native 32px
     * with no downsampling at all, doubled to 64px on the way out, which is the
     * largest a face can be while the field still reads as a crowd rather than
     * as a row of avatars. 192 of them, not 3,338 — a portion, visible, which is
     * worth more than a complete set nobody can see.
     */
    name: "mosaic-faces.png",
    cell: 32, // the whole portrait, untouched
    cols: 24,
    rows: 8,
    width: 768,
    height: 256,
    scale: 2, // 1536 x 512, cropped to 1500 x 500 by the header
    /**
     * Walk the collection in strides rather than taking the first 192.
     *
     * Ids are issued in generation order, so a contiguous run is a slice of one
     * moment in the shuffle and shares more traits than the collection does.
     * A coprime stride visits the whole range and lands on all three tiers.
     */
    stride: 17,
  },
];

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

const ids = [];
for (let id = 1; id <= 4000 && ids.length < 3338; id++) {
  if (existsSync(join(META, `${id}.json`))) ids.push(id);
}
console.log(`found ${ids.length} tokens\n`);

/**
 * Portraits are drawn once and reused across layouts.
 *
 * The two grids sample the same 32px art at different ratios, so re-rendering
 * for each would double the work to produce identical pixels.
 */
const cache = new Map();
function portraitFor(id) {
  if (cache.has(id)) return cache.get(id);
  const t = traitsOf(id);
  if (!t) return null;
  const p = drawPortrait(resolve(t.indices), t.tier, t.tower, (0xca11ed + id) >>> 0);
  cache.set(id, p);
  return p;
}

mkdirSync(OUT, { recursive: true });

for (const L of LAYOUTS) {
  const canvas = new Grid(Math.max(L.width, L.height));
  canvas.clear(INK);

  const step = PORTRAIT / L.cell; // 4 or 8, both exact
  const marginX = Math.floor((L.width - L.cols * L.cell) / 2);
  const marginY = Math.floor((L.height - L.rows * L.cell) / 2);

  for (let cell = 0; cell < L.cols * L.rows; cell++) {
    const pick = ((cell * (L.stride ?? 1)) % ids.length + ids.length) % ids.length;
    const portrait = portraitFor(ids[pick]);
    if (!portrait) continue;

    const cx = marginX + (cell % L.cols) * L.cell;
    const cy = marginY + Math.floor(cell / L.cols) * L.cell;

    for (let y = 0; y < L.cell; y++) {
      for (let x = 0; x < L.cell; x++) {
        /**
         * The centre of each block, not its corner.
         *
         * Corners in this art usually land on an outline, and sampling them
         * produced a field noticeably darker and flatter than the collection
         * actually looks. The centre lands on the body of a shape and keeps
         * each face's real colour.
         */
        const [r, g, b] = portrait.get(
          Math.min(PORTRAIT - 1, Math.floor(x * step + step / 2)),
          Math.min(PORTRAIT - 1, Math.floor(y * step + step / 2))
        );
        canvas.set(cx + x, cy + y, `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`);
      }
    }
  }

  /**
   * The encoder writes squares only, so a wide layout occupies the top band of
   * one and the page that uses it crops the rest. Flat ink compresses to almost
   * nothing, so the unused area costs a few kilobytes rather than a redesign of
   * the PNG writer.
   */
  writeFileSync(join(OUT, L.name), encodePng(canvas, L.scale));

  const total = L.cols * L.rows;
  console.log(`${L.name}  band ${L.width * L.scale}x${L.height * L.scale}`);
  console.log(`  ${L.cols}x${L.rows} cells, ${L.cell * L.scale}px per face`);
  console.log(`  ${ids.length} unique, ${total - ids.length} repeated to fill\n`);
}
