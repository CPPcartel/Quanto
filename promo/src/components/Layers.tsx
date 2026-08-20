import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { theme } from "../theme";

/**
 * The bottom and top of the five-layer stack.
 *
 * Order, bottom to top: BgMesh -> city -> graphics/type -> Grade -> Grain +
 * Vignette. A flat background is the single clearest tell of an unconsidered
 * render, so there isn't one anywhere in this project.
 */

/** Slow-drifting light behind the city. Never a flat fill. */
export const BgMesh: React.FC<{ intensity?: number }> = ({ intensity = 1 }) => {
  const frame = useCurrentFrame();
  const d1 = Math.sin(frame / 55) * 50;
  const d2 = Math.cos(frame / 70) * 40;
  return (
    <AbsoluteFill style={{ background: theme.colors.bg }}>
      {/* Dawn over the skyline — amber, low and wide. */}
      <div
        style={{
          position: "absolute",
          width: 1700,
          height: 1100,
          borderRadius: "50%",
          top: 420,
          left: -320 + d1,
          filter: "blur(70px)",
          opacity: intensity,
          background: `radial-gradient(circle, ${theme.colors.primary}30, transparent 62%)`,
        }}
      />
      {/* The chain layer, cooler, up high. */}
      <div
        style={{
          position: "absolute",
          width: 1200,
          height: 1200,
          borderRadius: "50%",
          top: -420,
          right: -300 - d2,
          filter: "blur(90px)",
          opacity: intensity,
          background: `radial-gradient(circle, ${theme.colors.accent}22, transparent 65%)`,
        }}
      />
    </AbsoluteFill>
  );
};

/**
 * A horizon line.
 *
 * The city floats on a dark plane; without a horizon the frame has no ground
 * and the towers read as stickers rather than buildings.
 */
export const Horizon: React.FC<{ y: number }> = ({ y }) => (
  <AbsoluteFill style={{ pointerEvents: "none" }}>
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        top: y,
        height: 1,
        background: `linear-gradient(90deg, transparent, ${theme.colors.primary}44 22%, ${theme.colors.primary}44 78%, transparent)`,
      }}
    />
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        top: y,
        height: 320,
        background: `linear-gradient(180deg, ${theme.colors.bg}00, ${theme.colors.bg}dd 62%, ${theme.colors.bg})`,
      }}
    />
  </AbsoluteFill>
);

/**
 * A scrim behind type that sits over the city.
 *
 * Without it the towers run straight through the headline and both become
 * unreadable — the single most common way a text-over-b-roll frame fails. It is
 * a gradient rather than a panel so the city still shows through at the edges
 * and the type does not look pasted on.
 */
export const Scrim: React.FC<{
  from: "top" | "bottom";
  /** Fraction of the frame the scrim covers. */
  size?: number;
  strength?: number;
}> = ({ from, size = 0.42, strength = 0.94 }) => (
  <AbsoluteFill
    style={{
      pointerEvents: "none",
      background: `linear-gradient(${from === "bottom" ? 0 : 180}deg,
        rgba(17,19,26,${strength}) 0%,
        rgba(17,19,26,${strength * 0.88}) ${size * 55}%,
        rgba(17,19,26,0) ${size * 100}%)`,
    }}
  />
);

/** Unifies the whole stack into one look. Above content, below grain. */
export const Grade: React.FC = () => (
  <AbsoluteFill style={{ pointerEvents: "none" }}>
    <AbsoluteFill
      style={{
        backgroundColor: theme.colors.primary,
        mixBlendMode: "soft-light",
        opacity: 0.2,
      }}
    />
    <AbsoluteFill
      style={{
        background:
          "linear-gradient(180deg, rgba(0,0,0,0.22), transparent 26%, transparent 70%, rgba(0,0,0,0.34))",
      }}
    />
  </AbsoluteFill>
);

/** Procedural grain — no asset file, and it flickers like film. */
export const Grain: React.FC = () => {
  const frame = useCurrentFrame();
  const noise = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='220' height='220'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/%3E%3C/filter%3E%3Crect width='220' height='220' filter='url(%23n)' opacity='0.5'/%3E%3C/svg%3E")`;
  return (
    <AbsoluteFill
      style={{
        pointerEvents: "none",
        backgroundImage: noise,
        backgroundSize: "220px",
        backgroundPosition: `${(frame * 7) % 220}px ${(frame * 13) % 220}px`,
        opacity: 0.055,
        // Dark theme: overlay keeps the grain visible without muddying blacks.
        mixBlendMode: "overlay",
      }}
    />
  );
};

/** Topmost layer. */
export const Vignette: React.FC = () => (
  <AbsoluteFill
    style={{
      pointerEvents: "none",
      background:
        "radial-gradient(ellipse at center, transparent 52%, rgba(0,0,0,0.4) 100%)",
    }}
  />
);

/**
 * Scanlines.
 *
 * The game renders at nearest-neighbour with a CRT-ish bloom, and this is what
 * carries that across to a video that is otherwise vector-clean. Very low
 * opacity: at 1x it reads as texture, not as an effect.
 */
export const Scanlines: React.FC = () => (
  <AbsoluteFill
    style={{
      pointerEvents: "none",
      opacity: 0.055,
      background:
        "repeating-linear-gradient(180deg, rgba(255,255,255,0.9) 0px, rgba(255,255,255,0.9) 1px, transparent 1px, transparent 4px)",
      mixBlendMode: "overlay",
    }}
  />
);
