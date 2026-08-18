/**
 * Core economy rules.
 *
 * The one design constraint that matters here: payouts are bucketed into
 * coarse volatility *tiers*, never a continuous function of price movement.
 * A linear payoff curve on real security prices reads as a derivative; a
 * four-step game stat reads as game balance. Keep it that way.
 */

export type VolTier = "calm" | "normal" | "hot" | "extreme";

/** Realized-volatility thresholds, tuned against live feed readings. */
const TIER_BOUNDS: Array<{ tier: VolTier; max: number; mult: number }> = [
  { tier: "calm", max: 0.0005, mult: 1.0 },
  { tier: "normal", max: 0.0015, mult: 1.6 },
  { tier: "hot", max: 0.004, mult: 2.4 },
  { tier: "extreme", max: Infinity, mult: 3.5 },
];

export function tierFor(volatility: number): { tier: VolTier; mult: number } {
  for (const band of TIER_BOUNDS) {
    if (volatility < band.max) return { tier: band.tier, mult: band.mult };
  }
  return { tier: "extreme", mult: 3.5 };
}

// ---------------------------------------------------------------------------
// CHARGE — the energy currency that gates active verbs
// ---------------------------------------------------------------------------

export const CHARGE_MAX = 100;
/** One point every 5 minutes: a full bar takes just over 8 hours. */
export const CHARGE_REGEN_MS = 5 * 60 * 1000;

/**
 * CHARGE regenerates this many times faster while standing in a park.
 *
 * The one lever that makes parks worth walking to. It is deliberately a
 * multiplier on an existing regenerating resource rather than a new payout:
 * resting in a park mints no $BLOCK, has no exposure to any price, and produces
 * nothing that can leave the game. CHARGE is also the binding constraint on
 * activity — a full bar takes over eight hours — so even a modest multiplier is
 * felt.
 *
 * Tune here and nowhere else.
 */
export const PARK_CHARGE_MULTIPLIER = 3;

export const COST_SHIFT = 12;
export const COST_PLACE_SIGN = 20;

/** New players start with enough to buy a few floors and feel the loop. */
export const STARTING_BLOCK = 500;

// ---------------------------------------------------------------------------
// Floors
// ---------------------------------------------------------------------------

/** Cost of the next floor in a tower. Taller (pricier) towers cost more. */
export function floorPrice(height: number, volatility: number): number {
  const { mult } = tierFor(volatility);
  // Volatile towers are more expensive because they earn more.
  return Math.round((25 + height * 1.6) * (0.8 + mult * 0.25));
}

/**
 * $BLOCK earned per owned floor per minute.
 *
 * Frozen feeds pay nothing at all — that is what makes the After-Hours shift a
 * real economic event rather than a lighting change.
 */
export function floorYieldPerMinute(volatility: number, frozen: boolean): number {
  if (frozen) return 0;
  const { mult } = tierFor(volatility);
  return 0.5 * mult;
}

export function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}
