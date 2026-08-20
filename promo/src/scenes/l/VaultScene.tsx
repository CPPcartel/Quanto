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
import { Vault, Beams, VAULT_BOUNDS } from "../../components/Vault";
import { useExit } from "../../components/Motion";

/**
 * THE VAULT — the drop.
 *
 * Everything before this has been a build; the music opens up on the cut into
 * this scene and the room arrives all at once. It is the longest scene in the
 * cut and the only one that is allowed to just be a place rather than an
 * explanation.
 *
 * The floor is not decoration. Its colour is `marketMood` and its tightness is
 * `clubIntensity` — the same values the server computes from the same feeds the
 * skyline is built from. The room is literally reacting to the market, which is
 * the one thing no other club in any other game can claim.
 */

const BPM = 128;

export const VaultScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const exit = useExit(10);

  /** The room arrives fast — this is a drop, not a reveal. */
  const reveal = spring({ frame, fps, config: { damping: 16, stiffness: 150, mass: 0.7 } });

  /**
   * Intensity climbs through the scene, as it does during a Storm Rave.
   * The mood flips negative halfway: the floor runs green, then the tape turns
   * and it runs red, without the room stopping. That is the demo.
   */
  const intensity = interpolate(frame, [0, 60, 169], [0.45, 0.85, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const mood = frame < 96 ? 1 : -1;

  // A slow orbit-ish push. The camera is inside the room, so it moves gently.
  // Fills the frame: the club's diamond is 384 city units across, so ~3.6
  // puts it at roughly three quarters of a 1920 frame with room for the walls.
  const zoom = interpolate(frame, [0, 169], [3.5, 3.9], {
    easing: theme.ease.inOut,
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const sway = Math.sin(frame / 52) * 26;

  const cx = width / 2 + sway;
  const cy = height * 0.57;

  return (
    <AbsoluteFill style={{ ...exit, background: "#07080d" }}>
      {/* Room glow, keyed to the floor's colour. */}
      <AbsoluteFill
        style={{
          background: `radial-gradient(ellipse 70% 50% at 50% 62%, ${
            mood >= 0 ? theme.colors.up : theme.colors.down
          }26, transparent 70%)`,
          opacity: reveal * (0.5 + intensity * 0.5),
        }}
      />

      {/*
        The Vault as the game renders it — the lot, the dance floor, the light.
        The stylised room below is layered over it at low opacity so the beat
        still reads: the capture runs at the game's own tempo, not the track's.
      */}
      <AbsoluteFill style={{ opacity: reveal }}>
        <Footage shot="vault" from={10} rate={0.51} scaleFrom={1.04} scaleTo={1.16} />
      </AbsoluteFill>

      <Beams intensity={intensity} bpm={BPM} cx={cx} cy={cy - 40} reveal={reveal} />

      <AbsoluteFill>
        <svg
          width={width}
          height={height}
          // Held back so the captured room reads through it.
          style={{ overflow: "visible", opacity: 0.55 }}
          viewBox={`${-cx / zoom} ${(VAULT_BOUNDS.minY + VAULT_BOUNDS.maxY) / 2 - cy / zoom} ${
            width / zoom
          } ${height / zoom}`}
        >
          <Vault intensity={intensity} mood={mood} bpm={BPM} crowd={30} reveal={reveal} />
        </svg>
      </AbsoluteFill>

      {/* A hard flash on the very first frames — the drop landing. */}
      <AbsoluteFill
        style={{
          background: theme.colors.text,
          opacity: interpolate(frame, [0, 5], [0.5, 0], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
          pointerEvents: "none",
        }}
      />

      {/* A soft crown behind the title. The back wall's lit edge otherwise cuts
          straight through the wordmark. */}
      <AbsoluteFill
        style={{
          pointerEvents: "none",
          background:
            "linear-gradient(180deg, rgba(7,8,13,0.88) 0%, rgba(7,8,13,0.6) 42%, rgba(7,8,13,0) 78%)",
          height: height * 0.34,
        }}
      />

      <AbsoluteFill
        style={{
          alignItems: "center",
          justifyContent: "flex-start",
          paddingTop: height * 0.06,
          pointerEvents: "none",
        }}
      >
        <Title reveal={reveal} />
      </AbsoluteFill>

      <AbsoluteFill
        style={{
          alignItems: "center",
          justifyContent: "flex-end",
          paddingBottom: height * 0.06,
          pointerEvents: "none",
        }}
      >
        <FloorReadout mood={mood} intensity={intensity} />
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

const Title: React.FC<{ reveal: number }> = ({ reveal }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = spring({ frame: frame - 6, fps, config: theme.spring.snappy });
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 10,
        opacity: p * reveal,
        transform: `scale(${interpolate(p, [0, 1], [1.1, 1])})`,
      }}
    >
      <span
        style={{
          fontFamily: fontFamilies.display,
          fontSize: 104,
          fontWeight: 800,
          letterSpacing: "-0.05em",
          lineHeight: 1,
          color: theme.colors.text,
          textShadow: `0 0 90px ${theme.colors.glow}`,
        }}
      >
        THE VAULT
      </span>
      <span
        style={{
          fontFamily: fontFamilies.mono,
          fontSize: 23,
          fontWeight: 700,
          letterSpacing: "0.3em",
          textTransform: "uppercase",
          color: theme.colors.primary,
        }}
      >
        Holders only
      </span>
    </div>
  );
};

/**
 * The readout under the floor.
 *
 * Names the two numbers driving the room, because "the club reacts to the
 * market" is a claim and this is the receipt.
 */
const FloorReadout: React.FC<{ mood: number; intensity: number }> = ({ mood, intensity }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = spring({ frame: frame - 22, fps, config: theme.spring.smooth });
  const up = mood >= 0;

  const items = [
    { label: "Market mood", value: up ? "RISK ON" : "RISK OFF", color: up ? theme.colors.up : theme.colors.down },
    { label: "Intensity", value: `${Math.round(intensity * 100)}%`, color: theme.colors.primary },
    { label: "Tempo", value: `${Math.round(110 + 40 * intensity)} BPM`, color: theme.colors.text },
  ];

  return (
    <div
      style={{
        display: "flex",
        gap: 2,
        opacity: p,
        transform: `translateY(${interpolate(p, [0, 1], [22, 0])}px)`,
        borderRadius: 12,
        overflow: "hidden",
        border: `1px solid ${theme.colors.textFaint}44`,
        background: "rgba(7,8,13,0.9)",
      }}
    >
      {items.map((it) => (
        <div
          key={it.label}
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 6,
            padding: "16px 34px",
            minWidth: 230,
          }}
        >
          <span
            style={{
              fontFamily: fontFamilies.mono,
              fontSize: 17,
              letterSpacing: "0.16em",
              textTransform: "uppercase",
              color: theme.colors.textFaint,
            }}
          >
            {it.label}
          </span>
          <span
            style={{
              fontFamily: fontFamilies.mono,
              fontVariantNumeric: "tabular-nums",
              fontSize: 30,
              fontWeight: 800,
              color: it.color,
              lineHeight: 1,
            }}
          >
            {it.value}
          </span>
        </div>
      ))}
    </div>
  );
};
