import React from "react";
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { theme } from "../../theme";
import { fontFamilies } from "../../fonts";
import { Scrim } from "../../components/Layers";
import { Footage } from "../../components/Footage";
import { useExit } from "../../components/Motion";
import { TOWERS } from "../../data";

/**
 * SKYLINE — the real city, with the tape read off it.
 *
 * The plate is captured game footage, so the camera move is the game's own.
 * Earlier versions projected price tags onto specific roofs using the generated
 * city's coordinates; that cannot work over footage, because the footage camera
 * is wherever the capture put it. Rather than fake an attachment that would
 * visibly slide off the wrong building, the prices arrive as HUD chips — which
 * is how the game shows them anyway.
 */

/** Four real feeds, from the same pull that built the city. */
const PICKS = ["NVDA", "BTC", "MU", "TSLA"] as const;

export const Skyline: React.FC = () => {
  const { height } = useVideoConfig();
  const exit = useExit(10);

  const rows = PICKS.map((s) => TOWERS.find((t) => t.symbol === s)!).filter(Boolean);

  return (
    <AbsoluteFill style={{ ...exit }}>
      {/* The city, as the game renders it. */}
      <Footage shot="skyline" from={8} rate={0.78} scaleFrom={1.02} scaleTo={1.11} />

      <Scrim from="bottom" size={0.34} strength={0.9} />
      <Scrim from="top" size={0.22} strength={0.75} />

      {/* Price chips, arriving on a stagger down the left. */}
      <div
        style={{
          position: "absolute",
          left: 84,
          top: "50%",
          transform: "translateY(-50%)",
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        {rows.map((t, i) => (
          <PriceChip key={t.symbol} {...t} delay={14 + i * 9} />
        ))}
      </div>

      <AbsoluteFill
        style={{
          alignItems: "center",
          justifyContent: "flex-end",
          paddingBottom: height * 0.07,
        }}
      >
        <span
          style={{
            fontFamily: fontFamilies.mono,
            fontSize: 24,
            fontWeight: 700,
            letterSpacing: "0.24em",
            textTransform: "uppercase",
            color: theme.colors.textDim,
          }}
        >
          {TOWERS.length} Chainlink feeds · Robinhood Chain · read live
        </span>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

const PriceChip: React.FC<{
  symbol: string;
  price: number;
  changePct: number;
  delay: number;
}> = ({ symbol, price, changePct, delay }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = spring({ frame: frame - delay, fps, config: theme.spring.snappy });
  const up = changePct >= 0;

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "110px 170px 130px",
        alignItems: "center",
        gap: 16,
        padding: "12px 20px",
        borderRadius: 8,
        background: "rgba(17,19,26,0.92)",
        border: `1px solid ${up ? theme.colors.up : theme.colors.down}55`,
        opacity: p,
        transform: `translateX(${interpolate(p, [0, 1], [-40, 0])}px)`,
        whiteSpace: "nowrap",
      }}
    >
      <span
        style={{
          fontFamily: fontFamilies.mono,
          fontSize: 26,
          fontWeight: 800,
          color: theme.colors.text,
        }}
      >
        {symbol}
      </span>
      <span
        style={{
          fontFamily: fontFamilies.mono,
          fontVariantNumeric: "tabular-nums",
          fontSize: 24,
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
          fontSize: 22,
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
