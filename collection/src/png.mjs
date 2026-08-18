import { deflateSync } from "node:zlib";

/**
 * A minimal PNG encoder for pixel art.
 *
 * Hand-rolled rather than pulling in node-canvas or sharp, for two reasons:
 * both need native binaries that are awkward on Windows, and neither is needed
 * here. This art is nothing but axis-aligned filled rectangles, so a plain byte
 * buffer and zlib — which ships with Node — cover it entirely.
 *
 * Truecolour (type 2), no alpha, filter 0 on every row. Pixel art is long runs
 * of identical bytes, which deflate handles extremely well: a 1024x1024 frame
 * of a 32x32 design lands around 3-6 KB.
 */

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** CRC-32, table built once. PNG requires it on every chunk. */
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

/**
 * A logical pixel grid. Everything is drawn here at design resolution — 32x32 —
 * and only scaled up when encoded, so the art stays honest pixel art rather
 * than something upscaled from a blurry source.
 */
export class Grid {
  constructor(size) {
    this.size = size;
    // Three bytes per pixel, RGB.
    this.data = new Uint8Array(size * size * 3);
  }

  /** Fill the whole grid. */
  clear(hex) {
    const [r, g, b] = rgb(hex);
    for (let i = 0; i < this.data.length; i += 3) {
      this.data[i] = r;
      this.data[i + 1] = g;
      this.data[i + 2] = b;
    }
  }

  /** One pixel. Out-of-bounds writes are ignored rather than throwing — the
   *  art code shifts things around and a clipped pixel is not an error. */
  set(x, y, hex) {
    if (x < 0 || y < 0 || x >= this.size || y >= this.size) return;
    const [r, g, b] = rgb(hex);
    const i = (y * this.size + x) * 3;
    this.data[i] = r;
    this.data[i + 1] = g;
    this.data[i + 2] = b;
  }

  /** The one primitive the character art is built from. */
  rect(x, y, w, h, hex) {
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) this.set(x + dx, y + dy, hex);
    }
  }

  /** Read a pixel back, for verification. */
  get(x, y) {
    const i = (y * this.size + x) * 3;
    return [this.data[i], this.data[i + 1], this.data[i + 2]];
  }
}

/**
 * Encode a grid as a PNG, scaled by nearest-neighbour.
 *
 * Scaling happens here rather than in the drawing so the design stays at 32x32
 * — the scale is a delivery decision, not an art one. Marketplaces display
 * thumbnails with smoothing, so shipping the logical size would look blurred
 * everywhere it matters.
 */
export function encodePng(grid, scale = 32) {
  const size = grid.size * scale;
  const stride = size * 3;

  // One filter byte per row, then the row itself.
  const raw = Buffer.alloc((stride + 1) * size);

  for (let y = 0; y < size; y++) {
    const rowStart = y * (stride + 1);
    raw[rowStart] = 0; // filter: None
    const srcY = (y / scale) | 0;

    for (let x = 0; x < size; x++) {
      const srcX = (x / scale) | 0;
      const s = (srcY * grid.size + srcX) * 3;
      const d = rowStart + 1 + x * 3;
      raw[d] = grid.data[s];
      raw[d + 1] = grid.data[s + 1];
      raw[d + 2] = grid.data[s + 2];
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // adaptive filtering
  ihdr[12] = 0; // no interlace

  return Buffer.concat([
    SIGNATURE,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const cache = new Map();

/** "#RRGGBB" to bytes, memoised — this is called per pixel. */
function rgb(hex) {
  let v = cache.get(hex);
  if (v) return v;
  const h = hex.replace("#", "");
  v = [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
  cache.set(hex, v);
  return v;
}

/** Blend two hex colours. Used for shading without hand-picking every ramp. */
export function mix(a, b, t) {
  const [ar, ag, ab] = rgb(a);
  const [br, bg, bb] = rgb(b);
  const k = Math.max(0, Math.min(1, t));
  const to2 = (n) => Math.round(n).toString(16).padStart(2, "0");
  return `#${to2(ar + (br - ar) * k)}${to2(ag + (bg - ag) * k)}${to2(ab + (bb - ab) * k)}`;
}

export const shade = (hex, t) => mix(hex, "#000000", t);
export const tintUp = (hex, t) => mix(hex, "#FFFFFF", t);
