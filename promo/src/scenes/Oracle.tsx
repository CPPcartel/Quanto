import React from "react";
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { theme } from "../theme";
import { fontFamilies } from "../fonts";
import { BgMesh } from "../components/Layers";
import { Entrance, Eyebrow, useExit } from "../components/Motion";
import { TOWERS } from "../data";

/**
 * ORACLE — the proof.
 *
 * The claim in scene one only lands if the numbers are real, so this scene is
 * the receipt: a scrolling tape of every feed with its actual price, and the
 * chain it comes from named on screen.
 *
 * The tape scrolls on an ease-in-out rather than a constant rate. Constant
 * scroll is the standard ticker treatment and it reads as a widget; an eased
 * one reads as a camera move across a board.
 */

const ROW_H = 92;
/** Enough rows to fill the frame twice, so the loop never shows an edge. */
const VISIBLE = 12;

export const Oracle: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const exit = useExit(12);

  // Sorted by price so the tape has a shape — the eye reads the ramp.
  const rows = React.useMemo(
    () => [...TOWERS].sort((a, b) => b.price - a.price),
    []
  );

  const scroll = interpolate(frame, [10, 104], [0, ROW_H * (rows.length - VISIBLE)], {
    easing: theme.ease.inOut,
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill style={{ ...exit }}>
      <BgMesh intensity={0.75} />

      {/* The tape. */}
      <AbsoluteFill
        style={{
          alignItems: "center",
          justifyContent: "flex-start",
          paddingTop: height * 0.156,
          maskImage:
            "linear-gradient(180deg, transparent, #000 12%, #000 78%, transparent)",
          WebkitMaskImage:
            "linear-gradient(180deg, transparent, #000 12%, #000 78%, transparent)",
        }}
      >
        <div
          style={{
            width: 880,
            transform: `translateY(${-scroll}px)`,
          }}
        >
          {rows.map((t, i) => (
            <Row key={t.symbol} index={i} symbol={t.symbol} label={t.label} price={t.price} changePct={t.changePct} />
          ))}
        </div>
      </AbsoluteFill>

      {/* The source, stated plainly over the tape. */}
      <AbsoluteFill
        style={{
          alignItems: "center",
          justifyContent: "flex-end",
          paddingBottom: height * 0.13,
        }}
      >
        <Entrance delay={14} rise={34}>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 20,
              padding: "34px 54px",
              borderRadius: 18,
              // Solid, not translucent. The first pass used 0.93 alpha plus a
              // backdrop blur; the blur does not apply over sibling content in
              // this renderer, so the tape read straight through the headline.
              background: theme.colors.bg,
              border: `1px solid ${theme.colors.accent}44`,
              boxShadow: "0 40px 90px -20px rgba(0,0,0,0.85)",
            }}
          >
            <Eyebrow color={theme.colors.accent}>Chainlink oracles</Eyebrow>
            <span
              style={{
                fontFamily: fontFamilies.display,
                fontWeight: 800,
                fontSize: 70,
                letterSpacing: "-0.035em",
                color: theme.colors.text,
                lineHeight: 1.05,
                textAlign: "center",
              }}
            >
              Read straight off chain
            </span>
            {/* Equal columns. Ragged widths made "GAS TO WATCH" sit over "$0"
                with the label three times wider than the value it labels. */}
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <Stat label="Chain" value="4663" />
              <Stat label="Feeds" value={String(TOWERS.length)} />
              <Stat label="Gas to watch" value="$0" hero />
            </div>
          </div>
        </Entrance>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

const Stat: React.FC<{ label: string; value: string; hero?: boolean }> = ({
  label,
  value,
  hero,
}) => (
  <div
    style={{
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      gap: 8,
      minWidth: 210,
    }}
  >
    <span
      style={{
        fontFamily: fontFamilies.mono,
        fontSize: 20,
        fontWeight: 500,
        letterSpacing: "0.14em",
        whiteSpace: "nowrap",
        textTransform: "uppercase",
        color: theme.colors.textFaint,
      }}
    >
      {label}
    </span>
    <span
      style={{
        fontFamily: fontFamilies.mono,
        fontVariantNumeric: "tabular-nums",
        fontSize: 40,
        fontWeight: 800,
        color: hero ? theme.colors.primary : theme.colors.text,
        textShadow: hero ? `0 0 40px ${theme.colors.glow}` : undefined,
        lineHeight: 1,
      }}
    >
      {value}
    </span>
  </div>
);

const Row: React.FC<{
  index: number;
  symbol: string;
  label: string;
  price: number;
  changePct: number;
}> = ({ index, symbol, label, price, changePct }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  // Rows arrive staggered, so the board assembles instead of appearing.
  const p = spring({
    frame: frame - 4 - index * 1.4,
    fps,
    config: theme.spring.snappy,
  });
  const up = changePct >= 0;

  return (
    <div
      style={{
        height: ROW_H,
        display: "grid",
        gridTemplateColumns: "170px 1fr 230px 150px",
        alignItems: "center",
        gap: 20,
        borderBottom: "1px solid rgba(58, 63, 78, 0.5)",
        opacity: p,
        transform: `translateX(${interpolate(p, [0, 1], [40, 0])}px)`,
      }}
    >
      <span
        style={{
          fontFamily: fontFamilies.mono,
          fontSize: 40,
          fontWeight: 800,
          color: theme.colors.text,
        }}
      >
        {symbol}
      </span>
      <span
        style={{
          fontFamily: fontFamilies.display,
          fontSize: 30,
          fontWeight: 400,
          color: theme.colors.textFaint,
          overflow: "hidden",
          whiteSpace: "nowrap",
          textOverflow: "ellipsis",
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontFamily: fontFamilies.mono,
          fontVariantNumeric: "tabular-nums",
          fontSize: 38,
          fontWeight: 700,
          color: theme.colors.text,
          textAlign: "right",
        }}
      >
        ${price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
      </span>
      <span
        style={{
          fontFamily: fontFamilies.mono,
          fontVariantNumeric: "tabular-nums",
          fontSize: 32,
          fontWeight: 700,
          color: up ? theme.colors.up : theme.colors.down,
          textAlign: "right",
        }}
      >
        {up ? "+" : ""}
        {changePct.toFixed(2)}%
      </span>
    </div>
  );
};
