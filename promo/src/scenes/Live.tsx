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
import { BgMesh, Horizon, Scrim } from "../components/Layers";
import { Entrance, WordReveal, useExit } from "../components/Motion";
import { City, PLACED, frameDistrict, type Placed } from "../components/City";
import { mix as hash } from "../hash";

/**
 * LIVE — the payoff, and the biggest move in the video.
 *
 * Everything before this has been static proof. Here the skyline actually
 * moves: each tower breathes at its own rate and phase, seeded from its symbol,
 * so the city ripples instead of pumping in unison. A city where every building
 * pulses on the same beat looks like a screensaver; one where they drift apart
 * looks like a market.
 *
 * Then a volatility storm hits one tower — the game's real mechanic — and that
 * tower alone surges. It is the only glowing element in the frame.
 */

/**
 * The storm lands on a Tech Row name, because Tech Row is the shot.
 * MU is the tallest tower in the district, so the surge is unmissable.
 */
const STORM_SYMBOL = "MU";

export const Live: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const exit = useExit(12);

  /** Storm ramps in, holds, and does not release — the scene cuts on the peak. */
  const storm = spring({ frame: frame - 40, fps, config: theme.spring.smooth });

  const heightScale = React.useCallback(
    (t: Placed, f: number) => {
      // Per-tower phase and rate, so the skyline ripples rather than pumping.
      const phase = hash(t.symbol) * Math.PI * 2;
      const rate = 26 + hash(t.symbol + "r") * 22;
      const amp = 0.035 + hash(t.symbol + "a") * 0.05;
      const breathe = 1 + Math.sin(f / rate + phase) * amp;
      if (t.symbol !== STORM_SYMBOL) return breathe;
      // The storm tower surges well past everything around it.
      const surge = spring({ frame: f - 40, fps, config: theme.spring.bouncy });
      return breathe + surge * 1.15;
    },
    [fps]
  );

  const shot = React.useMemo(
    () => frameDistrict("tech", { frameW: width, frameH: height, fill: 0.94, centerYPct: 0.36 }),
    [width, height]
  );

  const drift = Math.sin(frame / 34) * 4;
  // A slow push in through the scene — the frame is never quite still.
  const scale = interpolate(frame, [0, 87], [shot.scale, shot.scale * 1.1], {
    easing: theme.ease.inOut,
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill style={{ ...exit }}>
      <BgMesh />

      <AbsoluteFill>
        <City
          width={width}
          height={height}
          // Already built in the previous scene: no re-raise, just live motion.
          raiseAt={-200}
          stagger={0}
          center={{ x: shot.center.x, y: shot.center.y + drift }}
          scale={scale}
          heightScale={heightScale}
          showTiles={false}
        />
      </AbsoluteFill>

      <Horizon y={shot.groundY} />
      <StormMarker progress={storm} shot={shot} scale={scale} drift={drift} />
      <Scrim from="bottom" size={0.44} strength={0.95} />

      <AbsoluteFill
        style={{
          alignItems: "center",
          justifyContent: "flex-end",
          paddingBottom: height * 0.146,
        }}
      >
        <WordReveal
          text="The market moves. The city moves."
          delay={6}
          per={2}
          gap={17}
          hero={["moves."]}
          style={{
            fontFamily: fontFamilies.display,
            fontWeight: 800,
            fontSize: 78,
            lineHeight: 1.05,
            letterSpacing: "-0.035em",
            color: theme.colors.text,
            maxWidth: 860,
            textAlign: "center",
          }}
        />
        <Entrance delay={48} rise={22} from={0.92}>
          <span
            style={{
              display: "block",
              marginTop: 26,
              fontFamily: fontFamilies.mono,
              fontSize: 27,
              fontWeight: 500,
              color: theme.colors.textDim,
              letterSpacing: "0.05em",
              textAlign: "center",
            }}
          >
            Volatility storm · {STORM_SYMBOL}
          </span>
        </Entrance>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

/**
 * The storm ring over the surging tower.
 *
 * Positioned from the same projection the city uses, so it stays on the roof
 * as the camera pushes in rather than being pinned by eye.
 */
const StormMarker: React.FC<{
  progress: number;
  shot: ReturnType<typeof frameDistrict>;
  scale: number;
  drift: number;
}> = ({ progress, shot, scale, drift }) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();

  const tower = PLACED.find((p) => p.symbol === STORM_SYMBOL);
  if (!tower) return null;

  const surged = tower.height * (1 + progress * 1.15);
  const roofPx = surged * theme.iso.PIXELS_PER_HEIGHT_UNIT;

  // Screen position: city space -> viewBox -> pixels. Uses the same camera the
  // City svg does, so the ring stays on the roof as the shot pushes in.
  const cx = width / 2 + (tower.sx - shot.center.x) * scale;
  const cy = height / 2 + (tower.sy - roofPx - (shot.center.y + drift)) * scale;

  const pulse = 1 + Math.sin(frame / 7) * 0.09;
  const opacity = interpolate(progress, [0, 0.35], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <div
      style={{
        position: "absolute",
        left: cx,
        top: cy,
        width: 0,
        height: 0,
        opacity,
      }}
    >
      {/* A soft core behind the rings — this is the one glowing element in the
          frame, so it has to carry from a scrolling thumbnail. */}
      <div
        style={{
          position: "absolute",
          left: -150,
          top: -150,
          width: 300,
          height: 300,
          borderRadius: "50%",
          background: `radial-gradient(circle, ${theme.colors.primary}44, transparent 68%)`,
          filter: "blur(14px)",
        }}
      />
      {/* Three rings, offset in phase, so the marker reads as energy not a dot. */}
      {[0, 1, 2].map((i) => {
        const r = 38 + i * 30;
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: -r,
              top: -r,
              width: r * 2,
              height: r * 2,
              borderRadius: "50%",
              border: `${i === 0 ? 3 : 2}px solid ${theme.colors.primary}`,
              opacity: (0.9 - i * 0.28) * (1 / pulse),
              transform: `scale(${pulse + i * 0.06})`,
              boxShadow: i === 0 ? `0 0 60px ${theme.colors.primary}` : undefined,
            }}
          />
        );
      })}
    </div>
  );
};
