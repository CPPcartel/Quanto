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
import { Panel, StatRow } from "../../components/Panel";
import { Person, lookFor } from "../../components/Person";
import { useExit } from "../../components/Motion";

/**
 * CREWS — the takeover.
 *
 * The one mechanic in the game that is genuinely about other people: floors
 * pool, and whoever's crew holds the most of a tower controls it. So the shot
 * has to show a tower changing hands, not a diagram of one.
 *
 * The roof edge flipping to the crew's colour is the whole idea in one frame.
 * Yield does not move — it stays with whoever bought the floor — which is why
 * the card says so out loud.
 */

const CREW = { tag: "BULL", name: "The Bulls", color: "#22e8ff" };
const TARGET = "MU";

export const Crews: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const exit = useExit(10);

  /** The flip. One spring; the card's numbers ride it. */
  const flip = spring({ frame: frame - 44, fps, config: theme.spring.smooth });

  return (
    <AbsoluteFill style={{ ...exit }}>
      {/*
        Real street footage.

        An earlier cut projected a "[BULL] holds MU" banner onto a specific roof
        using the generated city's coordinates. That cannot survive over footage —
        the capture's camera is wherever the capture put it, so the banner would
        sit confidently on the wrong building. The takeover is told by the card
        and the crew standing in the street instead.
      */}
      <Footage shot="street" from={18} rate={0.7} scaleFrom={1.05} scaleTo={1.18} />

      <AbsoluteFill
        style={{
          pointerEvents: "none",
          background:
            "linear-gradient(270deg, rgba(17,19,26,0.97) 0%, rgba(17,19,26,0.92) 32%, rgba(17,19,26,0) 60%)",
        }}
      />

      <div
        style={{
          position: "absolute",
          right: 88,
          top: "50%",
          transform: "translateY(-50%)",
        }}
      >
        <Panel
          eyebrow="Crews"
          title="Pool floors. Take the tower."
          body="Your crew's floors count together. Hold the most of a tower and your colour goes on its roof — but the yield stays with whoever bought the floor."
          accent={CREW.color}
          delay={4}
        >
          <StatRow
            delay={16}
            items={[
              { label: "Crew", value: `[${CREW.tag}]`, accent: CREW.color },
              { label: "Pooled floors", value: Math.round(interpolate(flip, [0, 1], [11, 27])).toString() },
              { label: "Controls", value: flip > 0.5 ? TARGET : "—", accent: theme.colors.primary },
            ]}
          />
        </Panel>
      </div>

      {/*
        The crew, in the foreground.
        They stand on a near street band rather than floating over the skyline —
        the first cut had five figures hanging in mid-air over the rooftops,
        because an isometric city has no ground plane at that height.
      */}
      <AbsoluteFill style={{ pointerEvents: "none" }}>
        <svg width={width} height={height} style={{ overflow: "visible" }}>
          <defs>
            <linearGradient id="street" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#11131a" stopOpacity="0" />
              <stop offset="34%" stopColor="#0b0d13" stopOpacity="1" />
              <stop offset="100%" stopColor="#080a0f" stopOpacity="1" />
            </linearGradient>
          </defs>
          <rect x={0} y={height * 0.8} width={width} height={height * 0.2} fill="url(#street)" />
          <line
            x1={0}
            y1={height * 0.845}
            x2={width * 0.62}
            y2={height * 0.845}
            stroke={`${CREW.color}44`}
            strokeWidth={1}
          />

          {[0, 1, 2, 3, 4].map((i) => {
            const p = spring({
              frame: frame - 8 - i * 4,
              fps,
              config: theme.spring.snappy,
            });
            const x = width * 0.1 + i * 92;
            const y = height * 0.945;
            const bob = Math.max(0, Math.sin(frame / 11 + i * 1.3)) * 7;
            return (
              <Person
                key={i}
                sx={x}
                sy={y}
                look={{ ...lookFor(`crew-${i}`), collar: CREW.color }}
                bob={bob}
                scale={2.6}
                opacity={p}
                halo={i === 0 ? CREW.color : undefined}
              />
            );
          })}
        </svg>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
