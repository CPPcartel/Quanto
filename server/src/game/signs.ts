import { Sign, type CityState, type Player } from "../rooms/schema/CityState.js";
import { COST_PLACE_SIGN } from "./economy.js";
import { SpatialGrid } from "./spatial.js";

/**
 * Neon signs — social flex that pays.
 *
 * Craft one from shards, mount it on a tower where you own a floor, and every
 * player in the city sees it. Signs earn a trickle from foot traffic, so a
 * good spot on a busy street is genuinely worth having.
 */

export const SIGN_SHARD_COST = 8;
export const SIGN_BLOCK_COST = 120;
/** Radius counted as "walking past" a sign, in world units. */
const TRAFFIC_RANGE = 30;
/** $BLOCK per unique passer-by per payout sweep. */
const TRAFFIC_PAY = 0.8;
const MAX_SIGNS_PER_TOWER = 6;

export const SIGN_COLORS = ["#22E8FF", "#FF2D95", "#FFB347", "#3BFF8F", "#A855F7"];

export type SignResult = { ok: true; id: string; symbol: string } | { ok: false; reason: string };

export class SignService {
  private counter = 0;
  /** Sign id -> owning sessionId. Kept off-schema; ownership pay-outs only. */
  private owners = new Map<string, string>();

  place(
    state: CityState,
    player: Player,
    sessionId: string,
    symbol: string,
    text: string,
    color: string
  ): SignResult {
    const ticker = state.tickers.get(symbol);
    if (!ticker) return { ok: false, reason: "No such building." };

    if ((player.floors.get(symbol) ?? 0) < 1) {
      return { ok: false, reason: `Lease a floor in ${symbol} first.` };
    }
    if (player.shards < SIGN_SHARD_COST) {
      return { ok: false, reason: `Need ${SIGN_SHARD_COST} shards, you have ${player.shards}.` };
    }
    if (player.block < SIGN_BLOCK_COST) {
      return { ok: false, reason: `Need ${SIGN_BLOCK_COST} $BLOCK.` };
    }
    if (player.charge < COST_PLACE_SIGN) {
      return { ok: false, reason: `Need ${COST_PLACE_SIGN} CHARGE.` };
    }

    let onTower = 0;
    state.signs.forEach((s) => {
      if (s.symbol === symbol) onTower++;
    });
    if (onTower >= MAX_SIGNS_PER_TOWER) {
      return { ok: false, reason: `${symbol} has no free mounting points.` };
    }

    const clean = String(text ?? "")
      .toUpperCase()
      .replace(/[^A-Z0-9 $!?]/g, "")
      .slice(0, 5)
      .trim();
    if (!clean) return { ok: false, reason: "Sign needs some text." };

    // Shards and energy are not currency and are deducted directly; the
    // $BLOCK cost is left to the caller so it lands in the ledger.
    player.shards -= SIGN_SHARD_COST;
    player.charge -= COST_PLACE_SIGN;

    const sign = new Sign();
    sign.id = `sg${++this.counter}`;
    sign.symbol = symbol;
    sign.ownerName = player.name;
    sign.text = clean;
    sign.color = SIGN_COLORS.includes(color) ? color : SIGN_COLORS[0];
    // Stack signs up the facade so they never overlap.
    sign.floor = 2 + onTower * 3;

    state.signs.set(sign.id, sign);
    this.owners.set(sign.id, sessionId);

    return { ok: true, id: sign.id, symbol };
  }

  /**
   * Pay sign owners for passing traffic. A player never generates revenue for
   * their own sign, so parking next to it does nothing.
   */
  /**
   * Work out what each sign owner is owed for passing traffic.
   *
   * Returns the amounts rather than crediting them, so every payment reaches
   * the ledger. Player positions are bucketed once per sweep instead of being
   * rescanned per sign — the previous version was O(signs x players) every
   * five seconds.
   */
  payTraffic(
    state: CityState
  ): Array<{ sessionId: string; player: Player; amount: number }> {
    if (state.signs.size === 0) return [];

    const grid = new SpatialGrid(TRAFFIC_RANGE);
    state.players.forEach((player: Player, sessionId: string) => {
      grid.insert(sessionId, player.x, player.z);
    });

    const owed = new Map<string, number>();

    state.signs.forEach((sign) => {
      const ownerSession = this.owners.get(sign.id);
      if (!ownerSession || !state.players.has(ownerSession)) return;

      const ticker = state.tickers.get(sign.symbol);
      if (!ticker) return;

      let passers = 0;
      for (const sessionId of grid.near(ticker.x, ticker.z)) {
        if (sessionId === ownerSession) continue;
        const player = state.players.get(sessionId);
        if (!player) continue;
        if (Math.hypot(ticker.x - player.x, ticker.z - player.z) <= TRAFFIC_RANGE) passers++;
      }

      if (passers > 0) {
        owed.set(ownerSession, (owed.get(ownerSession) ?? 0) + passers * TRAFFIC_PAY);
      }
    });

    const payouts: Array<{ sessionId: string; player: Player; amount: number }> = [];
    owed.forEach((amount, sessionId) => {
      const player = state.players.get(sessionId);
      if (player) payouts.push({ sessionId, player, amount });
    });
    return payouts;
  }

  /** Re-link an owner after a reconnect restores their signs. */
  adopt(signId: string, sessionId: string) {
    this.owners.set(signId, sessionId);
  }

  ownerOf(signId: string) {
    return this.owners.get(signId);
  }

  release(sessionId: string) {
    this.owners.forEach((owner, id) => {
      if (owner === sessionId) this.owners.delete(id);
    });
  }
}
