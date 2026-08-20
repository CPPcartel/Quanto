import React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { theme } from "../theme";
import { fontFamilies } from "../fonts";

/**
 * A mechanic card.
 *
 * Every system in the game gets explained the same way in this cut: a card that
 * looks like the game's own HUD, next to the thing it is describing. Landscape
 * is what makes that possible — there is room for the city and the explanation
 * side by side, so nothing has to cover anything.
 *
 * The styling is lifted from `client/src/styles.css`: the same panel fill,
 * the same 1px border, the same mono eyebrow. A card that looked like a generic
 * slide would break the illusion that you are watching the product.
 */

export const Panel: React.FC<{
  eyebrow: string;
  title: string;
  body?: string;
  accent?: string;
  delay?: number;
  width?: number;
  children?: React.ReactNode;
}> = ({ eyebrow, title, body, accent = theme.colors.primary, delay = 0, width = 620, children }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = spring({ frame: frame - delay, fps, config: theme.spring.smooth });

  return (
    <div
      style={{
        width,
        display: "flex",
        flexDirection: "column",
        gap: 16,
        padding: "30px 34px",
        borderRadius: 14,
        background: "rgba(17, 19, 26, 0.96)",
        border: `1px solid ${accent}44`,
        boxShadow: `0 40px 90px -24px rgba(0,0,0,0.9), 0 0 60px -30px ${accent}`,
        opacity: p,
        transform: `translateX(${interpolate(p, [0, 1], [44, 0])}px) scale(${interpolate(
          p,
          [0, 1],
          [0.97, 1]
        )})`,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
        <span
          style={{
            width: 9,
            height: 9,
            borderRadius: "50%",
            background: accent,
            flex: "none",
            boxShadow: `0 0 14px ${accent}`,
          }}
        />
        <span
          style={{
            fontFamily: fontFamilies.mono,
            fontSize: 21,
            fontWeight: 700,
            letterSpacing: "0.2em",
            textTransform: "uppercase",
            color: accent,
          }}
        >
          {eyebrow}
        </span>
      </div>

      <h2
        style={{
          margin: 0,
          fontFamily: fontFamilies.display,
          fontWeight: 800,
          fontSize: 52,
          lineHeight: 1.06,
          letterSpacing: "-0.035em",
          color: theme.colors.text,
          textWrap: "balance",
        }}
      >
        {title}
      </h2>

      {body && (
        <p
          style={{
            margin: 0,
            fontFamily: fontFamilies.display,
            fontWeight: 500,
            fontSize: 26,
            lineHeight: 1.45,
            color: theme.colors.textDim,
          }}
        >
          {body}
        </p>
      )}

      {children}
    </div>
  );
};

/** A labelled figure inside a card. Numbers are always mono and tabular. */
export const Stat: React.FC<{
  label: string;
  value: string;
  accent?: string;
  delay?: number;
}> = ({ label, value, accent, delay = 0 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = spring({ frame: frame - delay, fps, config: theme.spring.snappy });
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 5,
        opacity: p,
        transform: `translateY(${interpolate(p, [0, 1], [14, 0])}px)`,
      }}
    >
      <span
        style={{
          fontFamily: fontFamilies.mono,
          fontSize: 17,
          fontWeight: 500,
          letterSpacing: "0.14em",
          textTransform: "uppercase",
          color: theme.colors.textFaint,
          whiteSpace: "nowrap",
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontFamily: fontFamilies.mono,
          fontVariantNumeric: "tabular-nums",
          fontSize: 34,
          fontWeight: 800,
          lineHeight: 1,
          color: accent ?? theme.colors.text,
        }}
      >
        {value}
      </span>
    </div>
  );
};

/** A row of stats with a consistent rhythm. */
export const StatRow: React.FC<{
  items: { label: string; value: string; accent?: string }[];
  delay?: number;
}> = ({ items, delay = 0 }) => (
  <div style={{ display: "flex", gap: 40, marginTop: 4 }}>
    {items.map((s, i) => (
      <Stat key={s.label} {...s} delay={delay + i * 4} />
    ))}
  </div>
);

/**
 * A progress bar.
 *
 * Used for CHARGE and for the shift sweep. Deliberately square-ended and 1px
 * bordered — a rounded, gradient-filled bar would look like a web component
 * rather than a readout in this game's HUD.
 */
export const Bar: React.FC<{
  value: number;
  accent?: string;
  height?: number;
  label?: string;
}> = ({ value, accent = theme.colors.primary, height = 14, label }) => (
  <div style={{ display: "flex", flexDirection: "column", gap: 8, width: "100%" }}>
    {label && (
      <span
        style={{
          fontFamily: fontFamilies.mono,
          fontSize: 17,
          letterSpacing: "0.14em",
          textTransform: "uppercase",
          color: theme.colors.textFaint,
        }}
      >
        {label}
      </span>
    )}
    <div
      style={{
        width: "100%",
        height,
        border: `1px solid ${theme.colors.textFaint}66`,
        background: "rgba(0,0,0,0.4)",
      }}
    >
      <div
        style={{
          width: `${Math.max(0, Math.min(1, value)) * 100}%`,
          height: "100%",
          background: accent,
          boxShadow: `0 0 16px ${accent}`,
        }}
      />
    </div>
  </div>
);
