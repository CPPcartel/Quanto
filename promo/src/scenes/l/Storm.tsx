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
import { Footage } from "../../components/Footage";
import { Panel } from "../../components/Panel";
import { useExit } from "../../components/Motion";
import { mix as hash } from "../../hash";

/**
 * STORM — the city reacting to real volatility.
 *
 * The tier ladder is the honest part of this game's economy and it goes on
 * screen unedited: calm 1.0x, normal 1.6x, hot 2.4x, extreme 3.5x, straight out
 * of `VOL_TIERS` in `server/src/game/economy.ts`. They are buckets, never a
 * continuous curve, so a payout reads as game balance rather than a derivative.
 *
 * Shards fall over the district during a storm — the same collectables the game
 * spawns — and every tower in shot starts breathing at its own rate.
 */

const TIERS = [
  { tier: "calm", mult: "1.0x", color: theme.colors.textFaint },
  { tier: "normal", mult: "1.6x", color: theme.colors.textDim },
  { tier: "hot", mult: "2.4x", color: theme.colors.primary },
  { tier: "extreme", mult: "3.5x", color: theme.colors.down },
] as const;

export const Storm: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const exit = useExit(10);

  /** The storm ramps in over the first second and stays. */
  const storm = spring({ frame: frame - 8, fps, config: theme.spring.smooth });

  // A hand-held shudder at the peak. Small — enough to feel, not to notice.
  const shake = storm * Math.sin(frame * 1.7) * 3;

  return (
    <AbsoluteFill style={{ ...exit }}>
      {/* Real footage, shaken. The towers in shot are the game's own. */}
      <AbsoluteFill style={{ left: shake, top: shake * 0.4 }}>
        <Footage shot="skyline" from={26} rate={0.62} scaleFrom={1.05} scaleTo={1.16} />
      </AbsoluteFill>

      <Shards progress={storm} />

      <AbsoluteFill
        style={{
          pointerEvents: "none",
          background:
            "linear-gradient(270deg, rgba(17,19,26,0.97) 0%, rgba(17,19,26,0.92) 32%, rgba(17,19,26,0) 60%)",
        }}
      />

      <div
        style={{ position: "absolute", right: 88, top: "50%", transform: "translateY(-50%)" }}
      >
        <Panel
          eyebrow="Volatility storm"
          title="When the tape moves, the city pays more"
          body="Realised volatility puts the whole city in a tier. Payouts step between four brackets — never a sliding curve, so it stays game balance and not a derivative."
          accent={theme.colors.down}
          delay={4}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 6 }}>
            {TIERS.map((t, i) => (
              <TierRow key={t.tier} {...t} delay={14 + i * 6} active={i === 3} />
            ))}
          </div>
        </Panel>
      </div>
    </AbsoluteFill>
  );
};

const TierRow: React.FC<{
  tier: string;
  mult: string;
  color: string;
  delay: number;
  active: boolean;
}> = ({ tier, mult, color, delay, active }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = spring({ frame: frame - delay, fps, config: theme.spring.snappy });
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "9px 14px",
        border: `1px solid ${active ? color : `${theme.colors.textFaint}33`}`,
        background: active ? `${color}18` : "transparent",
        opacity: p,
        transform: `translateX(${interpolate(p, [0, 1], [22, 0])}px)`,
      }}
    >
      <span
        style={{
          fontFamily: fontFamilies.mono,
          fontSize: 21,
          fontWeight: 700,
          letterSpacing: "0.14em",
          textTransform: "uppercase",
          color: active ? color : theme.colors.textDim,
        }}
      >
        {tier}
      </span>
      <span
        style={{
          fontFamily: fontFamilies.mono,
          fontVariantNumeric: "tabular-nums",
          fontSize: 24,
          fontWeight: 800,
          color: active ? color : theme.colors.textDim,
        }}
      >
        {mult}
      </span>
    </div>
  );
};

/**
 * Storm shards.
 *
 * Deterministic positions and fall rates, so the same frame renders the same
 * shards every time. They drift as they fall rather than dropping straight —
 * straight-down particles read as rain, and this is supposed to read as loot.
 */
const Shards: React.FC<{ progress: number }> = ({ progress }) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();

  const shards = React.useMemo(
    () =>
      Array.from({ length: 22 }, (_, i) => ({
        x: hash(`sx${i}`) * width * 0.66,
        speed: 1.5 + hash(`sp${i}`) * 2.4,
        offset: hash(`of${i}`) * 800,
        size: 7 + hash(`sz${i}`) * 8,
        drift: (hash(`dr${i}`) - 0.5) * 40,
      })),
    [width]
  );

  return (
    <svg
      width={width}
      height={height}
      style={{ position: "absolute", inset: 0, overflow: "visible", pointerEvents: "none" }}
    >
      {shards.map((s, i) => {
        const y = ((s.offset + frame * s.speed * 5) % (height + 300)) - 150;
        const x = s.x + Math.sin(y / 90) * s.drift;
        const spin = frame * 2 + i * 40;
        const fade = interpolate(y, [height * 0.72, height * 0.92], [1, 0], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        });
        return (
          <g key={i} transform={`translate(${x} ${y}) rotate(${spin})`} opacity={progress * fade}>
            <polygon
              points={`0,${-s.size} ${s.size * 0.6},0 0,${s.size} ${-s.size * 0.6},0`}
              fill={theme.colors.primary}
              opacity={0.9}
            />
            <polygon
              points={`0,${-s.size} ${s.size * 0.6},0 0,${s.size} ${-s.size * 0.6},0`}
              fill="none"
              stroke="#fff"
              strokeWidth={1}
              opacity={0.5}
            />
          </g>
        );
      })}
    </svg>
  );
};
