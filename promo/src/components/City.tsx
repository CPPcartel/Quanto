import React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { theme, worldToScreen } from "../theme";
import { TOWERS, type Tower as TowerData } from "../data";
import { Tower, Tile, HERO_SPAN, FILLER_SPAN } from "./Tower";
import { gameHash } from "../hash";

/**
 * The whole city.
 *
 * Layout is not designed for the video — it is `layoutFor()` from
 * `server/src/config/tickers.ts` reimplemented exactly: four districts at fixed
 * centres, each a grid at PLOT_SPACING 26. A viewer who opens the game after
 * seeing this finds Tech Row where the video put it.
 */

const PLOT_SPACING = 26;

const DISTRICTS = {
  tech: { cx: 90, cz: -90, cols: 5, accent: theme.colors.district.tech },
  crypto: { cx: -90, cz: -90, cols: 4, accent: theme.colors.district.crypto },
  moonshot: { cx: 90, cz: 90, cols: 4, accent: theme.colors.district.moonshot },
  index: { cx: -90, cz: 90, cols: 3, accent: theme.colors.district.index },
} as const;

export interface Placed extends TowerData {
  x: number;
  z: number;
  sx: number;
  sy: number;
  accent: string;
  /** Paint order: farther tiles first, or a near tower is drawn behind a far one. */
  order: number;
}

/** Every tower, placed once at module load — the layout never changes. */
export const PLACED: Placed[] = (() => {
  const out: Placed[] = [];
  for (const key of Object.keys(DISTRICTS) as (keyof typeof DISTRICTS)[]) {
    const d = DISTRICTS[key];
    const members = TOWERS.filter((t) => t.district === key);
    const rows = Math.ceil(members.length / d.cols);
    members.forEach((t, index) => {
      const col = index % d.cols;
      const row = Math.floor(index / d.cols);
      const x = d.cx + (col - (d.cols - 1) / 2) * PLOT_SPACING;
      const z = d.cz + (row - (rows - 1) / 2) * PLOT_SPACING;
      const { sx, sy } = worldToScreen(x, z);
      out.push({ ...t, x, z, sx, sy, accent: d.accent, order: x + z });
    });
  }
  // Painter's algorithm. In a 2:1 iso grid, depth is simply x + z.
  return out.sort((a, b) => a.order - b.order);
})();

/**
 * The screen-space box a set of towers actually occupies, roofs included.
 *
 * Roofs matter: a bounding box built from footprints alone frames the city as
 * if the buildings were flat, and every tall tower then runs off the top.
 */
export function boundsOf(list: Placed[]) {
  const HW = theme.iso.TILE_W / 2;
  const HH = theme.iso.TILE_H / 2;
  const minX = Math.min(...list.map((p) => p.sx - HW));
  const maxX = Math.max(...list.map((p) => p.sx + HW));
  const minY = Math.min(
    ...list.map((p) => p.sy - HH - p.height * theme.iso.PIXELS_PER_HEIGHT_UNIT)
  );
  const maxY = Math.max(...list.map((p) => p.sy + HH));
  return { minX, maxX, minY, maxY, w: maxX - minX, h: maxY - minY };
}

/**
 * Low-rise filler.
 *
 * Ported from `buildFiller()` in client/src/pixi/City.ts: the same 13-unit
 * grid, the same FNV-1a seed per "x,z", the same 0.32 cutoff that leaves
 * courtyards, and the same 24-unit exclusion around every ticker plot.
 *
 * Without it the districts are a handful of lonely towers 26 units apart, which
 * is exactly how the first cut of this video looked. The filler is what makes a
 * district read as a city — in the game and here.
 */
export interface Filler {
  x: number;
  z: number;
  sx: number;
  sy: number;
  height: number;
  seed: number;
  accent: string;
  order: number;
}

export const FILLERS: Filler[] = (() => {
  const out: Filler[] = [];
  for (let x = -190; x <= 190; x += 13) {
    for (let z = -190; z <= 190; z += 13) {
      // The central plaza stays clear, as it does in the game.
      if (Math.hypot(x, z) < 40) continue;
      // Never on a ticker plot.
      if (PLACED.some((p) => Math.abs(p.x - x) < 24 && Math.abs(p.z - z) < 24)) continue;

      // `gameHash`, not a local copy — the divisor differed by one and the
      // whole point of this layout is that it is the game's, exactly.
      const seed = gameHash(`${x},${z}`);
      if (seed < 0.32) continue; // courtyards and lots

      // The game's FLOOR_H is 3 world units per floor, 2..7 floors.
      const height = (2 + Math.floor(seed * 6)) * 3;
      const { sx, sy } = worldToScreen(x, z);
      const near = [...PLACED].sort(
        (a, b) => Math.hypot(a.x - x, a.z - z) - Math.hypot(b.x - x, b.z - z)
      )[0];
      out.push({ x, z, sx, sy, height, seed, accent: near?.accent ?? "#5B8DEF", order: x + z });
    }
  }
  return out.sort((a, b) => a.order - b.order);
})();

export const CITY_BOUNDS = boundsOf(PLACED);

const ORDER_MIN = Math.min(...PLACED.map((p) => p.order));
const ORDER_MAX = Math.max(...PLACED.map((p) => p.order));

/**
 * A camera that frames one district to fill the width of the shot.
 *
 * The four districts sit at (+/-90, +/-90) around a central plaza, so a shot
 * wide enough to hold all of them is mostly empty plaza with towers scattered
 * around the rim — accurate, and unreadable at 1080 wide. Framing a single
 * district gives a dense skyline and stays true to the game's layout, because
 * it *is* the game's layout, just closer.
 *
 * `centerYPct` places the middle of the towers in the frame, leaving the rest
 * for type.
 */
export function frameDistrict(
  district: keyof typeof DISTRICTS | "all",
  opts: {
    frameW: number;
    frameH: number;
    fill?: number;
    centerYPct?: number;
    /** Fraction of the frame height the towers may occupy. */
    heightFill?: number;
  }
) {
  const { frameW, frameH, fill = 0.92, centerYPct = 0.5, heightFill = 0.62 } = opts;
  const list = district === "all" ? PLACED : PLACED.filter((p) => p.district === district);
  const b = boundsOf(list);

  /**
   * Fit by whichever axis runs out first.
   *
   * Scaling on width alone is right for 9:16 and wrong for 1:1 — the same
   * district that comfortably fills the upper half of a tall frame overflows a
   * square one and shoves the headline into the towers. Taking the smaller of
   * the two fits means one set of numbers composes both cuts.
   */
  const scale = Math.min((frameW * fill) / b.w, (frameH * heightFill) / b.h);
  const contentCenterY = (b.minY + b.maxY) / 2;
  const contentCenterX = (b.minX + b.maxX) / 2;

  // Shift in city units so the content's centre lands at centerYPct of the frame.
  const shift = (frameH / 2 - frameH * centerYPct) / scale;

  return {
    scale,
    center: { x: contentCenterX, y: contentCenterY + shift },
    bounds: b,
    /** Screen-space bottom edge of the towers, for placing a horizon. */
    groundY: frameH * centerYPct + (b.maxY - contentCenterY) * scale,
  };
}

/**
 * The city, rendered into an SVG the caller positions and scales.
 *
 * `raise` staggers the towers up out of the ground. The stagger runs along the
 * painter's order, so the skyline builds from the back forward — which is both
 * the readable direction and the one that never pops a tower in front of one
 * that has not arrived yet.
 */
export const City: React.FC<{
  /** Frame at which the first tower starts rising. */
  raiseAt?: number;
  /** Frames between consecutive towers. */
  stagger?: number;
  /** Symbols to draw; omit for all. */
  only?: string[];
  /** Multiplies every height — used for the live-market pulse. */
  heightScale?: (t: Placed, frame: number) => number;
  /** 0..1, dims windows. */
  lit?: number;
  /**
   * A tower changing hands.
   *
   * Control in this game is shown on the roof — the district accent is replaced
   * by the crew's colour. Passing it through the city rather than overlaying a
   * shape on top means the claim is drawn in the right paint order, behind
   * anything standing in front of the tower.
   */
  crewClaim?: { symbol: string; color: string; progress: number };
  showTiles?: boolean;
  width: number;
  height: number;
  /** Screen-space centre of the viewBox. */
  center?: { x: number; y: number };
  scale?: number;
  style?: React.CSSProperties;
}> = ({
  raiseAt = 0,
  stagger = 1.6,
  only,
  heightScale,
  lit = 1,
  crewClaim,
  showTiles = true,
  width,
  height,
  center = { x: 0, y: 0 },
  scale = 1,
  style,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const list = only ? PLACED.filter((p) => only.includes(p.symbol)) : PLACED;

  /**
   * One draw list, sorted by depth.
   *
   * Towers and filler have to be interleaved by x+z, not drawn as two passes —
   * otherwise every filler block renders in front of (or behind) every tower
   * regardless of where it actually stands, and the depth cue inverts.
   */
  const fillers = React.useMemo(() => {
    if (only) return [];
    const b = boundsOf(list);
    // Only the filler that can be on screen for this shot.
    return FILLERS.filter(
      (f) =>
        f.sx > b.minX - 400 && f.sx < b.maxX + 400 && f.sy > b.minY - 200 && f.sy < b.maxY + 400
    );
  }, [only, list]);

  // viewBox in city coordinates, so `scale` behaves like a camera zoom.
  const vw = width / scale;
  const vh = height / scale;
  const viewBox = `${center.x - vw / 2} ${center.y - vh / 2} ${vw} ${vh}`;

  return (
    <svg
      width={width}
      height={height}
      viewBox={viewBox}
      style={{ overflow: "visible", ...style }}
      // Pixel art: never smooth it.
      shapeRendering="crispEdges"
    >
      {showTiles &&
        list.map((p, i) => {
          const g = spring({
            frame: frame - raiseAt - i * stagger,
            fps,
            config: theme.spring.smooth,
          });
          return (
            <Tile key={`t${p.symbol}`} sx={p.sx} sy={p.sy} span={HERO_SPAN} opacity={g} />
          );
        })}

      {fillers.map((f, i) => {
        const g = spring({
          frame: frame - raiseAt - (i % 12) * stagger * 0.5,
          fps,
          config: theme.spring.smooth,
        });
        const t = interpolate(f.order, [ORDER_MIN, ORDER_MAX], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        });
        return (
          <Tower
            key={`f${f.x},${f.z}`}
            id={`f${f.x},${f.z}`}
            sx={f.sx}
            sy={f.sy}
            span={FILLER_SPAN}
            height={f.height}
            // Filler has no ticker, so it never carries an up/down colour. Its
            // windows stay neutral — only real feeds are allowed to be green.
            changePct={0}
            accent={f.accent}
            lit={lit * 0.35}
            depth={interpolate(t, [0, 1], [0.4, 0.72])}
            grow={g}
          />
        );
      })}

      {list.map((p, i) => {
        const g = spring({
          frame: frame - raiseAt - i * stagger,
          fps,
          config: theme.spring.tower,
        });
        // Depth cue: far towers (low order) sit back in the haze.
        // Depth runs along the painter's axis (x + z), not along screen x.
        const t = interpolate(p.order, [ORDER_MIN, ORDER_MAX], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        });
        const depth = interpolate(t, [0, 1], [0.55, 1]);
        const pulse = heightScale ? heightScale(p, frame) : 1;
        const claimed = crewClaim && crewClaim.symbol === p.symbol ? crewClaim : undefined;
        return (
          <Tower
            key={p.symbol}
            id={p.symbol}
            sx={p.sx}
            sy={p.sy}
            span={HERO_SPAN}
            height={p.height * pulse}
            changePct={p.changePct}
            accent={p.accent}
            claim={claimed}
            lit={lit}
            depth={depth}
            grow={g}
          />
        );
      })}
    </svg>
  );
};
