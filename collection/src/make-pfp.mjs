import { writeFileSync, mkdirSync } from "node:fs";
import { Grid, encodePng } from "./png.mjs";
import { drawPortrait } from "./art.mjs";
import { resolve } from "./traits.mjs";
import { textWidth, GLYPH_H } from "./font.mjs";

/**
 * A one-off profile picture, not a collection token.
 *
 * Two things differ from the collection art, and both come from where this ends
 * up rather than from taste:
 *
 *   X crops profile pictures to a CIRCLE. The collection's rectangular tier
 *   frame would be sliced into four disconnected arcs that read as rendering
 *   glitches, so this composition carries no frame at all. `RING` can put a
 *   border back on the circle itself if one is ever wanted.
 *
 *   Pixel art only survives an INTEGER downscale. X renders profile pictures at
 *   400px, so 800 (25x the 32px design) halves cleanly while 1024 does not —
 *   1024 to 400 is 0.39x, which resamples every hard edge into mush.
 */

const LOOK = {
  jacket: 8, // Ink
  collar: 0, // Cyan
  hair: 0, // Black, short crop
  visor: 0, // Cyan
  skin: 1, // Sand
  accessory: 2, // Headphones
};

const SHIRT_TEXT = "CPP";
const PRINT = "#22E8FF";
/** Set to a hex colour to draw a border on the circle. Null for no ring. */
const RING = null;

/**
 * Output sizes, all integer multiples of the 32px design.
 *
 * 800 is the one to upload: X displays at 400, so it halves with no
 * resampling. 384 is there for anywhere that wants roughly 400 natively, and
 * 1024 for general use where nothing is downscaling it.
 */
const SIZES = [
  { px: 800, scale: 25, note: "recommended for X — halves to 400 cleanly" },
  { px: 1024, scale: 32, note: "general purpose" },
  { px: 384, scale: 12, note: "small, native — no downscale needed" },
];

const outDir = "pfp";
mkdirSync(outDir, { recursive: true });

const traits = resolve(LOOK);
const grid = drawPortrait(traits, "resident", null, 7331, {
  shirtText: SHIRT_TEXT,
  shirtTextColor: PRINT,
  ...(RING ? { ring: RING } : {}),
  pfp: true,
});

// ---- verify nothing important falls outside the circle --------------------

const R = 32 / 2 - 0.5;
const C = (32 - 1) / 2;
const w = textWidth(SHIRT_TEXT);
const x0 = Math.round((32 - w) / 2);

let clipped = 0;
for (let y = 24; y < 24 + GLYPH_H; y++) {
  for (let x = x0; x < x0 + w; x++) {
    if (Math.hypot(x - C, y - C) > R + 0.5) clipped++;
  }
}
if (clipped > 0) {
  throw new Error(`${clipped} pixels of "${SHIRT_TEXT}" fall outside the circular crop.`);
}

// ---- write the files -------------------------------------------------------

for (const { px, scale, note } of SIZES) {
  writeFileSync(`${outDir}/cpp-pfp-${px}.png`, encodePng(grid, scale));
  console.log(`  cpp-pfp-${px}.png   ${px}x${px}  (${scale}x)  ${note}`);
}

/**
 * A circle-cropped copy, so the result can be judged as it will actually
 * appear rather than as a square nobody will ever see.
 */
const masked = new Grid(32);
for (let y = 0; y < 32; y++) {
  for (let x = 0; x < 32; x++) {
    const inside = Math.hypot(x - C, y - C) <= R + 0.5;
    const [r, g, b] = inside ? grid.get(x, y) : [10, 11, 18];
    const i = (y * 32 + x) * 3;
    masked.data[i] = r;
    masked.data[i + 1] = g;
    masked.data[i + 2] = b;
  }
}
writeFileSync(`${outDir}/cpp-pfp-circle-preview.png`, encodePng(masked, 25));

/**
 * A timeline check at the sizes X actually renders.
 *
 * The first version of this drew the same grid four times at one scale, which
 * looked like a size comparison and compared nothing. These are genuinely
 * downscaled: 48px is the avatar beside a tweet, and anything illegible there
 * is illegible where the image is seen most.
 *
 * Downscaling is nearest-neighbour by area majority, which is roughly what a
 * browser does to a hard-edged image and is honest about what gets lost.
 */
for (const target of [48, 96, 144]) {
  const small = new Grid(target);
  for (let y = 0; y < target; y++) {
    for (let x = 0; x < target; x++) {
      const sx = Math.min(31, Math.floor((x / target) * 32));
      const sy = Math.min(31, Math.floor((y / target) * 32));
      const inside = Math.hypot(sx - C, sy - C) <= R + 0.5;
      const [r, g, b] = inside ? grid.get(sx, sy) : [10, 11, 18];
      const i = (y * target + x) * 3;
      small.data[i] = r;
      small.data[i + 1] = g;
      small.data[i + 2] = b;
    }
  }
  // Re-scaled up 8x purely so the result is inspectable at a glance.
  writeFileSync(`${outDir}/at-${target}px.png`, encodePng(small, 8));
}

console.log(`\n  traits: ${Object.entries(traits.names).map(([k, v]) => `${k}=${v}`).join("  ")}`);
console.log(`  print : "${SHIRT_TEXT}" in ${PRINT}, ring ${RING ?? "none"}`);
console.log(`  code  : ${traits.code}`);
