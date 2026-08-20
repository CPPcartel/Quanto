import React from "react";
import { Img, interpolate, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { theme } from "../theme";
import { Person, lookFor } from "./Person";
import { mix } from "../hash";
import collection from "../collection.json";

/**
 * The Vault — the holders-only club.
 *
 * Built to the server's real lot: `CLUB = { x: -78, z: -26, half: 12 }` in
 * `server/src/config/parks.ts`, rendered with the same 12x12 dance floor and
 * four sweeping beams as `client/src/pixi/Club.ts`. It is open-topped for the
 * same reason it is in the game — the isometric camera has to see straight in,
 * and a roof would mean an interior mode nobody asked for.
 *
 * The floor is the point. Its colour comes from the market: green when the tape
 * is up, red when it is down, and the whole grid tightens and brightens as
 * volatility climbs. That is a thing only this game can do, so it is what the
 * shot is built around.
 */

/** The renderer's grid. */
const TILES = 12;
/** Half-extent of the lot, in world units. */
const HALF = 12;
const HW = theme.iso.TILE_W / 2;
const HH = theme.iso.TILE_H / 2;

/** World -> screen inside the club, relative to the lot centre. */
function local(x: number, z: number) {
  return {
    sx: ((x - z) / theme.iso.UNITS_PER_TILE) * HW,
    sy: ((x + z) / theme.iso.UNITS_PER_TILE) * HH,
  };
}

/** The lot's diamond, in screen space. */
const CORNERS = {
  n: local(-HALF, -HALF),
  e: local(HALF, -HALF),
  s: local(HALF, HALF),
  w: local(-HALF, HALF),
};

export const VAULT_BOUNDS = {
  minX: CORNERS.w.sx,
  maxX: CORNERS.e.sx,
  minY: CORNERS.n.sy,
  maxY: CORNERS.s.sy,
};

export interface VaultProps {
  /** 0..1 — the server's `clubIntensity`. Drives brightness and beat rate. */
  intensity: number;
  /** -1..1 — `marketMood`. Positive runs the floor green, negative red. */
  mood: number;
  /** Beats per minute, so the floor and the crowd share one clock. */
  bpm: number;
  /** How many residents are inside. */
  crowd?: number;
  /** 0..1 — reveals the venue. */
  reveal?: number;
}

/**
 * The dance floor.
 *
 * Each tile pulses on the beat with a phase offset taken from its distance to
 * the centre, so the light travels outward in rings instead of the whole grid
 * flashing at once. A grid that flashes in unison reads as a strobe; one that
 * travels reads as a room.
 */
const Floor: React.FC<VaultProps & { beatPhase: number }> = ({
  intensity,
  mood,
  beatPhase,
  reveal = 1,
}) => {
  const step = (HALF * 2) / TILES;
  const tiles: React.ReactNode[] = [];
  const hot = mood >= 0 ? theme.colors.up : theme.colors.down;

  for (let gx = 0; gx < TILES; gx++) {
    for (let gz = 0; gz < TILES; gz++) {
      const wx = -HALF + step * (gx + 0.5);
      const wz = -HALF + step * (gz + 0.5);
      const { sx, sy } = local(wx, wz);

      /**
        * A wave that sweeps the room, plus a slower ring from the centre.
        *
        * A pure centre-out ring leaves most of the grid dark on most frames —
        * the first cut of this scene had four lit tiles in a 144-tile floor. Two
        * offset waves keep the whole floor alive while still travelling.
        */
      const dist = Math.hypot(wx, wz) / (HALF * 1.42);
      const along = (wx + wz) / (HALF * 4) + 0.5;
      const wave =
        Math.sin((beatPhase - along * 1.1) * Math.PI * 2) * 0.65 +
        Math.sin((beatPhase * 0.5 - dist * 0.8) * Math.PI * 2) * 0.35;
      // Higher intensity tightens the pulse into a sharper hit.
      const sharp = Math.pow(Math.max(0, wave), 0.7 + intensity * 1.3);
      const lit = sharp * (0.55 + intensity * 0.45) * reveal;

      /**
        * Tiles are drawn at 86% so a dark grout line shows between them.
        * Full-size tiles butt up against each other and the floor renders as one
        * flat wash of colour — a lit rectangle, not a dance floor.
        */
      const halfW = (step / theme.iso.UNITS_PER_TILE) * HW * 0.86;
      const halfH = (step / theme.iso.UNITS_PER_TILE) * HH * 0.86;

      tiles.push(
        <polygon
          key={`${gx}-${gz}`}
          points={`${sx},${sy - halfH} ${sx + halfW},${sy} ${sx},${sy + halfH} ${sx - halfW},${sy}`}
          fill={hot}
          // Low floor, high ceiling: the contrast between a dark tile and a lit
          // one is what makes the pulse visible at all.
          opacity={0.05 + lit * 0.95}
        />
      );
    }
  }
  return <g>{tiles}</g>;
};

/** The low wall along one edge of the lot. */
const Wall: React.FC<{
  a: { sx: number; sy: number };
  b: { sx: number; sy: number };
  height: number;
  fill: string;
  accent: string;
}> = ({ a, b, height, fill, accent }) => (
  <g>
    <polygon
      points={`${a.sx},${a.sy - height} ${b.sx},${b.sy - height} ${b.sx},${b.sy} ${a.sx},${a.sy}`}
      fill={fill}
    />
    <line
      x1={a.sx}
      y1={a.sy - height}
      x2={b.sx}
      y2={b.sy - height}
      stroke={accent}
      strokeWidth={2}
      opacity={0.8}
    />
  </g>
);

export const Vault: React.FC<VaultProps> = (props) => {
  const { intensity, mood, bpm, crowd = 26, reveal = 1 } = props;
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  /** One clock for the floor, the beams and the dancers. */
  const beatPhase = (frame / fps) * (bpm / 60);
  const wallH = 34 * reveal;

  const hot = mood >= 0 ? theme.colors.up : theme.colors.down;

  /**
   * The crowd.
   *
   * Placed on a deterministic scatter inside the lot and sorted back to front,
   * because a dancer standing behind another has to be drawn first. Each bobs on
   * the beat with its own phase offset — a room where everyone jumps on exactly
   * the same frame looks like one sprite copied, which is precisely what it is.
   */
  const people = React.useMemo(() => {
    const out: {
      sx: number;
      sy: number;
      seed: string;
      phase: number;
      holder: boolean;
      token: (typeof collection.wall)[number];
    }[] = [];
    for (let i = 0; i < crowd; i++) {
      const seed = `vault-${i}`;
      const r1 = mix(`${seed}:x`);
      const r2 = mix(`${seed}:z`);
      const r3 = mix(`${seed}:p`);
      // Kept off the walls so nobody stands inside the geometry.
      const wx = -HALF * 0.88 + r1 * HALF * 1.76;
      const wz = -HALF * 0.88 + r2 * HALF * 1.76;
      const { sx, sy } = local(wx, wz);
      out.push({
        sx,
        sy,
        seed,
        phase: r3,
        holder: r3 > 0.72,
        // Which token this holder is wearing. Everyone in here is a holder, so
        // the badge is not decoration — it is the reason they got past the rope.
        token: collection.wall[Math.floor(mix(`${seed}:token`) * collection.wall.length)],
      });
    }
    return out.sort((a, b) => a.sy - b.sy);
  }, [crowd]);

  return (
    <g>
      {/* The lot floor, under the grid. */}
      <polygon
        points={`${CORNERS.n.sx},${CORNERS.n.sy} ${CORNERS.e.sx},${CORNERS.e.sy} ${CORNERS.s.sx},${CORNERS.s.sy} ${CORNERS.w.sx},${CORNERS.w.sy}`}
        fill="#0a0c12"
      />

      <Floor {...props} beatPhase={beatPhase} />

      {/* Back walls only. The two near edges stay open so the camera sees in. */}
      <Wall a={CORNERS.w} b={CORNERS.n} height={wallH} fill="#161a23" accent={hot} />
      <Wall a={CORNERS.n} b={CORNERS.e} height={wallH} fill="#1b1f2a" accent={hot} />

      {/*
        The DJ booth and its speaker stacks.

        Placed in SCREEN space against the two back walls, not in world space.
        Putting them at world (+/-x, z) and expecting them to flank the booth is
        wrong in an isometric projection: "left and right" of a world point map
        to two completely different screen corners, and the first cut put one
        speaker floating over the north wall and the other halfway down the east
        one. The diamond's own corners are the honest reference.
      */}
      <g opacity={reveal}>
        {(() => {
          const pulse = 0.55 + 0.45 * Math.abs(Math.sin(beatPhase * Math.PI));

          /** Booth, centred on the north corner and set inside the floor. */
          const bx = 0;
          const by = -58;
          const bw = 84;
          const bd = 22;
          const bh = 28 * reveal;

          /** Stacks, tucked along each back wall. Inside |x|/192 + |y|/96 <= 1. */
          const stacks = [
            { x: -136, y: -26 },
            { x: 136, y: -26 },
          ];

          return (
            <>
              {stacks.map((st) => {
                const sw = 20;
                const sh = 60 * reveal;
                return (
                  <g key={st.x}>
                    <polygon
                      points={`${st.x - sw},${st.y - sh} ${st.x + sw},${st.y - sh} ${st.x + sw},${st.y} ${st.x - sw},${st.y}`}
                      fill="#12161d"
                    />
                    <polygon
                      points={`${st.x - sw},${st.y - sh} ${st.x - sw + 10},${st.y - sh - 5} ${st.x + sw + 10},${st.y - sh - 5} ${st.x + sw},${st.y - sh}`}
                      fill="#1d222c"
                    />
                    <circle cx={st.x} cy={st.y - sh * 0.7} r={7} fill={hot} opacity={pulse} />
                    <circle cx={st.x} cy={st.y - sh * 0.34} r={5} fill={hot} opacity={pulse * 0.65} />
                  </g>
                );
              })}

              {/* front face */}
              <polygon
                points={`${bx - bw},${by - bh} ${bx + bw},${by - bh} ${bx + bw},${by} ${bx - bw},${by}`}
                fill="#1c202a"
              />
              {/* top */}
              <polygon
                points={`${bx - bw},${by - bh} ${bx - bw + bd},${by - bh - bd / 2} ${bx + bw + bd},${by - bh - bd / 2} ${bx + bw},${by - bh}`}
                fill="#262b38"
              />
              <line
                x1={bx - bw}
                y1={by - bh}
                x2={bx + bw}
                y2={by - bh}
                stroke={theme.colors.primary}
                strokeWidth={3}
                opacity={pulse}
              />
            </>
          );
        })()}
      </g>

      {people.map((p) => {
        // Bob on the beat, each dancer offset so the room is never in lockstep.
        const swing = Math.sin((beatPhase + p.phase) * Math.PI * 2);
        const bob = Math.max(0, swing) * (5 + intensity * 9);
        const lean = Math.sin((beatPhase * 0.5 + p.phase) * Math.PI * 2) * 0.07;
        const badge = 17;
        return (
          <g key={p.seed}>
            <Person
              sx={p.sx}
              sy={p.sy}
              look={lookFor(p.seed)}
              bob={bob}
              lean={lean}
              scale={0.86}
              opacity={reveal}
            />
            {/*
              The token, floating over its owner.
              This is the one place the collection and the club meet: the art you
              hold is the character in the room, and the badge says so without a
              line of copy.
            */}
            {p.holder && (
              <g opacity={reveal}>
                <rect
                  x={p.sx - badge / 2 - 1.5}
                  y={p.sy - 34 - bob - badge - 1.5}
                  width={badge + 3}
                  height={badge + 3}
                  rx={3}
                  fill={theme.colors.primary}
                  opacity={0.9}
                />
                <image
                  href={staticFile(p.token.file)}
                  x={p.sx - badge / 2}
                  y={p.sy - 34 - bob - badge}
                  width={badge}
                  height={badge}
                  preserveAspectRatio="xMidYMid slice"
                  style={{ imageRendering: "pixelated" }}
                />
              </g>
            )}
          </g>
        );
      })}
    </g>
  );
};

/**
 * The beams, drawn in screen space above the venue.
 *
 * Kept out of the SVG because they need blend modes and blur, which behave far
 * better as DOM layers than as SVG filters at this size.
 */
export const Beams: React.FC<{
  intensity: number;
  bpm: number;
  cx: number;
  cy: number;
  reveal?: number;
}> = ({ intensity, bpm, cx, cy, reveal = 1 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  const beatPhase = t * (bpm / 60);

  return (
    <div
      style={{
        position: "absolute",
        left: cx,
        top: cy,
        width: 0,
        height: 0,
        mixBlendMode: "screen",
        opacity: reveal,
      }}
    >
      {[0, 1, 2, 3].map((i) => {
        // Each beam sweeps at its own rate, so they cross rather than parade.
        const sweep = Math.sin(t * (0.55 + i * 0.17) + i * 1.9) * 34;
        const flare = 0.35 + 0.65 * Math.abs(Math.sin((beatPhase + i * 0.25) * Math.PI));
        const hue = i % 2 === 0 ? theme.colors.primary : theme.colors.accent;
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: -110 + (i - 1.5) * 240,
              top: -900,
              width: 220,
              height: 1150,
              transformOrigin: "50% 0%",
              transform: `rotate(${sweep}deg)`,
              background: `linear-gradient(180deg, ${hue}00 0%, ${hue}cc 34%, ${hue}33 78%, ${hue}00 100%)`,
              filter: "blur(18px)",
              opacity: (0.45 + intensity * 0.55) * flare,
            }}
          />
        );
      })}
    </div>
  );
};
