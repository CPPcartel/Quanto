/**
 * A 3x5 pixel font.
 *
 * Three pixels wide is the narrowest a legible uppercase alphabet gets, and at
 * this scale that matters: the shirt front is about 24 pixels across, so a 4px
 * font would fit four characters and a 5px font three. Three-wide leaves room
 * for five characters plus spacing, which covers a ticker or a short handle.
 *
 * Rows are read most-significant-bit first across three columns.
 */
const GLYPHS = {
  A: [0b111, 0b101, 0b111, 0b101, 0b101],
  B: [0b110, 0b101, 0b110, 0b101, 0b110],
  C: [0b111, 0b100, 0b100, 0b100, 0b111],
  D: [0b110, 0b101, 0b101, 0b101, 0b110],
  E: [0b111, 0b100, 0b111, 0b100, 0b111],
  F: [0b111, 0b100, 0b111, 0b100, 0b100],
  G: [0b111, 0b100, 0b101, 0b101, 0b111],
  H: [0b101, 0b101, 0b111, 0b101, 0b101],
  I: [0b111, 0b010, 0b010, 0b010, 0b111],
  J: [0b001, 0b001, 0b001, 0b101, 0b111],
  K: [0b101, 0b101, 0b110, 0b101, 0b101],
  L: [0b100, 0b100, 0b100, 0b100, 0b111],
  M: [0b101, 0b111, 0b111, 0b101, 0b101],
  N: [0b110, 0b101, 0b101, 0b101, 0b101],
  O: [0b111, 0b101, 0b101, 0b101, 0b111],
  P: [0b111, 0b101, 0b111, 0b100, 0b100],
  Q: [0b111, 0b101, 0b101, 0b111, 0b001],
  R: [0b111, 0b101, 0b111, 0b110, 0b101],
  S: [0b111, 0b100, 0b111, 0b001, 0b111],
  T: [0b111, 0b010, 0b010, 0b010, 0b010],
  U: [0b101, 0b101, 0b101, 0b101, 0b111],
  V: [0b101, 0b101, 0b101, 0b101, 0b010],
  W: [0b101, 0b101, 0b111, 0b111, 0b101],
  X: [0b101, 0b101, 0b010, 0b101, 0b101],
  Y: [0b101, 0b101, 0b010, 0b010, 0b010],
  Z: [0b111, 0b001, 0b010, 0b100, 0b111],
  0: [0b111, 0b101, 0b101, 0b101, 0b111],
  1: [0b010, 0b110, 0b010, 0b010, 0b111],
  2: [0b111, 0b001, 0b111, 0b100, 0b111],
  3: [0b111, 0b001, 0b111, 0b001, 0b111],
  4: [0b101, 0b101, 0b111, 0b001, 0b001],
  5: [0b111, 0b100, 0b111, 0b001, 0b111],
  6: [0b111, 0b100, 0b111, 0b101, 0b111],
  7: [0b111, 0b001, 0b001, 0b001, 0b001],
  8: [0b111, 0b101, 0b111, 0b101, 0b111],
  9: [0b111, 0b101, 0b111, 0b001, 0b111],
  "$": [0b111, 0b110, 0b111, 0b011, 0b111],
  ".": [0b000, 0b000, 0b000, 0b000, 0b010],
  "-": [0b000, 0b000, 0b111, 0b000, 0b000],
  " ": [0, 0, 0, 0, 0],
};

export const GLYPH_W = 3;
export const GLYPH_H = 5;
/** One blank column between characters. */
export const TRACKING = 1;

/** Rendered width of a string, in pixels. */
export function textWidth(text) {
  const n = [...String(text)].length;
  return n === 0 ? 0 : n * GLYPH_W + (n - 1) * TRACKING;
}

/**
 * Draw text into a grid, top-left anchored.
 *
 * Unknown characters are skipped rather than substituted — a missing glyph
 * should leave a gap you notice, not a wrong letter you don't.
 */
export function drawText(grid, text, x, y, colour) {
  let cursor = x;
  for (const ch of String(text).toUpperCase()) {
    const glyph = GLYPHS[ch];
    if (glyph) {
      for (let row = 0; row < GLYPH_H; row++) {
        const bits = glyph[row];
        for (let col = 0; col < GLYPH_W; col++) {
          if (bits & (1 << (GLYPH_W - 1 - col))) grid.set(cursor + col, y + row, colour);
        }
      }
    }
    cursor += GLYPH_W + TRACKING;
  }
}

export function supported(text) {
  return [...String(text).toUpperCase()].every((c) => c in GLYPHS);
}
