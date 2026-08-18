import type { CityState, Player } from "../rooms/schema/CityState.js";
import { COST_SHIFT, tierFor } from "./economy.js";

/**
 * Shift work — the free-to-play income floor.
 *
 * Clock in at a tower, play a short "order execution" minigame, get paid at
 * that ticker's volatility tier. No ownership required, so a new player always
 * has a way to earn.
 *
 * Anti-cheat note: the server generates the target bands and derives accuracy
 * itself from the press timings the client reports. A client can still report
 * *perfect* timings — that ceiling is inherent to any latency-tolerant timing
 * minigame — but it cannot invent a better-than-perfect score, claim a shift
 * it never started, skip the CHARGE cost, or beat the cooldown.
 *
 * The cooldown is keyed by **device**, not by connection. It used to be keyed
 * by sessionId, which a browser reload replaces — so reloading the page reset
 * every cooldown in the city and the 30-minute limit on shift income was
 * decorative. Anything that rate-limits earnings has to hang off the persistent
 * identity, because the transient one is under the player's control.
 */

export const SHIFT_ROUNDS = 3;
/** Seconds the marker takes to sweep the bar once. */
export const SHIFT_SWEEP_SEC = 1.6;
/** Half-width of the scoring band, as a fraction of the bar. */
export const SHIFT_BAND = 0.11;
/** How close you must stand to a tower to clock in, in world units. */
export const SHIFT_RANGE = 26;
const COOLDOWN_MS = 30 * 60 * 1000;
/** Base payout before the volatility multiplier and accuracy. */
const BASE_PAY = 18;

export interface ShiftSpec {
  shiftId: string;
  symbol: string;
  /** Target centre for each round, 0..1 along the bar. */
  targets: number[];
  sweepSec: number;
  band: number;
  rounds: number;
}

interface ActiveShift {
  shiftId: string;
  symbol: string;
  sessionId: string;
  /** Captured at start, so the cooldown lands on the right identity even if
   *  the lookup would fail by the time the shift finishes. */
  deviceId: string;
  targets: number[];
  startedAt: number;
}

export type StartResult = { ok: true; spec: ShiftSpec } | { ok: false; reason: string };
export type FinishResult =
  | { ok: true; symbol: string; accuracy: number; paid: number; tier: string }
  | { ok: false; reason: string };

export class ShiftService {
  /** Keyed by connection: a shift belongs to a session and dies with it. */
  private active = new Map<string, ActiveShift>();
  /** `${deviceId}:${symbol}` -> epoch ms when the cooldown lifts. */
  private cooldowns = new Map<string, number>();
  private counter = 0;

  start(
    state: CityState,
    player: Player,
    sessionId: string,
    deviceId: string,
    symbol: string
  ): StartResult {
    const ticker = state.tickers.get(symbol);
    if (!ticker) return { ok: false, reason: "No such building." };

    const distance = Math.hypot(ticker.x - player.x, ticker.z - player.z);
    if (distance > SHIFT_RANGE) return { ok: false, reason: "Walk closer to clock in." };

    if (player.charge < COST_SHIFT) {
      return { ok: false, reason: `Need ${COST_SHIFT} CHARGE.` };
    }

    const key = `${deviceId}:${symbol}`;
    const until = this.cooldowns.get(key) ?? 0;
    if (Date.now() < until) {
      const mins = Math.ceil((until - Date.now()) / 60000);
      return { ok: false, reason: `Shift cooldown here: ${mins}m left.` };
    }

    if (this.active.has(sessionId)) return { ok: false, reason: "Already on shift." };

    // Charge is spent up front so quitting mid-shift still costs something.
    player.charge -= COST_SHIFT;

    const targets = Array.from({ length: SHIFT_ROUNDS }, () => 0.2 + Math.random() * 0.6);
    const shiftId = `s${++this.counter}`;
    this.active.set(sessionId, {
      shiftId,
      symbol,
      sessionId,
      deviceId,
      targets,
      startedAt: Date.now(),
    });

    return {
      ok: true,
      spec: {
        shiftId,
        symbol,
        targets,
        sweepSec: SHIFT_SWEEP_SEC,
        band: SHIFT_BAND,
        rounds: SHIFT_ROUNDS,
      },
    };
  }

  /**
   * `presses` are elapsed-milliseconds-since-round-start, one per round. The
   * server recomputes where the marker actually was at those times.
   */
  finish(
    state: CityState,
    player: Player,
    sessionId: string,
    shiftId: string,
    presses: number[]
  ): FinishResult {
    const shift = this.active.get(sessionId);
    if (!shift || shift.shiftId !== shiftId) return { ok: false, reason: "No shift in progress." };
    this.active.delete(sessionId);

    const ticker = state.tickers.get(shift.symbol);
    if (!ticker) return { ok: false, reason: "Building vanished." };

    if (!Array.isArray(presses) || presses.length !== SHIFT_ROUNDS) {
      return { ok: false, reason: "Shift abandoned." };
    }

    // Plausibility: the whole thing cannot take less time than the rounds do.
    const elapsed = Date.now() - shift.startedAt;
    if (elapsed < SHIFT_ROUNDS * SHIFT_SWEEP_SEC * 250) {
      return { ok: false, reason: "Shift abandoned." };
    }

    let hits = 0;
    let closeness = 0;
    for (let i = 0; i < SHIFT_ROUNDS; i++) {
      const ms = Number(presses[i]);
      if (!isFinite(ms) || ms < 0 || ms > SHIFT_SWEEP_SEC * 4000) continue;

      // Marker sweeps 0->1->0 in a triangle wave; derive its position ourselves.
      const phase = (ms / 1000 / SHIFT_SWEEP_SEC) % 1;
      const pos = phase < 0.5 ? phase * 2 : 2 - phase * 2;
      const delta = Math.abs(pos - shift.targets[i]);
      if (delta <= SHIFT_BAND) {
        hits++;
        closeness += 1 - delta / SHIFT_BAND;
      }
    }

    const accuracy = hits === 0 ? 0 : (hits + closeness) / (SHIFT_ROUNDS * 2);
    const { tier, mult } = tierFor(ticker.volatility);
    const paid = Math.round(BASE_PAY * mult * (0.25 + accuracy * 1.5));

    // Not credited here — the caller posts `paid` to the ledger so the payout
    // is recorded rather than silently added to a balance.
    this.cooldowns.set(`${shift.deviceId}:${shift.symbol}`, Date.now() + COOLDOWN_MS);

    return { ok: true, symbol: shift.symbol, accuracy, paid, tier };
  }

  abandon(sessionId: string) {
    this.active.delete(sessionId);
  }

  /**
   * Drop cooldowns that have already lapsed.
   *
   * Keyed by device and symbol, this map would otherwise keep one entry per
   * player per tower for the lifetime of the process — and unlike the session
   * map, nothing removes entries when a player leaves.
   */
  sweep() {
    const now = Date.now();
    this.cooldowns.forEach((until, key) => {
      if (until <= now) this.cooldowns.delete(key);
    });
  }

  /** Remaining cooldown for a building, in ms. 0 when ready. */
  cooldownFor(deviceId: string, symbol: string): number {
    return Math.max(0, (this.cooldowns.get(`${deviceId}:${symbol}`) ?? 0) - Date.now());
  }
}
