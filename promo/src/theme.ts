import { Easing } from "remotion";

/**
 * The one source of truth for colour, easing and rhythm.
 *
 * The palette is not invented for the video — it is lifted verbatim from
 * `client/src/styles.css`, so the promo and the running game are the same
 * object. Amber is the game's signature and it is the hero here too: at most
 * one amber element glows per frame.
 *
 * Green and red are the only exception to the one-hero-colour rule, and they
 * earn it — they are *data*, not decoration. A tower is green because its feed
 * moved up. Using any other colour for that would be a lie about the product.
 */
export const theme = {
  colors: {
    /** --paper */
    bg: "#11131a",
    /** A touch above the base, for the ground plane. */
    bgAlt: "#171a24",
    /** --amber. THE hero colour. */
    primary: "#e5a85c",
    /** --violet, used for the chain/oracle layer only. */
    accent: "#8d8af2",
    /** --ink */
    text: "#ecedf3",
    /** --ink-muted */
    textDim: "#9ba1b2",
    /** --ink-faint */
    textFaint: "#676d7d",
    /** --up / --down: market direction, never decoration. */
    up: "#5fb37e",
    down: "#db7264",
    glow: "rgba(229, 168, 92, 0.42)",
    /** District accents, straight from server/src/config/tickers.ts. */
    district: {
      tech: "#5B8DEF",
      crypto: "#E5A85C",
      moonshot: "#C77DFF",
      index: "#6EE7B7",
    },
  },

  fonts: {
    display: "Archivo",
    mono: "JetBrains Mono",
  },

  /** Linear is forbidden. */
  ease: {
    out: Easing.bezier(0.16, 1, 0.3, 1),
    inOut: Easing.bezier(0.83, 0, 0.17, 1),
    in: Easing.bezier(0.7, 0, 0.84, 0),
  },

  spring: {
    snappy: { damping: 14, stiffness: 160, mass: 0.6 },
    smooth: { damping: 20, stiffness: 90, mass: 1 },
    bouncy: { damping: 11, stiffness: 170, mass: 0.7 },
    /** Towers: heavy, so they land rather than wobble. */
    tower: { damping: 17, stiffness: 120, mass: 1.15 },
  },

  /**
   * The isometric projection, copied from `client/src/pixi/iso.ts`.
   *
   * These numbers are not tuned by eye for the video. They are the game's, so
   * the skyline in the promo has the exact proportions of the skyline a player
   * sees — which is the only honest way to shoot b-roll of a product.
   */
  iso: {
    TILE_W: 64,
    TILE_H: 32,
    UNITS_PER_TILE: 4,
    PIXELS_PER_HEIGHT_UNIT: 5.5,
  },

  /**
   * Default tempo. Each cut carries its own in `timing.json`; this is the
   * fallback so `beat()` can be called without one.
   */
  bpm: 124,
} as const;

/** World (x, z) -> screen, byte for byte the game's `worldToScreen`. */
export function worldToScreen(x: number, z: number, elevation = 0) {
  const { TILE_W, TILE_H, UNITS_PER_TILE } = theme.iso;
  const tx = x / UNITS_PER_TILE;
  const tz = z / UNITS_PER_TILE;
  return {
    sx: (tx - tz) * (TILE_W / 2),
    sy: (tx + tz) * (TILE_H / 2) - elevation,
  };
}

/** Frames per beat, so scene cuts can be placed on the music. */
export const beat = (fps: number, bpm: number = theme.bpm) => (fps * 60) / bpm;
