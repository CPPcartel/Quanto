import { Shard, type CityState, type Player } from "../rooms/schema/CityState.js";
import { parkAt } from "../config/parks.js";
import { SpatialGrid } from "./spatial.js";

/**
 * Data Runner storms — the live event.
 *
 * When a real ticker's realized volatility spikes, shards scatter through the
 * streets around that tower for a few minutes. Collection is first-touch and
 * decided entirely here, which is the same fairness property the chain itself
 * provides: no amount of client cleverness can claim a shard twice.
 */

/** Realized-volatility level that triggers a storm. */
export const STORM_THRESHOLD = 0.0022;
export const STORM_DURATION_MS = 3 * 60 * 1000;
/** Minimum gap between storms so the city isn't permanently in one. */
const STORM_COOLDOWN_MS = 6 * 60 * 1000;
const MIN_SHARDS = 12;
const MAX_SHARDS = 20;
/** How close you must get to sweep a shard up, in world units. */
const PICKUP_RANGE = 3.2;
const SHARD_SPREAD = 34;

export class StormService {
  private lastStormEndedAt = 0;
  private counter = 0;

  /** Called on each oracle publish; starts a storm when one is warranted. */
  maybeTrigger(state: CityState, peakSymbol: string, peakVolatility: number) {
    const now = Date.now();

    // Expire a finished storm and clear any shards nobody collected.
    if (state.stormSymbol && now >= state.stormEndsAt) {
      this.end(state);
    }

    if (state.stormSymbol) return;
    if (now - this.lastStormEndedAt < STORM_COOLDOWN_MS) return;
    if (!peakSymbol || peakVolatility < STORM_THRESHOLD) return;

    this.begin(state, peakSymbol);
  }

  /** Force a storm regardless of market conditions — used by the debug route. */
  force(state: CityState, symbol: string): boolean {
    if (!state.tickers.get(symbol)) return false;
    if (state.stormSymbol) this.end(state);
    this.begin(state, symbol);
    return true;
  }

  private begin(state: CityState, symbol: string) {
    const ticker = state.tickers.get(symbol);
    if (!ticker) return;

    state.stormSymbol = symbol;
    state.stormEndsAt = Date.now() + STORM_DURATION_MS;

    const count = MIN_SHARDS + Math.floor(Math.random() * (MAX_SHARDS - MIN_SHARDS + 1));
    for (let i = 0; i < count; i++) {
      const shard = new Shard();
      shard.id = `sh${++this.counter}`;
      shard.symbol = symbol;
      const spot = this.pickSpot(ticker.x, ticker.z);
      shard.x = spot.x;
      shard.z = spot.z;
      state.shards.set(shard.id, shard);
    }
  }

  /**
   * Where a shard lands.
   *
   * Rings the tower rather than burying shards inside its own footprint, and
   * prefers open ground — parks, ponds and the plaza — over building plots.
   * Shards previously landed wherever the ring fell, including inside blocks
   * the player then had to run around. Biasing toward open ground fixes that
   * and gives the parks a job during a storm.
   *
   * Best-of-N rather than rejection sampling: a tower with no park nearby must
   * still get its shards, so this always returns a point and simply prefers a
   * better one when it finds it.
   */
  private pickSpot(cx: number, cz: number): { x: number; z: number } {
    let fallback = ringPoint(cx, cz);
    for (let attempt = 0; attempt < 6; attempt++) {
      const p = ringPoint(cx, cz);
      if (parkAt(p.x, p.z)) return p;
      fallback = p;
    }
    return fallback;
  }

  private end(state: CityState) {
    state.stormSymbol = "";
    state.stormEndsAt = 0;
    state.shards.clear();
    this.lastStormEndedAt = Date.now();
  }

  /**
   * Sweep up any shard a player is standing on. Deleting from the map before
   * crediting makes the claim atomic within our single-threaded tick, so two
   * players arriving on the same tick cannot both be paid.
   */
  collect(state: CityState): Array<{ sessionId: string; count: number }> {
    if (state.shards.size === 0) return [];

    // Bucket the shards once, then ask only about the cells around each player.
    // Comparing every player against every shard on the movement tick was the
    // hottest loop in the server.
    const grid = new SpatialGrid<string>(PICKUP_RANGE);
    state.shards.forEach((shard, id) => grid.insert(id, shard.x, shard.z));

    const claims = new Map<string, number>();

    state.players.forEach((player: Player, sessionId: string) => {
      for (const id of grid.near(player.x, player.z)) {
        const shard = state.shards.get(id);
        if (!shard) continue; // already claimed, this tick or earlier

        const distance = Math.hypot(shard.x - player.x, shard.z - player.z);
        if (distance > PICKUP_RANGE) continue;

        // Delete before crediting: within a single tick this makes the claim
        // atomic, so two runners arriving together cannot both be paid.
        if (!state.shards.delete(id)) continue;
        player.shards += 1;
        claims.set(sessionId, (claims.get(sessionId) ?? 0) + 1);
      }
    });

    return [...claims.entries()].map(([sessionId, count]) => ({ sessionId, count }));
  }
}

/** A random point on the shard ring around a tower. */
function ringPoint(cx: number, cz: number): { x: number; z: number } {
  const angle = Math.random() * Math.PI * 2;
  const radius = 14 + Math.random() * SHARD_SPREAD;
  return { x: cx + Math.cos(angle) * radius, z: cz + Math.sin(angle) * radius };
}
