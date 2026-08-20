import React from "react";
import { AbsoluteFill, Img, interpolate, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { theme } from "./theme";
import { mix } from "./hash";
import collection from "./collection.json";

/**
 * The collection image — a 1000x1000 looping GIF for the OpenSea drop.
 *
 * A 3x3 grid of real tokens where every tile slowly cross-dissolves into a
 * second token. Two things make it work as a collection image specifically:
 *
 *   It says what the collection *is* in one glance — nine faces, visibly
 *   varied, all in one house style. A single hero token says "here is one
 *   picture"; a grid says "here is a set".
 *
 *   It loops seamlessly. The dissolve is driven by a cosine over the full
 *   duration, so frame 0 and frame N are identical by construction rather than
 *   by trimming — a GIF that jumps on the wrap is the most obvious way to make
 *   a profile look cheap.
 *
 * No text. OpenSea prints the collection name beside this, and a second copy of
 * it inside the artwork just fights the first.
 */

const GRID = 3;

/** Two tokens per tile, taken from the manifest so ids and art cannot drift. */
const PAIRS = (() => {
  const pool = collection.wall;
  const out: { a: string; b: string; phase: number }[] = [];
  for (let i = 0; i < GRID * GRID; i++) {
    const a = pool[(i * 5 + 1) % pool.length];
    const b = pool[(i * 5 + 1 + Math.floor(pool.length / 2)) % pool.length];
    out.push({ a: a.file, b: b.file, phase: mix(`tile${i}`) });
  }
  return out;
})();

export const CollectionImage: React.FC = () => {
  const frame = useCurrentFrame();
  const { durationInFrames, width } = useVideoConfig();

  /** 0..1 across the loop. */
  const t = frame / durationInFrames;
  const gap = width * 0.014;
  const pad = width * 0.028;
  const cell = (width - pad * 2 - gap * (GRID - 1)) / GRID;

  return (
    <AbsoluteFill style={{ background: theme.colors.bg }}>
      {/* A low amber wash, so the grid sits in the game's light rather than on
          a flat black card. */}
      <AbsoluteFill
        style={{
          background: `radial-gradient(circle at 50% 62%, ${theme.colors.primary}22, transparent 68%)`,
        }}
      />

      <AbsoluteFill style={{ padding: pad }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: `repeat(${GRID}, ${cell}px)`,
            gridTemplateRows: `repeat(${GRID}, ${cell}px)`,
            gap,
          }}
        >
          {PAIRS.map((p, i) => {
            /**
             * Cosine, not a sawtooth: it starts and ends at the same value with
             * the same slope, so the wrap is invisible. The phase offset stops
             * all nine tiles turning over on the same frame.
             */
            const k = 0.5 - 0.5 * Math.cos((t + p.phase) * Math.PI * 2);
            return (
              <div
                key={i}
                style={{
                  position: "relative",
                  width: cell,
                  height: cell,
                  borderRadius: cell * 0.07,
                  overflow: "hidden",
                  border: `${Math.max(1, width * 0.0016)}px solid ${theme.colors.primary}33`,
                }}
              >
                <Img
                  src={staticFile(p.a)}
                  style={{ position: "absolute", inset: 0, width: "100%", height: "100%", imageRendering: "pixelated" }}
                />
                <Img
                  src={staticFile(p.b)}
                  style={{
                    position: "absolute",
                    inset: 0,
                    width: "100%",
                    height: "100%",
                    imageRendering: "pixelated",
                    opacity: k,
                  }}
                />
              </div>
            );
          })}
        </div>
      </AbsoluteFill>

      {/* Vignette, to stop the corners competing with the faces. */}
      <AbsoluteFill
        style={{
          background:
            "radial-gradient(ellipse at center, transparent 55%, rgba(0,0,0,0.5) 100%)",
        }}
      />
    </AbsoluteFill>
  );
};
