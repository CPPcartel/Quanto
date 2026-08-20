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
import { Entrance, Eyebrow } from "../components/Motion";
import { City, frameDistrict } from "../components/City";

/**
 * CTA — one action, calm.
 *
 * The city sinks to the bottom third and dims so the wordmark has somewhere to
 * sit. After four scenes of movement this one is deliberately the stillest:
 * contrast is what makes a hold feel like a landing rather than a stall.
 *
 * One glowing element only — the name.
 */

export const CTA: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();

  const shot = React.useMemo(
    () => frameDistrict("tech", { frameW: width, frameH: height, fill: 1.05, centerYPct: 0.74 }),
    [width, height]
  );

  /**
   * The wordmark is sized to the frame, not typed in as a number.
   *
   * At 104px "QUANTO" is about 970px wide and touched both edges of a
   * 1080 frame — the first cut did exactly that. Deriving the size from the
   * character count keeps it inside the margins whatever the name is.
   */
  const TITLE = "QUANTO";
  const SIDE_MARGIN = 80;
  // Archivo 800 at -0.045em averages ~0.56em per character.
  const titleSize = Math.min(width * 0.13, (width - SIDE_MARGIN * 2) / (TITLE.length * 0.56));

  const settle = interpolate(frame, [0, 40], [0, 1], {
    easing: theme.ease.out,
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const scale = interpolate(settle, [0, 1], [shot.scale * 1.1, shot.scale]);
  const drift = Math.sin(frame / 40) * 4;


  return (
    <AbsoluteFill>
      <BgMesh />

      {/* City pushed low and dimmed — it is the backdrop now, not the subject. */}
      <AbsoluteFill
        style={{
          alignItems: "center",
          justifyContent: "center",
          // Dimmed, not erased. At 0.55 with lit 0.55 on top the city read as a
          // watermark; it should look like a city at night behind the name.
          opacity: interpolate(settle, [0, 1], [1, 0.78]),
        }}
      >
        <City
          width={width}
          height={height}
          raiseAt={-200}
          stagger={0}
          center={{ x: shot.center.x, y: shot.center.y + drift }}
          scale={scale}
          showTiles={false}
          lit={0.85}
        />
      </AbsoluteFill>

      <Horizon y={shot.groundY} />
      {/* Light enough that the city still reads behind the type. The first cut
          used 0.9 over 72% of the frame and erased it completely. */}
      <Scrim from="bottom" size={0.55} strength={0.82} />
      <Scrim from="top" size={0.34} strength={0.72} />

      <AbsoluteFill
        style={{
          alignItems: "center",
          justifyContent: "center",
          paddingBottom: height * 0.198,
        }}
      >
        <Entrance delay={4} rise={26}>
          <Eyebrow color={theme.colors.textDim} style={{ fontSize: 28 }}>
            Now in open beta
          </Eyebrow>
        </Entrance>

        {/* The wordmark. The only glowing thing in the frame. */}
        <div
          style={{
            display: "flex",
            marginTop: 30,
            fontFamily: fontFamilies.display,
            fontWeight: 800,
            fontSize: titleSize,
            letterSpacing: "-0.045em",
            lineHeight: 1,
            color: theme.colors.text,
            textShadow: `0 0 70px ${theme.colors.glow}`,
          }}
        >
          {TITLE.split("").map((ch, i) => {
            const p = spring({
              frame: frame - 14 - i * 1.6,
              fps,
              config: theme.spring.snappy,
            });
            return (
              <span
                key={i}
                style={{
                  display: "inline-block",
                  whiteSpace: "pre",
                  opacity: p,
                  transform: `translateY(${interpolate(p, [0, 1], [40, 0])}px)`,
                }}
              >
                {ch}
              </span>
            );
          })}
        </div>

        <Entrance delay={42} rise={22}>
          <p
            style={{
              margin: "26px 0 0",
              fontFamily: fontFamilies.display,
              fontSize: 36,
              fontWeight: 600,
              color: theme.colors.textDim,
              letterSpacing: "-0.01em",
              textAlign: "center",
              // Narrow enough that it breaks after "skyline", not after "the".
              maxWidth: 640,
              lineHeight: 1.32,
            }}
          >
            The skyline is the market.
          </p>
        </Entrance>

        <Entrance delay={54} rise={20} from={0.93}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 14,
              marginTop: 40,
              padding: "18px 34px",
              borderRadius: 999,
              border: `1px solid ${theme.colors.primary}66`,
              // Opaque. At 0.86 alpha this sat directly on the amber glow behind
              // the wordmark and the label became unreadable.
              background: theme.colors.bg,
              boxShadow: "0 20px 50px -12px rgba(0,0,0,0.9)",
            }}
          >
            <span
              style={{
                width: 11,
                height: 11,
                borderRadius: "50%",
                background: theme.colors.up,
                flex: "none",
              }}
            />
            <span
              style={{
                fontFamily: fontFamilies.mono,
                fontSize: 30,
                fontWeight: 700,
                color: theme.colors.text,
                letterSpacing: "0.02em",
                whiteSpace: "nowrap",
              }}
            >
              Built on Robinhood Chain
            </span>
          </div>
        </Entrance>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
