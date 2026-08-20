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
import { Person, lookFor } from "../../components/Person";
import { useExit } from "../../components/Motion";

/**
 * THE DOOR — the rope, and being turned away from it.
 *
 * This is the whole reason the club works as a perk. A venue nobody can see is
 * a private server; a venue you can walk up to, look into and be refused at is
 * a reason to want in. So the shot is from the street: light, silhouettes and
 * beams spilling out past a guest who cannot pass.
 *
 * Close and low. The first cut staged this wide, with 100px figures adrift in a
 * dark frame, and the moment that carries the whole idea was too small to read.
 * The characters are the subject here, so they are shot at the size of one.
 *
 * The refusal is the game's real behaviour: client and server run the identical
 * predicate, so a non-holder stops dead at the line rather than rubber-banding
 * through it. Here the walk simply stops — no bounce, no shove.
 */

const BPM = 128;

export const Door: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const exit = useExit(8);

  const groundY = height * 0.82;
  const wallX = width * 0.53;

  /** Approach, then the wall. */
  const walk = interpolate(frame, [4, 40], [0, 1], {
    easing: theme.ease.out,
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const guestX = interpolate(walk, [0, 1], [width * 0.08, wallX - 250]);
  const blocked = frame > 42;

  const deny = spring({ frame: frame - 42, fps, config: theme.spring.snappy });
  const ropeShake = blocked
    ? Math.sin((frame - 42) * 1.7) * Math.max(0, 7 - (frame - 42) * 0.45)
    : 0;

  const beatPhase = (frame / fps) * (BPM / 60);
  const pulse = 0.55 + 0.45 * Math.abs(Math.sin(beatPhase * Math.PI));

  return (
    <AbsoluteFill style={{ ...exit, background: "#0a0c12" }}>
      {/*
        The real street outside the club, from the capture.
        The rope, the guest and the refusal are drawn over it — the game does not
        stage a rejection on demand, so the moment is composited onto a real
        plate rather than invented wholesale.
      */}
      <Footage shot="door" from={8} rate={1.05} scaleFrom={1.08} scaleTo={1.22} dim={0.22} />

      {/* Light spilling out of the doorway and across the street. */}
      <div
        style={{
          position: "absolute",
          left: wallX - 420,
          top: -260,
          width: width,
          height: height + 520,
          background: `radial-gradient(ellipse 46% 60% at 40% 55%, ${theme.colors.primary}44, transparent 72%)`,
          filter: "blur(30px)",
          opacity: pulse,
        }}
      />

      {/* Beams over the roof — visible from the street, which is the point. */}
      {[0, 1, 2].map((i) => {
        const sweep = Math.sin(frame / 26 + i * 2.1) * 26;
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: wallX + 190 + i * 250,
              top: -520,
              width: 150,
              height: 900,
              transformOrigin: "50% 100%",
              transform: `rotate(${sweep}deg)`,
              background: `linear-gradient(180deg, ${
                i % 2 ? theme.colors.accent : theme.colors.primary
              }00 0%, ${i % 2 ? theme.colors.accent : theme.colors.primary}77 70%, transparent 100%)`,
              filter: "blur(22px)",
              mixBlendMode: "screen",
              opacity: 0.6 * pulse,
            }}
          />
        );
      })}

      {/*
        Foreground only.

        The plate already contains the real club — its glow, its beams, the lit
        floor. An earlier pass also drew a venue wall, a doorway and a city
        silhouette on top, which duplicated what the footage was already showing
        and read as a flat black slab pasted over a photograph. All that is left
        here is what the game cannot stage on demand: a rope, and somebody being
        turned away at it.
      */}
      <svg
        width={width}
        height={height}
        style={{ position: "absolute", inset: 0, overflow: "visible" }}
      >
        <defs>
          <linearGradient id="doorstreet" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#08090e" stopOpacity="0" />
            <stop offset="38%" stopColor="#07080c" stopOpacity="1" />
            <stop offset="100%" stopColor="#05060a" stopOpacity="1" />
          </linearGradient>
        </defs>

        {/* A near pavement, so the guest stands on something. */}
        <rect
          x={0}
          y={groundY - 90}
          width={width}
          height={height - groundY + 90}
          fill="url(#doorstreet)"
        />

        {/* Posts and rope. */}
        <g transform={`translate(${ropeShake} 0)`}>
          {[wallX - 120, wallX - 10].map((x) => (
            <g key={x}>
              <rect x={x - 8} y={groundY - 150} width={16} height={150} fill="#2a2f3c" />
              <rect
                x={x - 14}
                y={groundY - 164}
                width={28}
                height={16}
                fill={theme.colors.primary}
              />
            </g>
          ))}
          <path
            d={`M ${wallX - 120} ${groundY - 150} Q ${wallX - 65} ${groundY - 106} ${wallX - 10} ${groundY - 150}`}
            stroke={theme.colors.primary}
            strokeWidth={8}
            fill="none"
          />
        </g>

        {/* The guest, stopped at the line. */}
        <Person
          sx={guestX}
          sy={groundY}
          look={lookFor("guest-1")}
          scale={6.2}
          bob={blocked ? 0 : Math.abs(Math.sin(frame / 4.5)) * 9}
        />
      </svg>

      {/* The refusal, over the guest. */}
      <div
        style={{
          position: "absolute",
          left: guestX,
          top: groundY - 396,
          transform: `translateX(-50%) translateY(${interpolate(deny, [0, 1], [18, 0])}px)`,
          opacity: deny,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 12,
          whiteSpace: "nowrap",
        }}
      >
        <div
          style={{
            padding: "14px 26px",
            borderRadius: 8,
            background: "rgba(10,12,18,0.97)",
            border: `2px solid ${theme.colors.down}`,
            boxShadow: `0 0 40px -8px ${theme.colors.down}`,
          }}
        >
          <span
            style={{
              fontFamily: fontFamilies.mono,
              fontSize: 34,
              fontWeight: 800,
              color: theme.colors.down,
              letterSpacing: "0.08em",
            }}
          >
            HOLDERS ONLY
          </span>
        </div>
        <span
          style={{
            fontFamily: fontFamilies.mono,
            fontSize: 21,
            color: theme.colors.textDim,
          }}
        >
          Hold the coin or a Resident to pass
        </span>
      </div>

      <AbsoluteFill
        style={{
          alignItems: "flex-start",
          justifyContent: "flex-start",
          padding: `${height * 0.08}px 0 0 ${width * 0.05}px`,
          pointerEvents: "none",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <span
            style={{
              fontFamily: fontFamilies.mono,
              fontSize: 22,
              fontWeight: 700,
              letterSpacing: "0.26em",
              textTransform: "uppercase",
              color: theme.colors.primary,
            }}
          >
            The Vault
          </span>
          <span
            style={{
              fontFamily: fontFamilies.display,
              fontSize: 72,
              fontWeight: 800,
              letterSpacing: "-0.04em",
              lineHeight: 1.02,
              color: theme.colors.text,
              maxWidth: 640,
            }}
          >
            You can hear it from the street.
          </span>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
