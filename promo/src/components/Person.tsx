import React from "react";
import { theme } from "../theme";
import { mix } from "../hash";

/**
 * A resident.
 *
 * Drawn to the game's character sprite proportions — 20x34 in
 * `client/src/pixi/art.ts` — with the same trait slots layered in the same
 * order: jacket, collar, hair, visor, skin. The jacket palette is lifted from
 * `client/src/pixi/traits.ts`, so a character in this video could be an actual
 * token from the collection rather than something invented for a render.
 *
 * Everything is axis-aligned rects on a 20x34 grid. That keeps the sprite
 * genuinely pixel-art at any scale rather than vector shapes pretending.
 */

export const CHAR_W = 20;
export const CHAR_H = 34;

/** From TRAIT_VALUES.jacket in the game. */
export const JACKETS = [
  "#4F4DC4",
  "#2E7A52",
  "#A6402F",
  "#A8641F",
  "#5B54C9",
  "#DB7264",
  "#5B8DEF",
  "#E5A85C",
] as const;

const SKINS = ["#E8B98A", "#C68642", "#8D5524", "#F1D2B0"] as const;
const HAIRS = ["#2B2B33", "#5A3A22", "#8A8FA3", "#C9A227"] as const;

export interface Look {
  jacket: string;
  collar: string;
  hair: string;
  visor: string;
  skin: string;
}

/** Deterministic look from a seed string, so a crowd never reshuffles. */
export function lookFor(seed: string): Look {
  const n = (k: number) => mix(`${seed}#${k}`);
  return {
    jacket: JACKETS[Math.floor(n(1) * JACKETS.length)],
    collar: JACKETS[Math.floor(n(2) * JACKETS.length)],
    hair: HAIRS[Math.floor(n(3) * HAIRS.length)],
    visor: n(4) > 0.65 ? theme.colors.primary : "",
    skin: SKINS[Math.floor(n(5) * SKINS.length)],
  };
}

/**
 * One character, drawn into the caller's SVG at (sx, sy) on the ground plane.
 *
 * `bob` lifts the sprite without moving its shadow, which is what makes a dance
 * read as a dance rather than the whole figure sliding up and down.
 */
export const Person: React.FC<{
  sx: number;
  sy: number;
  look: Look;
  /** Pixels to lift the body off the ground. */
  bob?: number;
  /** Radians; leans the body left and right. */
  lean?: number;
  scale?: number;
  opacity?: number;
  /** Drawn behind the head — a tier badge for a holder. */
  halo?: string;
  /**
   * Flatten the whole figure to one colour.
   *
   * The trousers are deliberately not part of the trait set, so a "silhouette"
   * built by setting every trait to black still rendered grey legs. Anything
   * seen against a lit doorway needs the legs dark too.
   */
  silhouette?: string;
}> = ({ sx, sy, look, bob = 0, lean = 0, scale = 1, opacity = 1, halo, silhouette }) => {
  const w = CHAR_W * scale;
  const h = CHAR_H * scale;
  const px = (n: number) => n * scale;

  return (
    <g opacity={opacity}>
      {/* Shadow stays on the ground while the body bobs. */}
      <ellipse cx={sx} cy={sy} rx={px(7)} ry={px(2.6)} fill="rgba(0,0,0,0.5)" />

      {halo && (
        <circle
          cx={sx}
          cy={sy - h + px(9) - bob}
          r={px(11)}
          fill="none"
          stroke={halo}
          strokeWidth={px(1.2)}
          opacity={0.75}
        />
      )}

      <g
        transform={`translate(${sx} ${sy - bob}) rotate(${(lean * 180) / Math.PI} 0 0)`}
      >
        {/* legs */}
        <rect x={-px(5)} y={-px(9)} width={px(4)} height={px(9)} fill={silhouette ?? "#22262f"} />
        <rect x={px(1)} y={-px(9)} width={px(4)} height={px(9)} fill={silhouette ?? "#1a1e26"} />
        {/* jacket */}
        <rect x={-px(6.5)} y={-px(21)} width={px(13)} height={px(12)} fill={look.jacket} />
        {/* the lit side, so the figure has form under club light */}
        {!silhouette && (
          <rect x={px(2)} y={-px(21)} width={px(4.5)} height={px(12)} fill="rgba(255,255,255,0.1)" />
        )}
        {/* collar */}
        <rect x={-px(6.5)} y={-px(21)} width={px(13)} height={px(3)} fill={look.collar} />
        {/* head */}
        <rect x={-px(4.5)} y={-px(30)} width={px(9)} height={px(9)} fill={look.skin} />
        {/* hair */}
        <rect x={-px(5)} y={-px(32)} width={px(10)} height={px(4)} fill={look.hair} />
        {look.visor && (
          <rect x={-px(4.5)} y={-px(27)} width={px(9)} height={px(2.5)} fill={look.visor} />
        )}
      </g>
    </g>
  );
};
