import React from "react";
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { theme, worldToScreen } from "../theme";
import { fontFamilies } from "../fonts";
import { BgMesh, Horizon } from "../components/Layers";
import { Counter, Eyebrow, WordReveal, useExit } from "../components/Motion";
import { Tower, Tile } from "../components/Tower";
import { HERO } from "../data";

/**
 * HOOK — one tower, one price, one idea.
 *
 * The whole pitch is legible in the first second: a building rises and a real
 * price counts up beside it at the same rate. Nothing is explained yet, because
 * the mechanism explains itself faster than a sentence can.
 *
 * Movement starts on frame 2. On X this autoplays muted in a scrolling feed, so
 * a still first half-second is a lost impression.
 */

/**
 * Camera zoom for this shot.
 *
 * The game's raw projection puts a 30-unit tower at ~165px — correct when you
 * are looking at a whole city, far too small when it is the only thing on
 * screen. The scale is derived from the hero's real height rather than dialled
 * in by eye, so a different hero would frame itself the same way.
 */
const TARGET_ROOF_PX = 720;
const RAW_PH = HERO.height * theme.iso.PIXELS_PER_HEIGHT_UNIT;
const ZOOM = TARGET_ROOF_PX / RAW_PH;

export const Hook: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const exit = useExit(12);

  // The tower rises. Heavy spring so it lands rather than wobbles.
  const rise = spring({ frame: frame - 2, fps, config: theme.spring.tower });

  const { sx, sy } = worldToScreen(0, 0);
  /** Ground line, in screen pixels. Everything else hangs off this. */
  const groundY = height * 0.72;

  // A slow push in as it grows — the frame is never completely static.
  const push = interpolate(rise, [0, 1], [1.06, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const zoom = ZOOM * push;

  return (
    <AbsoluteFill style={{ ...exit }}>
      <BgMesh />
      <Horizon y={groundY} />

      {/* The tower. viewBox is sized so `zoom` behaves like a camera. */}
      <AbsoluteFill>
        <svg
          width={width}
          height={height}
          viewBox={`${sx - width / 2 / zoom} ${sy - groundY / zoom} ${width / zoom} ${height / zoom}`}
          style={{ overflow: "visible" }}
          shapeRendering="crispEdges"
        >
          <Tile sx={sx} sy={sy} opacity={rise} />
          <Tower
            id={HERO.symbol}
            sx={sx}
            sy={sy}
            height={HERO.height}
            changePct={HERO.changePct}
            accent={theme.colors.district.tech}
            lit={rise}
            grow={rise}
          />
        </svg>
      </AbsoluteFill>

      {/* Price tag: beside the roof, never over it. */}
      <PriceTag rise={rise} groundY={groundY} zoom={zoom} />

      <AbsoluteFill
        style={{
          alignItems: "center",
          justifyContent: "flex-end",
          // Proportional, not pixels. Fixed paddings were tuned against a
          // 1920-tall frame and collapsed the square cut into a pile.
          paddingBottom: height * 0.104,
        }}
      >
        <WordReveal
          text="This building is a stock price"
          delay={34}
          per={3}
          gap={18}
          hero={["price"]}
          style={{
            fontFamily: fontFamilies.display,
            fontWeight: 800,
            fontSize: 92,
            lineHeight: 1.02,
            letterSpacing: "-0.035em",
            color: theme.colors.text,
            maxWidth: 900,
            textAlign: "center",
          }}
        />
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

/**
 * The label that rides the roof up.
 *
 * It tracks the same spring the tower does, so the number and the height are
 * visibly the same quantity — which is the entire claim of the product. It sits
 * to the right of the roof with a short leader line, because a tag centred on
 * the roof hides the thing it is labelling.
 */
const PriceTag: React.FC<{
  rise: number;
  groundY: number;
  zoom: number;
}> = ({ rise, groundY, zoom }) => {
  const frame = useCurrentFrame();
  const { width } = useVideoConfig();

  // The roof, in screen pixels: the same projection the SVG uses.
  const top = groundY - RAW_PH * rise * zoom - 40;
  const appear = interpolate(rise, [0.14, 0.52], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const float = Math.sin(frame / 26) * 3;

  // Half the tile's on-screen width, so the leader starts clear of the roof.
  const offset = (theme.iso.TILE_W / 2) * zoom + 26;

  return (
    <div
      style={{
        position: "absolute",
        left: width / 2 + offset,
        top,
        display: "flex",
        alignItems: "center",
        gap: 14,
        opacity: appear,
        transform: `translateY(${interpolate(appear, [0, 1], [22, float])}px)`,
      }}
    >
      <div style={{ width: 48, height: 1, background: `${theme.colors.primary}88` }} />
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 8,
          padding: "16px 26px",
          background: "rgba(24, 27, 36, 0.92)",
          border: `1px solid ${theme.colors.primary}66`,
          borderRadius: 10,
          boxShadow: `0 0 60px ${theme.colors.glow}`,
        }}
      >
        <Eyebrow color={theme.colors.textDim} style={{ fontSize: 22 }}>
          NVDA
        </Eyebrow>
        <Counter
          to={HERO.price}
          delay={4}
          decimals={2}
          prefix="$"
          style={{
            fontSize: 60,
            fontWeight: 800,
            color: theme.colors.primary,
            letterSpacing: "-0.02em",
            lineHeight: 1,
          }}
        />
      </div>
    </div>
  );
};
