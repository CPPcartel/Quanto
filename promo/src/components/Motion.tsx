import React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { theme } from "../theme";

/**
 * The motion primitives. Every entrance in the video goes through one of these,
 * which is what keeps the timing consistent between scenes.
 *
 * A lone fade is forbidden: everything here moves at least two properties.
 */

export const Entrance: React.FC<{
  delay?: number;
  rise?: number;
  from?: number;
  config?: { damping: number; stiffness: number; mass: number };
  style?: React.CSSProperties;
  children: React.ReactNode;
}> = ({ delay = 0, rise = 40, from = 0.94, config, style, children }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = spring({
    frame: frame - delay,
    fps,
    config: config ?? theme.spring.smooth,
  });
  return (
    <div
      style={{
        opacity: p,
        transform: `translateY(${interpolate(p, [0, 1], [rise, 0])}px) scale(${interpolate(
          p,
          [0, 1],
          [from, 1]
        )})`,
        ...style,
      }}
    >
      {children}
    </div>
  );
};

/**
 * Word-by-word reveal.
 *
 * `gap` is in pixels, not em. An em gap resolves against the PARENT font size —
 * usually 16px — which produces a near-zero space between 100px words and is
 * the most common way this pattern goes wrong.
 */
export const WordReveal: React.FC<{
  text: string;
  delay?: number;
  per?: number;
  gap?: number;
  /** Words rendered in the hero colour. Matched case-insensitively. */
  hero?: string[];
  style?: React.CSSProperties;
}> = ({ text, delay = 0, per = 3, gap = 16, hero = [], style }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const heroSet = new Set(hero.map((w) => w.toLowerCase()));

  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap,
        justifyContent: "center",
        ...style,
      }}
    >
      {text.split(" ").map((word, i) => {
        const p = spring({
          frame: frame - delay - i * per,
          fps,
          config: theme.spring.snappy,
        });
        const isHero = heroSet.has(word.toLowerCase().replace(/[^a-z0-9]/g, ""));
        return (
          <span
            key={i}
            style={{
              display: "inline-block",
              opacity: p,
              transform: `translateY(${interpolate(p, [0, 1], [34, 0])}px)`,
              color: isHero ? theme.colors.primary : undefined,
              textShadow: isHero ? `0 0 44px ${theme.colors.glow}` : undefined,
            }}
          >
            {word}
          </span>
        );
      })}
    </div>
  );
};

/**
 * A number that counts up.
 *
 * `tabular-nums` is not cosmetic here — without it every digit change resizes
 * the string and the whole row jitters, which reads as a bug.
 */
export const Counter: React.FC<{
  to: number;
  delay?: number;
  decimals?: number;
  prefix?: string;
  suffix?: string;
  style?: React.CSSProperties;
}> = ({ to, delay = 0, decimals = 2, prefix = "", suffix = "", style }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = spring({
    frame: frame - delay,
    fps,
    config: { damping: 30, stiffness: 55, mass: 1 },
  });
  const value = interpolate(p, [0, 1], [0, to]);
  return (
    <span
      style={{
        fontVariantNumeric: "tabular-nums",
        fontFamily: theme.fonts.mono,
        ...style,
      }}
    >
      {prefix}
      {value.toLocaleString("en-US", {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      })}
      {suffix}
    </span>
  );
};

/**
 * Scene exit — always faster than the entrance.
 *
 * Returns a style rather than wrapping, so a scene can hand it to whichever
 * element should carry the exit without adding a layer to the tree.
 */
export function useExit(lead = 12) {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const range: [number, number] = [durationInFrames - lead, durationInFrames - 2];
  const y = interpolate(frame, range, [0, -46], {
    easing: theme.ease.in,
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const opacity = interpolate(frame, range, [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return { transform: `translateY(${y}px)`, opacity };
}

/** Sin-wave micro-motion for anything on screen longer than two seconds. */
export function useBreathe(scaleAmt = 0.015, floatAmt = 3) {
  const frame = useCurrentFrame();
  return {
    scale: 1 + Math.sin(frame / 22) * scaleAmt,
    float: Math.sin(frame / 30) * floatAmt,
  };
}

/** A small uppercase label with tracking. Used for eyebrows and chips. */
export const Eyebrow: React.FC<{
  children: React.ReactNode;
  color?: string;
  style?: React.CSSProperties;
}> = ({ children, color = theme.colors.textDim, style }) => (
  <span
    style={{
      fontFamily: theme.fonts.mono,
      fontSize: 26,
      fontWeight: 700,
      letterSpacing: "0.22em",
      textTransform: "uppercase",
      color,
      ...style,
    }}
  >
    {children}
  </span>
);
