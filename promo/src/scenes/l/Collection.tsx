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
import { BgMesh } from "../../components/Layers";
import { TokenRow, HeroToken } from "../../components/TokenWall";
import { useExit } from "../../components/Motion";
import collection from "../../collection.json";

/**
 * COLLECTION — the wall.
 *
 * The hardest-moving scene in the cut and the only one that is pure b-roll: real
 * token art, three rows deep, running in opposite directions with the middle row
 * biggest and fastest. Nothing is explained here. It is a texture shot whose
 * whole job is to make 3,338 feel like a number you can see.
 *
 * Then it stops. The rows blur out, one token lands centre frame at full size
 * with its real traits, and the noise resolves into a single object. A wall that
 * never resolves is wallpaper; a wall that resolves is a reveal.
 */

const BPM = 128;

export const Collection: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const exit = useExit(10);

  const beatPhase = (frame / fps) * (BPM / 60);

  /** The scene turns at this frame: the wall gives way to one token. */
  const TURN = 62;

  /**
   * Rows decelerate into the turn rather than cutting.
   * A hard stop on moving art reads as a dropped frame; a fast ease-out reads as
   * a camera settling on something.
   */
  const roll = interpolate(frame, [TURN - 10, TURN + 12], [1, 0], {
    easing: theme.ease.out,
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  /** The wall fades and blurs back as the hero comes forward. */
  const recede = interpolate(frame, [TURN - 6, TURN + 14], [0, 1], {
    easing: theme.ease.inOut,
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const rowsIn = spring({ frame, fps, config: { damping: 18, stiffness: 120, mass: 0.8 } });

  return (
    <AbsoluteFill style={{ ...exit, background: theme.colors.bg }}>
      <BgMesh intensity={0.6} />

      {/* The wall. */}
      <AbsoluteFill
        style={{
          opacity: rowsIn * interpolate(recede, [0, 1], [1, 0.16]),
          filter: `blur(${recede * 14}px)`,
          transform: `scale(${interpolate(recede, [0, 1], [1, 1.08])})`,
        }}
      >
        <TokenRow
          speed={-7 * roll}
          size={190}
          top={height * 0.06}
          offset={0}
          opacity={0.55}
          beatPhase={beatPhase}
        />
        <TokenRow
          speed={11 * roll}
          size={280}
          top={height * 0.33}
          offset={17}
          beatPhase={beatPhase}
        />
        <TokenRow
          speed={-6 * roll}
          size={190}
          top={height * 0.76}
          offset={31}
          opacity={0.55}
          beatPhase={beatPhase}
        />
      </AbsoluteFill>

      {/* Edge falloff, so the rows run off the frame instead of stopping at it. */}
      <AbsoluteFill
        style={{
          pointerEvents: "none",
          background:
            "linear-gradient(90deg, rgba(17,19,26,1) 0%, rgba(17,19,26,0) 16%, rgba(17,19,26,0) 84%, rgba(17,19,26,1) 100%)",
        }}
      />

      {/* The count, over the wall, before the turn. */}
      <AbsoluteFill
        style={{
          alignItems: "center",
          justifyContent: "center",
          opacity: interpolate(frame, [TURN - 14, TURN - 2], [1, 0], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
        }}
      >
        <Count />
      </AbsoluteFill>

      {/* The turn: one token, real traits. */}
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
        <div style={{ opacity: recede }}>
          <HeroToken index={2} size={430} delay={TURN} />
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

/**
 * The supply, counted up.
 *
 * 3,338 is the real number in `collection/out/rarity.json`, not a round one.
 * A rounded supply is the first thing anybody checks.
 */
const Count: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const total = 3338;

  const p = spring({ frame: frame - 6, fps, config: { damping: 30, stiffness: 58, mass: 1 } });
  const n = Math.round(interpolate(p, [0, 1], [0, total]));

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 12,
        padding: "34px 64px",
        borderRadius: 18,
        background: "rgba(17,19,26,0.9)",
        border: `1px solid ${theme.colors.primary}44`,
        boxShadow: "0 40px 100px -30px rgba(0,0,0,0.95)",
        transform: `scale(${interpolate(p, [0, 1], [0.94, 1])})`,
      }}
    >
      <span
        style={{
          fontFamily: fontFamilies.mono,
          fontSize: 24,
          fontWeight: 700,
          letterSpacing: "0.26em",
          textTransform: "uppercase",
          color: theme.colors.textDim,
        }}
      >
        Quanto Residents
      </span>
      <span
        style={{
          fontFamily: fontFamilies.mono,
          fontVariantNumeric: "tabular-nums",
          fontSize: 132,
          fontWeight: 800,
          lineHeight: 1,
          color: theme.colors.primary,
          textShadow: `0 0 80px ${theme.colors.glow}`,
        }}
      >
        {n.toLocaleString("en-US")}
      </span>
      <span
        style={{
          fontFamily: fontFamilies.display,
          fontSize: 30,
          fontWeight: 600,
          color: theme.colors.textDim,
        }}
      >
        generated on-chain · {collection.wall.length} shown
      </span>
    </div>
  );
};
