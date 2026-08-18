import type { CityState, Player, Ticker } from "../rooms/schema/CityState.js";
import { parkAt } from "../config/parks.js";
import {
  CHARGE_MAX,
  CHARGE_REGEN_MS,
  PARK_CHARGE_MULTIPLIER,
  STARTING_BLOCK,
  floorPrice,
  floorYieldPerMinute,
  tierFor,
} from "./economy.js";

/**
 * Floor ownership and yield.
 *
 * Every owned floor renders as one lit window, so this module is what actually
 * lights the skyline. All validation happens here, server-side — the client
 * only ever asks.
 */

/** Floors available in a tower, derived from its live height. Mirrors the
 *  client's floorsFor() in pixi/City.ts; both must agree or windows will
 *  render above the roofline. */
export function floorsFor(height: number): number {
  return Math.max(6, Math.min(40, Math.round(height / 3)));
}

export type BuyResult =
  | { ok: true; symbol: string; owned: number; spent: number }
  | { ok: false; reason: string };

export function buyFloor(state: CityState, player: Player, symbol: string): BuyResult {
  const ticker = state.tickers.get(symbol);
  if (!ticker) return { ok: false, reason: "No such building." };

  const total = floorsFor(ticker.height);
  if (ticker.ownedFloors >= total) {
    return { ok: false, reason: `${symbol} is fully leased.` };
  }

  const cost = floorPrice(ticker.height, ticker.volatility);
  if (player.block < cost) {
    return { ok: false, reason: `Need ${cost} $BLOCK, you have ${Math.floor(player.block)}.` };
  }

  // The balance is deliberately NOT changed here. The caller posts `spent` to
  // the ledger, which applies the deduction — keeping every movement of
  // currency recorded and making it impossible for a balance to change without
  // a matching entry.
  ticker.ownedFloors += 1;
  player.floors.set(symbol, (player.floors.get(symbol) ?? 0) + 1);

  return { ok: true, symbol, owned: player.floors.get(symbol) ?? 0, spent: cost };
}

/** Refresh the derived, player-facing numbers on every tower. */
export function refreshTickerEconomics(state: CityState) {
  state.tickers.forEach((ticker: Ticker) => {
    ticker.totalFloors = floorsFor(ticker.height);
    ticker.floorPrice = floorPrice(ticker.height, ticker.volatility);
    ticker.tier = tierFor(ticker.volatility).tier;
  });
}

/**
 * Pay out floor yield and regenerate CHARGE.
 *
 * Called on a slow interval; `elapsedMs` is real time since the last run so
 * the rate is independent of tick jitter.
 */
/**
 * Pay out floor yield and regenerate CHARGE.
 *
 * Returns what each player earned rather than crediting it directly, so the
 * caller can record every payout in the ledger. CHARGE is regenerated here
 * because it is not currency and carries no audit requirement.
 */
export interface Payout {
  sessionId: string;
  player: Player;
  earned: number;
  /**
   * Yield broken down per tower. Needed because each tower may have a
   * different landlord taking a cut, so the split can't be done on the total.
   */
  bySymbol: Map<string, number>;
}

export function accrue(state: CityState, elapsedMs: number): Payout[] {
  const minutes = elapsedMs / 60000;
  const payouts: Payout[] = [];

  state.players.forEach((player: Player, sessionId: string) => {
    /**
     * Resting in a park recharges faster.
     *
     * Read from the same park list the client renders from, so the bonus can
     * only ever apply where the player can actually see a park. `resting` is
     * replicated purely so the HUD can say so — a bonus nobody notices is a
     * bonus nobody walks to.
     */
    const resting = parkAt(player.x, player.z) !== null;
    player.resting = resting;

    if (player.charge < CHARGE_MAX) {
      const rate = resting ? PARK_CHARGE_MULTIPLIER : 1;
      player.charge = Math.min(CHARGE_MAX, player.charge + (elapsedMs * rate) / CHARGE_REGEN_MS);
    }

    // Floor yield, per tower, skipping frozen feeds entirely.
    let earned = 0;
    const bySymbol = new Map<string, number>();

    player.floors.forEach((count: number, symbol: string) => {
      if (count <= 0) return;
      const ticker = state.tickers.get(symbol);
      if (!ticker) return;
      const amount = count * floorYieldPerMinute(ticker.volatility, ticker.frozen) * minutes;
      if (amount <= 0) return;
      earned += amount;
      bySymbol.set(symbol, amount);
    });

    if (earned > 0) payouts.push({ sessionId, player, earned, bySymbol });
  });

  return payouts;
}

export function initPlayerEconomy(player: Player) {
  player.block = STARTING_BLOCK;
  player.charge = CHARGE_MAX;
  player.shards = 0;
}
