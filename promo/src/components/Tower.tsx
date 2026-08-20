import React from "react";
import { theme } from "../theme";
import { mix } from "../hash";

/**
 * One isometric tower.
 *
 * Drawn as three SVG faces on the game's 2:1 grid — a 64x32 tile, exactly the
 * projection in `client/src/pixi/iso.ts`. Faces are shaded top > right > left,
 * which is the convention the game's sprites already use, so a frame of this
 * video and a screenshot of the game read as the same world.
 *
 * The two face transforms below are the only real geometry in the file. Each
 * maps a unit square onto a parallelogram so windows can be laid out as plain
 * axis-aligned rects in local space and land correctly skewed on the wall.
 *
 *   right face: (u, v) -> (sx + 32u,      sy + 16 - 16u - v)
 *   left  face: (u, v) -> (sx - 32 + 32u, sy + 16u - v)
 *
 * with u across the wall (0..1) and v up it (0..pixelHeight).
 */

/**
 * Footprint, in tiles.
 *
 * The game gives every ticker tower a 2x2 plot (`HERO_SPAN` in
 * client/src/pixi/City.ts) and its filler blocks 1x1. Drawing them all one tile
 * wide is what made the first pass look like a field of poles instead of a
 * skyline — the buildings were half their real width while the 26-unit gaps
 * between plots stayed full size.
 */
export const HERO_SPAN = 2;
export const FILLER_SPAN = 1;

export interface TowerProps {
  /** Screen position of the tile centre. */
  sx: number;
  sy: number;
  /** Footprint in tiles. 2 for a ticker tower, 1 for filler. */
  span?: number;
  /** Height in world units. Multiplied by the game's PIXELS_PER_HEIGHT_UNIT. */
  height: number;
  /** Drives window colour: up is green, down is red. Data, not decoration. */
  changePct: number;
  /** District accent, used on the roof edge only. */
  accent: string;
  /**
   * A crew taking the tower.
   *
   * Blends the roof edge from the district's accent to the crew's colour. The
   * roof is where control is shown in this game, so a takeover is literally a
   * colour change on the top of a building rather than a badge stuck over it.
   */
  claim?: { color: string; progress: number };
  /** 0..1 — how lit the windows are. */
  lit?: number;
  /** 0..1 — dims the whole tower for depth. */
  depth?: number;
  /** Scales the tower's rise without moving its footprint. */
  grow?: number;
}

export const Tower: React.FC<TowerProps & { id: string }> = ({
  id,
  sx,
  sy,
  span = HERO_SPAN,
  height,
  changePct,
  accent,
  claim,
  lit = 1,
  depth = 1,
  grow = 1,
}) => {
  const HW = (theme.iso.TILE_W / 2) * span;
  const HH = (theme.iso.TILE_H / 2) * span;
  const ph = Math.max(0, height * theme.iso.PIXELS_PER_HEIGHT_UNIT * grow);

  /**
   * A building with no height is not a short building — it is a bug.
   *
   * At `grow` near zero the roof collapses onto the ground diamond and renders
   * as a flat plate hanging in mid-air with no walls beneath it. Whole rows of
   * them appeared mid-rise in the first encode. Below a couple of pixels there
   * is nothing worth drawing, so draw nothing.
   */
  if (ph < 2) return null;

  /** Fade the last of the way in, so a tower emerges rather than pops. */
  const emerge = Math.min(1, ph / 26);

  // Ground diamond, then the same diamond lifted by the building's height.
  const roof = `${sx},${sy - HH - ph} ${sx + HW},${sy - ph} ${sx},${sy + HH - ph} ${sx - HW},${sy - ph}`;
  const rightFace = `${sx},${sy + HH - ph} ${sx + HW},${sy - ph} ${sx + HW},${sy} ${sx},${sy + HH}`;
  const leftFace = `${sx - HW},${sy - ph} ${sx},${sy + HH - ph} ${sx},${sy + HH} ${sx - HW},${sy}`;

  const up = changePct >= 0;
  const glass = up ? theme.colors.up : theme.colors.down;

  // Shading. The left wall is the shadow side.
  const o = depth * emerge;
  const topFill = `rgba(46, 52, 68, ${0.98 * o})`;
  const rightFill = `rgba(32, 37, 50, ${0.98 * o})`;
  const leftFill = `rgba(20, 24, 34, ${0.98 * o})`;

  // Window grid. Rows are spaced in pixels up the wall; the count follows the
  // building's height so a short tower does not get a squashed grid.
  const rows = Math.max(1, Math.floor(ph / 26));
  const cols = span > 1 ? 4 : 2;
  const windows: React.ReactNode[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const n = mix(`${id}:${r}:${c}`);
      // A quarter of the windows are always dark — a fully lit tower looks fake.
      if (n > 0.74) continue;
      const on = n < 0.62 * lit;
      const v = 16 + r * 26;
      const u = 0.12 + c * (0.76 / cols);
      windows.push(
        <rect
          key={`r${r}${c}`}
          x={u}
          y={v}
          width={0.76 / cols - 0.06}
          height={11}
          fill={on ? glass : "rgba(120,132,158,0.16)"}
          opacity={on ? (0.5 + n * 0.5) * o : 0.5 * o}
        />
      );
    }
  }

  const windowsLeft: React.ReactNode[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const n = mix(`${id}:L:${r}:${c}`);
      if (n > 0.62) continue;
      const on = n < 0.4 * lit;
      const v = 16 + r * 26;
      const u = 0.12 + c * (0.76 / cols);
      windowsLeft.push(
        <rect
          key={`l${r}${c}`}
          x={u}
          y={v}
          width={0.76 / cols - 0.06}
          height={11}
          fill={on ? glass : "rgba(120,132,158,0.1)"}
          // The shadow side is dimmer, or the tower stops reading as 3D.
          opacity={on ? 0.34 * o : 0.28 * o}
        />
      );
    }
  }

  return (
    <g>
      <polygon points={leftFace} fill={leftFill} />
      <polygon points={rightFace} fill={rightFill} />

      {/* Windows, drawn in unit space and skewed onto each wall. */}
      <g transform={`matrix(${HW}, ${-HH}, 0, -1, ${sx}, ${sy + HH})`}>{windows}</g>
      <g transform={`matrix(${HW}, ${HH}, 0, -1, ${sx - HW}, ${sy})`}>{windowsLeft}</g>

      <polygon points={roof} fill={topFill} />
      {/* The roof edge is the only place the district colour appears. */}
      <polygon
        points={roof}
        fill="none"
        stroke={accent}
        strokeWidth={1.5}
        opacity={0.5 * o * (claim ? 1 - claim.progress : 1)}
      />
      {claim && (
        <>
          <polygon
            points={roof}
            fill={claim.color}
            opacity={0.22 * claim.progress}
          />
          <polygon
            points={roof}
            fill="none"
            stroke={claim.color}
            strokeWidth={3}
            opacity={claim.progress}
          />
        </>
      )}
      {/* Vertical corner highlight — separates neighbouring towers. */}
      <line
        x1={sx}
        y1={sy + HH}
        x2={sx}
        y2={sy + HH - ph}
        stroke={accent}
        strokeWidth={1}
        opacity={0.18 * o}
      />
    </g>
  );
};

/** The tile a tower stands on. Drawn separately so the ground reads as a grid. */
export const Tile: React.FC<{
  sx: number;
  sy: number;
  span?: number;
  opacity?: number;
}> = ({ sx, sy, span = HERO_SPAN, opacity = 1 }) => {
  const HW = (theme.iso.TILE_W / 2) * span;
  const HH = (theme.iso.TILE_H / 2) * span;
  return (
  <polygon
    points={`${sx},${sy - HH} ${sx + HW},${sy} ${sx},${sy + HH} ${sx - HW},${sy}`}
    fill="none"
    stroke={theme.colors.primary}
    strokeWidth={1}
    opacity={0.1 * opacity}
  />
  );
};
