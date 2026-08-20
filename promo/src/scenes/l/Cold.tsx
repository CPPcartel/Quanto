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
import { Footage } from "../../components/Footage";
import { useExit } from "../../components/Motion";

/**
 * COLD OPEN — the claim, then the city, in under two seconds.
 *
 * No build, no logo, no easing in from black. The line slams on frame 2 and the
 * skyline rushes up under it on the downbeat. Anything gentler and the scroll
 * has already passed.
 *
 * The words arrive as blocks rather than a fade because a fade at this speed
 * just looks like a dropped frame.
 */

const LINE = ["EVERY", "BUILDING", "IS", "A", "LIVE", "PRICE"];

export const Cold: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const exit = useExit(10);

  // The city rushes up on the downbeat, from below the frame.
  const rush = spring({ frame: frame - 14, fps, config: { damping: 18, stiffness: 95, mass: 1 } });
  const cityY = interpolate(rush, [0, 1], [420, 0]);

  return (
    <AbsoluteFill style={{ ...exit, background: theme.colors.bg }}>
      <BgMesh intensity={rush} />

      {/* The real city, rushing up under the line. */}
      <AbsoluteFill style={{ transform: `translateY(${cityY}px)`, opacity: rush }}>
        <Footage shot="skyline" from={40} rate={1} scaleFrom={1.18} scaleTo={1.03} />
      </AbsoluteFill>

      {/* A hard wash that clears as the city lands, so the type reads first. */}
      <AbsoluteFill
        style={{
          background: theme.colors.bg,
          opacity: interpolate(rush, [0, 1], [0.92, 0.55]),
        }}
      />

      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            justifyContent: "center",
            gap: 22,
            maxWidth: 1500,
          }}
        >
          {LINE.map((word, i) => {
            // Blocks, not fades. Each word snaps in 2 frames after the last.
            const p = spring({
              frame: frame - 2 - i * 2,
              fps,
              config: { damping: 13, stiffness: 260, mass: 0.5 },
            });
            const isHero = word === "PRICE";
            return (
              <span
                key={word}
                style={{
                  display: "inline-block",
                  fontFamily: fontFamilies.display,
                  fontWeight: 800,
                  fontSize: 118,
                  letterSpacing: "-0.045em",
                  lineHeight: 1,
                  color: isHero ? theme.colors.primary : theme.colors.text,
                  textShadow: isHero ? `0 0 70px ${theme.colors.glow}` : undefined,
                  opacity: p,
                  transform: `translateY(${interpolate(p, [0, 1], [26, 0])}px) scale(${interpolate(
                    p,
                    [0, 1],
                    [1.14, 1]
                  )})`,
                }}
              >
                {word}
              </span>
            );
          })}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
