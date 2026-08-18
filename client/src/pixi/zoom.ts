import { worldToScreen } from "./iso";
import { CITY_HALF } from "./plan";

/**
 * The zoom range, derived from the window rather than hardcoded.
 *
 * The floor used to be a flat 0.12 duplicated in two files. The city measures
 * ~6400x3200px in screen space, so on a 1920x1080 monitor that rendered the
 * whole city at 768x384 — a small island with most of the desktop showing
 * around it. Zooming all the way out should frame the city, not shrink it into
 * a corner, and "all the way out" means something different on a laptop and on
 * an ultrawide.
 */

/** The city's extent in screen space at zoom 1. */
function citySpan(): { width: number; height: number } {
  const corners = [
    worldToScreen(-CITY_HALF, -CITY_HALF),
    worldToScreen(CITY_HALF, -CITY_HALF),
    worldToScreen(CITY_HALF, CITY_HALF),
    worldToScreen(-CITY_HALF, CITY_HALF),
  ];
  const xs = corners.map((c) => c.sx);
  const ys = corners.map((c) => c.sy);
  return {
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
  };
}

export const CITY_SPAN = citySpan();

/** A little air around the city so it doesn't sit flush against the edges. */
const FIT_MARGIN = 0.95;

/**
 * Hard floor on the computed fit.
 *
 * A very small window would otherwise compute a zoom so low the city is an
 * unreadable smudge; below this it is better to crop than to shrink.
 */
const ABSOLUTE_MIN = 0.1;

export const ZOOM_MAX = 2.2;

/** Zoom at which the whole city just fits inside a viewport of this size. */
export function fitZoom(screenWidth: number, screenHeight: number): number {
  if (screenWidth <= 0 || screenHeight <= 0) return ABSOLUTE_MIN;
  const fit = Math.min(screenWidth / CITY_SPAN.width, screenHeight / CITY_SPAN.height);
  return Math.max(ABSOLUTE_MIN, Math.min(ZOOM_MAX, fit * FIT_MARGIN));
}

/**
 * Zoom below which lamp light pools are dropped.
 *
 * This one has to track the fit, unlike the other LOD tiers. Its original job
 * was to drop the pools at the extreme end of the old range, where they merged
 * into a smear. With a fitted floor the extreme end is now the *whole city*
 * view, and the street grid picked out in light is the best thing in it — so
 * the cutoff must sit at or below the floor, never above it, or the lights
 * vanish exactly where they earn their keep.
 *
 * `PROP_LOD` and `LOD_ZOOM` stay absolute on purpose: whether a 26px tree or a
 * nameplate is legible is a question about pixels on screen, which does not
 * change because the monitor got wider.
 */
const GLOW_LOD_BASE = 0.2;

export function glowLod(currentFit: number): number {
  return Math.min(GLOW_LOD_BASE, currentFit);
}
