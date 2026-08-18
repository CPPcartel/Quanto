import { Texture } from "pixi.js";
import { TILE_W, TILE_H } from "./iso";
import { decodeTraits, traitsFromColor, type Traits } from "./traits";

/**
 * Procedural pixel-art factory.
 *
 * Every texture in the game is drawn here, once, into an offscreen canvas and
 * cached. Nothing is downloaded. Cyberpunk is carried by light and colour
 * rather than draftsmanship, which is exactly what code is good at: tight
 * palette, one light direction, ordered dithering, additive glow.
 *
 * To move to hand-drawn art later, replace the factories — every consumer goes
 * through `art.*` and never touches a canvas directly.
 */

// ---------------------------------------------------------------------------
// Palette
// ---------------------------------------------------------------------------

export const PALETTE = {
  void: "#07080F",
  asphalt: "#0D0F1A",
  asphaltLit: "#141829",
  kerb: "#1B2033",
  roadLine: "#2A3150",

  /** Building body ramp, dark -> light (light comes from the north-east). */
  wallDark: "#141726",
  wallMid: "#1D2136",
  wallLight: "#272C47",
  wallEdge: "#3A4166",

  windowOff: "#0B0D16",
  windowFrame: "#2E3557",

  neonCyan: "#22E8FF",
  neonMagenta: "#FF2D95",
  neonAmber: "#FFB347",
  neonLime: "#3BFF8F",
  neonViolet: "#A855F7",
  neonRed: "#FF4D5E",

  skin: "#D9A283",
  visor: "#22E8FF",
} as const;

/** District identity colours — used for trim, roof lights and signage. */
export const DISTRICT_NEON: Record<string, string> = {
  tech: PALETTE.neonCyan,
  crypto: PALETTE.neonAmber,
  moonshot: PALETTE.neonMagenta,
  index: PALETTE.neonLime,
};

export function districtNeon(id: string) {
  return DISTRICT_NEON[id] ?? PALETTE.neonCyan;
}

// ---------------------------------------------------------------------------
// Canvas helpers
// ---------------------------------------------------------------------------

export function canvas(w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  const ctx = c.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;
  return { c, ctx };
}

/** Crisp pixels: never let the GPU smooth our art when zooming. */
export function toTexture(c: HTMLCanvasElement): Texture {
  const tex = Texture.from(c);
  tex.source.scaleMode = "nearest";
  return tex;
}

function hexToRgb(hex: string) {
  const h = hex.replace("#", "");
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

export function mix(a: string, b: string, t: number) {
  const ca = hexToRgb(a);
  const cb = hexToRgb(b);
  const r = Math.round(ca.r + (cb.r - ca.r) * t);
  const g = Math.round(ca.g + (cb.g - ca.g) * t);
  const bl = Math.round(ca.b + (cb.b - ca.b) * t);
  return `rgb(${r},${g},${bl})`;
}

/** Deterministic per-building noise so a tower looks the same every session. */
export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967295;
}

export function seeded(seed: number) {
  let s = Math.floor(seed * 2147483647) || 12345;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

/** 4x4 ordered-dither threshold matrix — cheap gradients that stay pixel-art. */
const BAYER = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];

// ---------------------------------------------------------------------------
// Ground
// ---------------------------------------------------------------------------

/** Ground pattern spans this many iso tiles before repeating. */
export const GROUND_TILES = 8;

/**
 * The entire ground, as one seamlessly-tiling texture.
 *
 * Iso diamonds tile in *screen* space on a brick offset, so an 8x8-tile patch
 * repeats perfectly in both axes. That turns the ground from ~11,000 sprites
 * into a single TilingSprite — one draw call for a city-sized street plan.
 */
export function makeGroundPattern(): Texture {
  const w = TILE_W * GROUND_TILES;
  const h = TILE_H * GROUND_TILES;
  const { c, ctx } = canvas(w, h);
  const rand = seeded(0.404);

  ctx.fillStyle = PALETTE.kerb;
  ctx.fillRect(0, 0, w, h);

  // Diamond cell grid. Rows step by half a tile height and alternate offset.
  const rows = (h / TILE_H) * 2;
  const cols = w / TILE_W;

  const drawDiamond = (cx: number, cy: number, fill: string) => {
    ctx.beginPath();
    ctx.moveTo(cx, cy - TILE_H / 2);
    ctx.lineTo(cx + TILE_W / 2, cy);
    ctx.lineTo(cx, cy + TILE_H / 2);
    ctx.lineTo(cx - TILE_W / 2, cy);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
  };

  for (let row = -1; row <= rows; row++) {
    for (let col = -1; col <= cols; col++) {
      const cx = col * TILE_W + (row % 2 ? TILE_W / 2 : 0);
      const cy = (row * TILE_H) / 2;

      // A cross of roads through the patch; everything else is city block.
      const isRoad = row % 8 === 0 || row % 8 === 1 || col % 4 === 0;
      drawDiamond(cx, cy, isRoad ? PALETTE.asphalt : PALETTE.kerb);

      if (isRoad) {
        // Faint lane marking down the middle of the cell.
        ctx.fillStyle = "rgba(120,140,200,0.14)";
        ctx.fillRect(cx - 10, cy - 1, 20, 1);
      }

      // Wet-asphalt speckle catching neon from above.
      const speckles = isRoad ? 5 : 2;
      for (let i = 0; i < speckles; i++) {
        const t = rand();
        const u = rand();
        if (t + u > 1) continue;
        const px = Math.floor(cx + (t - u) * (TILE_W / 2));
        const py = Math.floor(cy - TILE_H / 2 + (t + u) * (TILE_H / 2));
        ctx.fillStyle = mix(PALETTE.asphalt, PALETTE.roadLine, 0.4 + rand() * 0.5);
        ctx.fillRect(px, py, 1, 1);
      }
    }
  }

  return toTexture(c);
}

// ---------------------------------------------------------------------------
// Buildings
// ---------------------------------------------------------------------------

export const FLOOR_H = 14;

/**
 * A vertically-tiling slab of facade, one storey tall.
 *
 * The two visible walls of an iso box are plain vertical strips (only the roof
 * and the ground contact are slanted), so a rectangular tile repeats perfectly
 * and a price change becomes a change of tile count rather than a redraw.
 */
export function makeWallTile(span: number, seed: number, districtId: string): Texture {
  const w = TILE_W * span;
  const { c, ctx } = canvas(w, FLOOR_H);
  const rand = seeded(seed);
  const half = w / 2;

  // South-west wall is in shadow, south-east wall catches the key light.
  ctx.fillStyle = PALETTE.wallDark;
  ctx.fillRect(0, 0, half, FLOOR_H);
  ctx.fillStyle = PALETTE.wallMid;
  ctx.fillRect(half, 0, half, FLOOR_H);

  // Dither a subtle vertical gradient so tall towers don't read as flat slabs.
  for (let y = 0; y < FLOOR_H; y++) {
    for (let x = 0; x < w; x++) {
      const lit = x >= half;
      const grad = y / FLOOR_H;
      const threshold = BAYER[y % 4][x % 4] / 16;
      if (grad > threshold) continue;
      ctx.fillStyle = lit
        ? mix(PALETTE.wallMid, PALETTE.wallLight, 0.5)
        : mix(PALETTE.wallDark, PALETTE.wallMid, 0.5);
      ctx.fillRect(x, y, 1, 1);
    }
  }

  // Vertical seam where the two faces meet, plus outer edges.
  ctx.fillStyle = PALETTE.wallEdge;
  ctx.fillRect(half - 1, 0, 1, FLOOR_H);
  ctx.fillRect(0, 0, 1, FLOOR_H);
  ctx.fillRect(w - 1, 0, 1, FLOOR_H);

  // Storey division line.
  ctx.fillStyle = mix(PALETTE.wallDark, "#000000", 0.4);
  ctx.fillRect(0, FLOOR_H - 1, w, 1);

  // Unlit window slots — the sockets that lit-floor sprites later fill.
  const cols = span * 2;
  const winW = 6;
  const winH = 7;
  for (let side = 0; side < 2; side++) {
    for (let i = 0; i < cols; i++) {
      const slotW = half / cols;
      const x = Math.floor(side * half + i * slotW + (slotW - winW) / 2);
      const y = 3;
      ctx.fillStyle = PALETTE.windowOff;
      ctx.fillRect(x, y, winW, winH);
      ctx.fillStyle = PALETTE.windowFrame;
      ctx.fillRect(x, y, winW, 1);
      // A rare always-on window keeps dark towers from looking abandoned.
      if (rand() < 0.06) {
        ctx.fillStyle = mix(PALETTE.windowOff, districtNeon(districtId), 0.35);
        ctx.fillRect(x + 1, y + 1, winW - 2, winH - 2);
      }
    }
  }

  return toTexture(c);
}

/** Window positions inside one storey, in tile-local pixels. */
export function windowSlots(span: number): Array<{ x: number; y: number; w: number; h: number }> {
  const w = TILE_W * span;
  const half = w / 2;
  const cols = span * 2;
  const winW = 6;
  const winH = 7;
  const slots: Array<{ x: number; y: number; w: number; h: number }> = [];
  for (let side = 0; side < 2; side++) {
    for (let i = 0; i < cols; i++) {
      const slotW = half / cols;
      slots.push({
        x: Math.floor(side * half + i * slotW + (slotW - winW) / 2),
        y: 3,
        w: winW,
        h: winH,
      });
    }
  }
  return slots;
}

/** A single lit window, drawn additively over the facade. */
export function makeLitWindow(color: string): Texture {
  const { c, ctx } = canvas(6, 7);
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 6, 7);
  // Hot centre, cooler edge — reads as light spilling through glass.
  ctx.fillStyle = "rgba(255,255,255,0.55)";
  ctx.fillRect(1, 1, 4, 3);
  return toTexture(c);
}

/** The roof: iso diamond top face plus a neon parapet in the district colour. */
export function makeRoof(span: number, districtId: string): Texture {
  const w = TILE_W * span;
  const h = TILE_H * span;
  const pad = 4;
  const { c, ctx } = canvas(w, h + pad);
  const neon = districtNeon(districtId);

  ctx.beginPath();
  ctx.moveTo(w / 2, pad);
  ctx.lineTo(w, h / 2 + pad);
  ctx.lineTo(w / 2, h + pad);
  ctx.lineTo(0, h / 2 + pad);
  ctx.closePath();
  ctx.fillStyle = PALETTE.wallLight;
  ctx.fill();
  ctx.strokeStyle = PALETTE.wallEdge;
  ctx.lineWidth = 1;
  ctx.stroke();

  // Rooftop plant: a couple of darker blocks so tops aren't blank.
  ctx.fillStyle = mix(PALETTE.wallLight, "#000000", 0.35);
  ctx.fillRect(Math.floor(w / 2 - 6), Math.floor(h / 2 + pad - 5), 12, 6);

  // Parapet edge light — the strongest district cue when looking down a street.
  ctx.strokeStyle = neon;
  ctx.globalAlpha = 0.9;
  ctx.beginPath();
  ctx.moveTo(0, h / 2 + pad);
  ctx.lineTo(w / 2, h + pad);
  ctx.lineTo(w, h / 2 + pad);
  ctx.stroke();
  ctx.globalAlpha = 1;

  // Aircraft-warning beacon.
  ctx.fillStyle = neon;
  ctx.fillRect(Math.floor(w / 2 - 1), pad + 1, 2, 2);

  return toTexture(c);
}

/**
 * The V-shaped skirt that closes the bottom of the walls onto the ground
 * diamond. Without it the tower would end in a flat cut floating over its tile.
 */
export function makeSkirt(span: number): Texture {
  const w = TILE_W * span;
  const h = (TILE_H * span) / 2;
  const { c, ctx } = canvas(w, h);
  const half = w / 2;

  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(half, h);
  ctx.lineTo(half, 0);
  ctx.closePath();
  ctx.fillStyle = PALETTE.wallDark;
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(half, 0);
  ctx.lineTo(half, h);
  ctx.lineTo(w, 0);
  ctx.closePath();
  ctx.fillStyle = PALETTE.wallMid;
  ctx.fill();

  return toTexture(c);
}

/** Soft radial glow, used additively for neon spill, shards and storm light. */
export function makeGlow(color: string, size = 64): Texture {
  const { c, ctx } = canvas(size, size);
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  const { r, g, b } = hexToRgb(color);
  grad.addColorStop(0, `rgba(${r},${g},${b},0.85)`);
  grad.addColorStop(0.4, `rgba(${r},${g},${b},0.28)`);
  grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  return toTexture(c);
}

/** Vertical neon sign board mounted on a facade. */
export function makeNeonSign(text: string, color: string): Texture {
  const chars = text.slice(0, 5).toUpperCase().split("");
  const cw = 7;
  const ch = 9;
  const { c, ctx } = canvas(cw + 4, chars.length * ch + 4);

  ctx.fillStyle = "rgba(6,7,14,0.85)";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.7;
  ctx.strokeRect(0.5, 0.5, c.width - 1, c.height - 1);
  ctx.globalAlpha = 1;

  ctx.font = "8px monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = color;
  chars.forEach((ch2, i) => {
    ctx.fillText(ch2, c.width / 2, 2 + i * ch + ch / 2);
  });

  return toTexture(c);
}

// ---------------------------------------------------------------------------
// Street furniture
// ---------------------------------------------------------------------------

/**
 * A streetlight: pole plus a lamp head that overhangs the carriageway.
 *
 * Drawn with its base at the bottom-centre so it can be anchored (0.5, 1) and
 * placed directly on a world position. The light *pool* is a separate additive
 * sprite on the ground — doing both in one texture would light the pavement
 * through whatever stands in front of it.
 */
export function makeStreetlight(): Texture {
  const { c, ctx } = canvas(18, 46);

  ctx.fillStyle = "#2A3040";
  ctx.fillRect(8, 6, 2, 39); // pole
  ctx.fillStyle = "#232838";
  ctx.fillRect(6, 44, 6, 2); // base

  // Arm curving out over the road.
  ctx.fillStyle = "#2A3040";
  ctx.fillRect(6, 5, 4, 2);
  ctx.fillRect(4, 6, 2, 2);

  // Lamp housing, then the emitting face.
  ctx.fillStyle = "#333A4E";
  ctx.fillRect(2, 8, 6, 3);
  ctx.fillStyle = PALETTE.neonAmber;
  ctx.fillRect(3, 10, 4, 2);
  ctx.globalAlpha = 0.5;
  ctx.fillRect(2, 12, 6, 1);
  ctx.globalAlpha = 1;

  return toTexture(c);
}

/** Chunky iso tree — the main thing breaking up all the grey and neon. */
export function makeTree(seed: number): Texture {
  const { c, ctx } = canvas(26, 38);
  const rand = seeded(seed);

  ctx.fillStyle = "#3A2A1E";
  ctx.fillRect(12, 26, 3, 11); // trunk

  // Overlapping clumps, darker at the base for volume.
  const shades = ["#1B4A31", "#245C3C", "#2E7A4B", "#3C9159"];
  const blobs: Array<[number, number, number]> = [
    [13, 20, 9],
    [8, 15, 7],
    [18, 15, 7],
    [13, 10, 8],
  ];

  blobs.forEach((b, i) => {
    const [bx, by, r] = b;
    ctx.fillStyle = shades[Math.min(shades.length - 1, i + (rand() > 0.6 ? 1 : 0))];
    // Blocky circle: a few stacked rects reads better at this scale than an arc.
    for (let y = -r; y <= r; y += 2) {
      const w = Math.round(Math.sqrt(Math.max(0, r * r - y * y)) * 2);
      ctx.fillRect(Math.round(bx - w / 2), Math.round(by + y), w, 2);
    }
  });

  // A couple of lit specks — city trees catch the neon.
  ctx.fillStyle = "#4FB87A";
  for (let i = 0; i < 3; i++) {
    ctx.fillRect(6 + Math.floor(rand() * 14), 8 + Math.floor(rand() * 14), 1, 1);
  }

  return toTexture(c);
}

/** Small parked car, seen isometrically. */
export function makeCar(seed: number, alongX: boolean): Texture {
  const w = alongX ? 30 : 22;
  const h = alongX ? 20 : 26;
  const { c, ctx } = canvas(w, h);
  const rand = seeded(seed);

  const bodies = ["#8A3B3B", "#2F4E7A", "#4A4E58", "#6B6357", "#2E6152", "#7A3F63"];
  const body = bodies[Math.floor(rand() * bodies.length)];

  const bw = alongX ? 26 : 16;
  const bh = alongX ? 12 : 20;
  const ox = Math.floor((w - bw) / 2);
  const oy = Math.floor((h - bh) / 2);

  // Shadow first so the car sits on the road rather than floating.
  ctx.fillStyle = "rgba(0,0,0,0.32)";
  ctx.fillRect(ox, oy + bh - 2, bw, 3);

  ctx.fillStyle = body;
  ctx.fillRect(ox, oy, bw, bh - 2);
  // Lit upper face.
  ctx.fillStyle = mix(body, "#FFFFFF", 0.18);
  ctx.fillRect(ox, oy, bw, Math.floor(bh / 2) - 1);

  // Cabin glass.
  ctx.fillStyle = "#16202E";
  if (alongX) ctx.fillRect(ox + 7, oy + 2, 12, 5);
  else ctx.fillRect(ox + 3, oy + 6, 10, 7);

  // Lights — red at one end, amber at the other.
  ctx.fillStyle = PALETTE.neonRed;
  if (alongX) ctx.fillRect(ox, oy + 5, 1, 3);
  else ctx.fillRect(ox + 5, oy + bh - 3, 3, 1);
  ctx.fillStyle = PALETTE.neonAmber;
  if (alongX) ctx.fillRect(ox + bw - 1, oy + 5, 1, 3);
  else ctx.fillRect(ox + 5, oy, 3, 1);

  return toTexture(c);
}

/** Planter, bench, bin, hydrant — small pavement clutter. */
export function makeStreetProp(kind: "planter" | "bench" | "bin" | "hydrant"): Texture {
  const { c, ctx } = canvas(16, 18);

  if (kind === "planter") {
    ctx.fillStyle = "#3A3F4E";
    ctx.fillRect(3, 10, 10, 6);
    ctx.fillStyle = "#2E7A4B";
    ctx.fillRect(4, 6, 8, 5);
    ctx.fillStyle = "#3C9159";
    ctx.fillRect(5, 5, 3, 3);
  }

  if (kind === "bench") {
    ctx.fillStyle = "#4A3B2E";
    ctx.fillRect(2, 10, 12, 3);
    ctx.fillRect(2, 6, 12, 2);
    ctx.fillStyle = "#2A3040";
    ctx.fillRect(3, 13, 2, 3);
    ctx.fillRect(11, 13, 2, 3);
  }

  if (kind === "bin") {
    ctx.fillStyle = "#2F3647";
    ctx.fillRect(5, 8, 7, 9);
    ctx.fillStyle = "#3A4256";
    ctx.fillRect(5, 7, 7, 2);
  }

  if (kind === "hydrant") {
    ctx.fillStyle = "#9C3A32";
    ctx.fillRect(6, 9, 4, 7);
    ctx.fillRect(5, 11, 6, 2);
    ctx.fillStyle = "#B8453C";
    ctx.fillRect(6, 8, 4, 2);
  }

  return toTexture(c);
}

/** Rooftop clutter, so towers don't end in a bare slab. */
export function makeRoofUnit(seed: number): Texture {
  const { c, ctx } = canvas(22, 16);
  const rand = seeded(seed);

  if (rand() < 0.45) {
    // AC block
    ctx.fillStyle = "#2C3244";
    ctx.fillRect(4, 6, 14, 8);
    ctx.fillStyle = "#39415A";
    ctx.fillRect(4, 5, 14, 2);
    ctx.fillStyle = "#1E2434";
    for (let i = 0; i < 3; i++) ctx.fillRect(6 + i * 4, 8, 2, 4);
  } else if (rand() < 0.7) {
    // Water tank on legs
    ctx.fillStyle = "#3A3226";
    ctx.fillRect(7, 3, 9, 8);
    ctx.fillStyle = "#463C2E";
    ctx.fillRect(7, 2, 9, 2);
    ctx.fillStyle = "#2A3040";
    ctx.fillRect(8, 11, 2, 4);
    ctx.fillRect(13, 11, 2, 4);
  } else {
    // Antenna mast with a warning light
    ctx.fillStyle = "#2A3040";
    ctx.fillRect(11, 1, 2, 14);
    ctx.fillRect(8, 12, 8, 2);
    ctx.fillStyle = PALETTE.neonRed;
    ctx.fillRect(11, 0, 2, 2);
  }

  return toTexture(c);
}

const CHAR_W = 20;
const CHAR_H = 34;
export const CHAR_FRAMES = 4;
export const CHAR_DIRS = 8;

/**
 * Walk sets, keyed by trait code and bounded.
 *
 * Each entry holds 8 facings x 4 frames = 32 textures. When this was keyed by
 * colour there were about sixteen distinct values in the whole game, so the
 * cache was self-limiting at ~512 textures and needed no eviction.
 *
 * NFT traits break that assumption: 45,000 combinations exist, and every
 * distinct holder in view mints its own 32 textures. Unbounded, a busy city
 * walks straight into a texture-memory leak that only appears under load — so
 * the cache evicts least-recently-used entries past a hard cap.
 *
 * A Map iterates in insertion order, which is all an LRU needs: re-inserting on
 * every hit moves an entry to the end, so the first key is always the coldest.
 */
const charCache = new Map<string, Texture[][]>();

/**
 * Distinct walk sets held in memory.
 *
 * Sized against the worst realistic case — a full room of 150 players, all with
 * different traits, plus the crowd — while leaving the texture count an order of
 * magnitude below where WebGL starts thrashing. Anything past this renders with
 * a recycled set rather than allocating.
 */
export const MAX_CHAR_SETS = 96;

/** How many walk sets are currently resident. Read by the debug HUD. */
export function characterSetCount(): number {
  return charCache.size;
}

/**
 * Build a full walk set for one appearance: 8 iso facings x 4 frames.
 *
 * Accepts either a trait code (six base36 digits, from the NFT) or a plain hex
 * colour, which is what guests and the NPC crowd still use.
 */
export function characterSet(codeOrColor: string): Texture[][] {
  const key = codeOrColor || "000010";

  const cached = charCache.get(key);
  if (cached) {
    // Touch: delete and re-insert so this key becomes the most recent.
    charCache.delete(key);
    charCache.set(key, cached);
    return cached;
  }

  const traits = key.startsWith("#") ? traitsFromColor(key) : decodeTraits(key);

  const dirs: Texture[][] = [];
  for (let d = 0; d < CHAR_DIRS; d++) {
    const frames: Texture[] = [];
    for (let f = 0; f < CHAR_FRAMES; f++) {
      frames.push(drawCharacter(traits, d, f));
    }
    dirs.push(frames);
  }

  charCache.set(key, dirs);

  // Evict the coldest entry once over the cap, destroying its textures — a
  // dropped reference alone would leave them on the GPU.
  while (charCache.size > MAX_CHAR_SETS) {
    const coldest = charCache.keys().next().value as string | undefined;
    if (coldest === undefined || coldest === key) break;
    const evicted = charCache.get(coldest);
    charCache.delete(coldest);
    evicted?.forEach((frames) => frames.forEach((t) => t.destroy(true)));
  }

  return dirs;
}

/**
 * One character frame.
 *
 * Facing index runs clockwise from 0 = south (toward camera). We only vary
 * silhouette by whether the figure reads as front, back or side, plus a visor
 * that only shows when facing the camera — enough to read direction clearly at
 * this size without eight bespoke drawings.
 */
function drawCharacter(traits: Traits, dir: number, frame: number): Texture {
  const color = traits.jacket;
  const { c, ctx } = canvas(CHAR_W, CHAR_H);
  const cx = CHAR_W / 2;

  const facingAway = dir >= 3 && dir <= 5;
  const sideOn = dir === 2 || dir === 6;
  const flip = dir >= 5;

  // Two-frame swing (frames 0/2 neutral, 1 and 3 opposite extremes).
  const swing = [0, 1, 0, -1][frame];
  const bob = frame % 2 === 0 ? 0 : -1;

  ctx.save();
  if (flip) {
    ctx.translate(CHAR_W, 0);
    ctx.scale(-1, 1);
  }

  const shade = (hex: string, t: number) => mix(hex, "#000000", t);

  // Legs
  const legY = 22 + bob;
  ctx.fillStyle = shade(color, 0.62);
  ctx.fillRect(cx - 5 + swing, legY, 4, 11);
  ctx.fillRect(cx + 1 - swing, legY, 4, 11);
  // Boots pick up a little ground neon.
  ctx.fillStyle = shade(color, 0.78);
  ctx.fillRect(cx - 5 + swing, legY + 9, 4, 2);
  ctx.fillRect(cx + 1 - swing, legY + 9, 4, 2);

  // Torso / jacket
  ctx.fillStyle = color;
  ctx.fillRect(cx - 6, 11 + bob, 12, 12);
  ctx.fillStyle = shade(color, 0.35);
  ctx.fillRect(cx - 6, 11 + bob, sideOn ? 4 : 3, 12);

  // Neon collar strip — the cyberpunk tell, and it reads even zoomed out.
  ctx.fillStyle = traits.collar;
  ctx.globalAlpha = 0.85;
  ctx.fillRect(cx - 6, 11 + bob, 12, 1);
  ctx.globalAlpha = 1;

  // Arms
  ctx.fillStyle = shade(color, 0.2);
  ctx.fillRect(cx - 8, 12 + bob - swing, 3, 9);
  ctx.fillRect(cx + 5, 12 + bob + swing, 3, 9);

  // Head
  ctx.fillStyle = traits.skin;
  ctx.fillRect(cx - 4, 2 + bob, 8, 9);
  // Hair / hood
  ctx.fillStyle = traits.hair;
  ctx.fillRect(cx - 4, 2 + bob, 8, 3);
  if (facingAway) {
    ctx.fillRect(cx - 4, 2 + bob, 8, 7);
  } else {
    // Visor only when the face is toward camera.
    ctx.fillStyle = traits.visor;
    ctx.fillRect(cx - 3, 6 + bob, sideOn ? 4 : 6, 2);
  }

  drawAccessory(ctx, traits, cx, bob, facingAway);

  ctx.restore();
  return toTexture(c);
}

// ---------------------------------------------------------------------------
// Cached shared textures
// ---------------------------------------------------------------------------

let cache: {
  ground: Texture;
  glow: Record<string, Texture>;
  litWindow: Record<string, Texture>;
  shard: Texture;
} | null = null;

export function art() {
  if (cache) return cache;
  cache = {
    ground: makeGroundPattern(),
    glow: {
      cyan: makeGlow(PALETTE.neonCyan),
      magenta: makeGlow(PALETTE.neonMagenta),
      amber: makeGlow(PALETTE.neonAmber),
      lime: makeGlow(PALETTE.neonLime),
      white: makeGlow("#FFFFFF"),
    },
    litWindow: {
      amber: makeLitWindow(PALETTE.neonAmber),
      cyan: makeLitWindow(PALETTE.neonCyan),
      magenta: makeLitWindow(PALETTE.neonMagenta),
      lime: makeLitWindow(PALETTE.neonLime),
    },
    shard: makeGlow(PALETTE.neonCyan, 24),
  };
  return cache;
}

/**
 * The accessory layer, drawn last so it sits over the hair.
 *
 * Deliberately small and readable at 20x34 — anything with fine detail becomes
 * noise at street zoom and disappears entirely one LOD tier out, which would
 * make the rarest trait the least visible one.
 */
function drawAccessory(
  ctx: CanvasRenderingContext2D,
  traits: Traits,
  cx: number,
  bob: number,
  facingAway: boolean
) {
  if (traits.accessory === 0) return;
  const y = 2 + bob;
  ctx.fillStyle = traits.accessoryHex;

  switch (traits.accessory) {
    case 1: // Cap — brim only when the face is toward camera.
      ctx.fillRect(cx - 5, y - 1, 10, 3);
      if (!facingAway) ctx.fillRect(cx - 5, y + 2, 7, 1);
      break;
    case 2: // Headphones — a band and two cups.
      ctx.fillRect(cx - 5, y - 1, 10, 2);
      ctx.fillRect(cx - 6, y + 1, 2, 4);
      ctx.fillRect(cx + 4, y + 1, 2, 4);
      break;
    case 3: // Antenna — a stalk with a lit tip.
      ctx.fillRect(cx + 2, y - 4, 1, 5);
      ctx.fillRect(cx + 1, y - 6, 3, 2);
      break;
    case 4: // Halo — floats clear of the head so it reads as separate.
      ctx.fillRect(cx - 4, y - 4, 8, 1);
      ctx.fillRect(cx - 5, y - 3, 1, 1);
      ctx.fillRect(cx + 4, y - 3, 1, 1);
      break;
  }
}
