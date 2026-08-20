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
import { BgMesh, Scrim } from "../../components/Layers";
import { Footage } from "../../components/Footage";
import { Entrance, Eyebrow } from "../../components/Motion";

/**
 * CTA — the landing.
 *
 * After the club this is deliberately the calmest thing in the cut. The city
 * comes back, dimmed, the track pulls the top end out, and the name sits still
 * for nearly a second before the video ends. Contrast is what makes a hold feel
 * like an ending rather than a stall.
 *
 * One glowing element: the name.
 */

export const CTA: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();

  const settle = interpolate(frame, [0, 44], [0, 1], {
    easing: theme.ease.out,
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const TITLE = "QUANTO";
  const SIDE_MARGIN = 140;
  // Derived, so the name can never touch the frame edges. See the vertical cut.
  const titleSize = Math.min(width * 0.13, (width - SIDE_MARGIN * 2) / (TITLE.length * 0.56));

  return (
    <AbsoluteFill>
      <BgMesh />

      {/* The real city, settling behind the name. */}
      <AbsoluteFill style={{ opacity: interpolate(settle, [0, 1], [1, 0.72]) }}>
        <Footage shot="skyline" from={4} rate={0.81} scaleFrom={1.14} scaleTo={1.03} />
      </AbsoluteFill>

      <Scrim from="bottom" size={0.5} strength={0.8} />
      <Scrim from="top" size={0.4} strength={0.75} />

      <AbsoluteFill
        style={{
          alignItems: "center",
          justifyContent: "center",
          paddingBottom: height * 0.16,
        }}
      >
        <Entrance delay={4} rise={22}>
          <Eyebrow color={theme.colors.textDim} style={{ fontSize: 26 }}>
            Now in open beta
          </Eyebrow>
        </Entrance>

        <div
          style={{
            display: "flex",
            marginTop: 26,
            fontFamily: fontFamilies.display,
            fontWeight: 800,
            fontSize: titleSize,
            letterSpacing: "-0.05em",
            lineHeight: 1,
            color: theme.colors.text,
            textShadow: `0 0 90px ${theme.colors.glow}`,
          }}
        >
          {TITLE.split("").map((ch, i) => {
            const p = spring({
              frame: frame - 12 - i * 1.5,
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
                  transform: `translateY(${interpolate(p, [0, 1], [46, 0])}px)`,
                }}
              >
                {ch}
              </span>
            );
          })}
        </div>

        <Entrance delay={40} rise={20}>
          <p
            style={{
              margin: "26px 0 0",
              fontFamily: fontFamilies.display,
              fontSize: 40,
              fontWeight: 600,
              letterSpacing: "-0.01em",
              color: theme.colors.textDim,
              textAlign: "center",
            }}
          >
            The skyline is the market.
          </p>
        </Entrance>

        <Entrance delay={54} rise={18} from={0.94}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 14,
              marginTop: 34,
              padding: "16px 32px",
              borderRadius: 999,
              border: `1px solid ${theme.colors.primary}66`,
              background: theme.colors.bg,
              boxShadow: "0 20px 50px -12px rgba(0,0,0,0.9)",
            }}
          >
            <span
              style={{
                width: 10,
                height: 10,
                borderRadius: "50%",
                background: theme.colors.up,
                flex: "none",
              }}
            />
            <span
              style={{
                fontFamily: fontFamilies.mono,
                fontSize: 28,
                fontWeight: 700,
                color: theme.colors.text,
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
