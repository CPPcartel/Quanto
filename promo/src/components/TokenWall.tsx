import React from "react";
import { Img, interpolate, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { theme } from "../theme";
import { fontFamilies } from "../fonts";
import collection from "../collection.json";

/**
 * A wall of real tokens, moving.
 *
 * These are the actual PNGs out of `collection/out/images` — the same bytes that
 * go to OpenSea — not mockups drawn for a video. The manifest in
 * `src/collection.json` is written by `collection/` alongside the copy, so the
 * id on a tile and the art on it cannot drift apart. That exact drift is a bug
 * the collection build already shipped once: a contact sheet that re-rolled its
 * own traits and showed tokens which existed nowhere.
 *
 * Three rows, alternating direction at different speeds. Opposing motion is what
 * makes a wall read as depth rather than as one sheet sliding past, and it is
 * the cheapest way to make a static grid feel like footage.
 */

const TIER_COLOR: Record<string, string> = {
  Resident: "#8A92A6",
  Landlord: "#22E8FF",
  Penthouse: "#FFD166",
};

export interface RowSpec {
  /** Pixels per frame. Negative runs right to left. */
  speed: number;
  /** Tile edge, in pixels. */
  size: number;
  /** Where the row sits vertically. */
  top: number;
  /** Offset into the token list, so rows never show the same tile side by side. */
  offset: number;
  opacity?: number;
}

export const TokenRow: React.FC<RowSpec & { beatPhase?: number }> = ({
  speed,
  size,
  top,
  offset,
  opacity = 1,
  beatPhase = 0,
}) => {
  const frame = useCurrentFrame();
  const { width } = useVideoConfig();

  const gap = size * 0.12;
  const pitch = size + gap;
  /** Enough tiles to cover the frame twice, so the loop never shows an edge. */
  const count = Math.ceil((width * 2) / pitch) + 2;

  // Wrap on the pitch so the strip is seamless however long it runs.
  const shift = ((frame * speed) % pitch) - pitch;

  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        top,
        height: size,
        width: width * 2,
        display: "flex",
        gap,
        transform: `translateX(${shift}px)`,
        opacity,
      }}
    >
      {Array.from({ length: count }, (_, i) => {
        const token = collection.wall[(i + offset) % collection.wall.length];
        // Tiles breathe on the beat, offset along the row so it ripples.
        const pop = 1 + Math.max(0, Math.sin((beatPhase - i * 0.08) * Math.PI * 2)) * 0.05;
        const accent = TIER_COLOR[token.tier] ?? TIER_COLOR.Resident;
        return (
          <div
            key={i}
            style={{
              width: size,
              height: size,
              flex: "none",
              position: "relative",
              borderRadius: size * 0.06,
              overflow: "hidden",
              border: `1px solid ${accent}55`,
              transform: `scale(${pop})`,
              boxShadow:
                token.tier === "Penthouse"
                  ? `0 0 ${size * 0.3}px -${size * 0.08}px ${accent}`
                  : undefined,
            }}
          >
            <Img
              src={staticFile(token.file)}
              style={{
                width: "100%",
                height: "100%",
                display: "block",
                // Pixel art: never let the browser smooth it.
                imageRendering: "pixelated",
              }}
            />
          </div>
        );
      })}
    </div>
  );
};

/**
 * One token, big, with its real traits listed beside it.
 *
 * Traits come from the token's own metadata, so what is written next to the art
 * is what an owner sees on OpenSea.
 */
export const HeroToken: React.FC<{
  index: number;
  size: number;
  showTraits?: boolean;
  delay?: number;
}> = ({ index, size, showTraits = true, delay = 0 }) => {
  const frame = useCurrentFrame();
  const hero = collection.heroes[index % collection.heroes.length];
  const accent = TIER_COLOR[hero.tier] ?? TIER_COLOR.Resident;

  const p = interpolate(frame - delay, [0, 14], [0, 1], {
    easing: theme.ease.out,
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const float = Math.sin(frame / 26) * 5;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 44,
        opacity: p,
        transform: `translateY(${interpolate(p, [0, 1], [40, float])}px) scale(${interpolate(
          p,
          [0, 1],
          [0.9, 1]
        )})`,
      }}
    >
      <div
        style={{
          width: size,
          height: size,
          flex: "none",
          borderRadius: 18,
          overflow: "hidden",
          border: `2px solid ${accent}`,
          boxShadow: `0 0 90px -20px ${accent}, 0 40px 90px -30px rgba(0,0,0,0.9)`,
        }}
      >
        <Img
          src={staticFile(hero.file)}
          style={{ width: "100%", height: "100%", display: "block", imageRendering: "pixelated" }}
        />
      </div>

      {showTraits && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 330 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 14 }}>
            <span
              style={{
                fontFamily: fontFamilies.display,
                fontSize: 46,
                fontWeight: 800,
                letterSpacing: "-0.03em",
                color: accent,
              }}
            >
              {hero.tier}
            </span>
            <span
              style={{
                fontFamily: fontFamilies.mono,
                fontSize: 24,
                color: theme.colors.textFaint,
              }}
            >
              #{hero.id}
            </span>
          </div>

          {hero.tower && (
            <span
              style={{
                fontFamily: fontFamilies.mono,
                fontSize: 22,
                fontWeight: 700,
                letterSpacing: "0.1em",
                color: theme.colors.primary,
              }}
            >
              TOP FLOOR · {hero.tower}
            </span>
          )}

          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, maxWidth: 380 }}>
            {hero.traits.map((t, i) => {
              const tp = interpolate(frame - delay - 10 - i * 3, [0, 10], [0, 1], {
                easing: theme.ease.out,
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
              });
              return (
                <span
                  key={t.slot}
                  style={{
                    display: "inline-flex",
                    gap: 7,
                    padding: "7px 13px",
                    borderRadius: 6,
                    background: "rgba(17,19,26,0.9)",
                    border: `1px solid ${theme.colors.textFaint}44`,
                    fontFamily: fontFamilies.mono,
                    fontSize: 18,
                    opacity: tp,
                    transform: `translateY(${interpolate(tp, [0, 1], [10, 0])}px)`,
                  }}
                >
                  <span style={{ color: theme.colors.textFaint }}>{t.slot}</span>
                  <span style={{ color: theme.colors.text, fontWeight: 700 }}>{t.value}</span>
                </span>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
