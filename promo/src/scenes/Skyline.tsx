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
import { BgMesh, Horizon, Scrim } from "../components/Layers";
import { Entrance, Eyebrow, WordReveal, useExit } from "../components/Motion";
import { City, frameDistrict } from "../components/City";
import { TOWERS, HERO } from "../data";

/**
 * SKYLINE — the pull-back.
 *
 * One tower becomes a district. The shot frames Tech Row, which is where NVDA
 * actually stands in the game, so this is geographically continuous with the
 * hook: the camera pulls back from the same tile and the neighbours fill in
 * around it.
 *
 * The whole city is deliberately NOT the shot. The four districts ring a
 * central plaza, so a frame wide enough for all of them is mostly empty plaza —
 * true to the layout and unreadable at 1080 across.
 */

export const Skyline: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const exit = useExit(12);

  // Where the camera ends up: Tech Row filling the upper half of the frame.
  const shot = React.useMemo(
    () => frameDistrict("tech", { frameW: width, frameH: height, fill: 0.94, centerYPct: 0.36 }),
    [width, height]
  );

  // Where it starts: tight on the hero tile, matching the hook's last frame.
  const heroStart = { x: HERO ? 1440 : 0, y: shot.center.y - 120 };

  const pull = interpolate(frame, [0, 74], [0, 1], {
    easing: theme.ease.out,
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const scale = interpolate(pull, [0, 1], [shot.scale * 3.1, shot.scale]);
  const camX = interpolate(pull, [0, 1], [heroStart.x, shot.center.x]);
  const camY = interpolate(pull, [0, 1], [heroStart.y, shot.center.y]);

  // Never fully static once it has settled.
  const drift = Math.sin(frame / 34) * 4;

  return (
    <AbsoluteFill style={{ ...exit }}>
      <BgMesh />

      <AbsoluteFill>
        <City
          width={width}
          height={height}
          raiseAt={0}
          stagger={1.5}
          center={{ x: camX, y: camY + drift }}
          scale={scale}
          lit={1}
        />
      </AbsoluteFill>

      <Horizon y={shot.groundY} />

      {/* Type sits on scrims, never straight over the towers. */}
      <Scrim from="top" size={0.3} strength={0.9} />
      <Scrim from="bottom" size={0.46} strength={0.95} />

      <AbsoluteFill
        style={{
          alignItems: "center",
          justifyContent: "flex-start",
          // Proportional so the square cut composes too.
          paddingTop: height * 0.099,
        }}
      >
        <Entrance delay={52} rise={28}>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 12,
            }}
          >
            {/* Names the source, not the district — the shot is Tech Row but
                the count is the whole city, and pairing them would read as a
                claim that Tech Row alone has 38 feeds. */}
            <Eyebrow color={theme.colors.textDim}>Live on Robinhood Chain</Eyebrow>
            <TowerCount />
          </div>
        </Entrance>
      </AbsoluteFill>

      <AbsoluteFill
        style={{
          alignItems: "center",
          justifyContent: "flex-end",
          paddingBottom: height * 0.125,
        }}
      >
        <WordReveal
          text="Every building. A different ticker."
          delay={60}
          per={3}
          gap={18}
          hero={["ticker."]}
          style={{
            fontFamily: fontFamilies.display,
            fontWeight: 800,
            fontSize: 80,
            lineHeight: 1.04,
            letterSpacing: "-0.035em",
            color: theme.colors.text,
            maxWidth: 880,
            textAlign: "center",
          }}
        />

        <div
          style={{
            display: "flex",
            gap: 12,
            marginTop: 32,
            flexWrap: "wrap",
            justifyContent: "center",
            maxWidth: 960,
          }}
        >
          {DISTRICT_CHIPS.map((d, i) => (
            <Entrance key={d.name} delay={80 + i * 5} rise={20} from={0.9}>
              <Chip name={d.name} color={d.color} />
            </Entrance>
          ))}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

const DISTRICT_CHIPS = [
  { name: "Tech Row", color: theme.colors.district.tech },
  { name: "Crypto Alley", color: theme.colors.district.crypto },
  { name: "Moonshot Mile", color: theme.colors.district.moonshot },
  { name: "The Index", color: theme.colors.district.index },
];

const Chip: React.FC<{ name: string; color: string }> = ({ name, color }) => (
  <div
    style={{
      display: "flex",
      alignItems: "center",
      gap: 9,
      padding: "10px 18px",
      borderRadius: 999,
      background: "rgba(24, 27, 36, 0.9)",
      border: `1px solid ${color}55`,
    }}
  >
    <span
      style={{ width: 9, height: 9, borderRadius: "50%", background: color, flex: "none" }}
    />
    <span
      style={{
        fontFamily: fontFamilies.mono,
        fontSize: 23,
        fontWeight: 700,
        color: theme.colors.textDim,
      }}
    >
      {name}
    </span>
  </div>
);

/** Counts to the real number of feeds, not a round one. */
const TowerCount: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = spring({
    frame: frame - 54,
    fps,
    config: { damping: 30, stiffness: 55, mass: 1 },
  });
  const n = Math.round(interpolate(p, [0, 1], [0, TOWERS.length]));
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 15 }}>
      <span
        style={{
          fontFamily: fontFamilies.mono,
          fontVariantNumeric: "tabular-nums",
          fontSize: 96,
          fontWeight: 800,
          color: theme.colors.primary,
          textShadow: `0 0 50px ${theme.colors.glow}`,
          lineHeight: 1,
        }}
      >
        {n}
      </span>
      <span
        style={{
          fontFamily: fontFamilies.display,
          fontSize: 38,
          fontWeight: 700,
          color: theme.colors.text,
          letterSpacing: "-0.02em",
        }}
      >
        live price feeds
      </span>
    </div>
  );
};
