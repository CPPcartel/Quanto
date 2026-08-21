import type { Db } from "../db/db.js";

/**
 * The economy's write path.
 *
 * Two jobs, and they're related:
 *
 *  1. **Every movement of currency is recorded**, not just its result. Balances
 *     become a replayable consequence of events rather than a number somebody
 *     mutated, which is what makes the economy auditable and makes on-chain
 *     settlement possible later.
 *
 *  2. **Nothing blocks the game loop.** Entries accumulate in memory and are
 *     drained on a timer in one batched transaction. The previous design wrote
 *     synchronously — at 150 players the once-a-minute autosave stalled the
 *     simulation while it wrote every player in turn.
 *
 * `post()` is deliberately the only way to change a balance, so the in-memory
 * value and the ledger cannot drift apart.
 */

export type LedgerKind =
  | "shift_payout"
  | "floor_yield"
  | "sign_traffic"
  | "storm_shard"
  | "floor_purchase"
  | "sign_craft"
  | "signup_grant"
  | "landlord_royalty"
  | "floor_sale"
  | "floor_buy";

/**
 * Which credits count toward a season's "earned" score.
 *
 * This used to be "any positive amount", which quietly made the 500 $BLOCK
 * signup grant the single largest earning event available. Every new account
 * entered the leaderboard at 500 and outranked somebody who had actually played
 * their way to 400, and creating an account was worth more than a day of work —
 * which is precisely the incentive not to hand a prize competition.
 *
 * A grant is not an earning. Neither is buying something, which is negative
 * anyway. What remains is money that arrived because the player did something.
 */
export const SEASON_EARNING_KINDS: ReadonlySet<LedgerKind> = new Set([
  "shift_payout",
  "storm_shard",
  "sign_traffic",
  "floor_sale",
  "landlord_royalty",
]);

/**
 * Yield from owned floors, held separately because it is a live decision.
 *
 * Floor yield scales 1.0x to 3.5x with the tower's volatility tier, which is
 * derived from the real asset's behaviour. That is harmless while the score is
 * bragging rights. If a season's standings are ever paid out in something with
 * cash value, this term makes the payout partly a function of how a real
 * security performed — see docs/real-earning-plan.md section 2, which is the
 * one risk in this design that can end the project rather than cost money.
 *
 * Included for now, because excluding it would make the headline board ignore
 * the game's central mechanic. Remove this spread before the first paid season,
 * or accept the exposure knowingly. It is deliberately one line either way.
 */
export const MARKET_LINKED_EARNING_KINDS: ReadonlySet<LedgerKind> = new Set(["floor_yield"]);

/** The set actually applied. */
const COUNTS_AS_EARNED: ReadonlySet<LedgerKind> = new Set([
  ...SEASON_EARNING_KINDS,
  ...MARKET_LINKED_EARNING_KINDS,
]);

/** Anything with a mutable balance — in practice the Colyseus Player schema. */
export interface Balanced {
  block: number;
  shards: number;
}

interface PendingEntry {
  deviceId: string;
  kind: LedgerKind;
  amount: number;
  balanceAfter: number;
  ref: string | null;
  meta: Record<string, unknown>;
}

export interface PlayerRow {
  deviceId: string;
  wallet: string | null;
  name: string;
  color: string;
  block: number;
  charge: number;
  shards: number;
  x: number;
  z: number;
}

interface SeasonDelta {
  shards: number;
  earned: number;
  floorsBought: number;
}

export class Ledger {
  private entries: PendingEntry[] = [];
  private players = new Map<string, PlayerRow>();
  /** deviceId -> symbol -> absolute floor count. */
  private floors = new Map<string, Map<string, number>>();
  private season = new Map<string, SeasonDelta>();
  /** Credits for players who may be offline; applied as SQL increments. */
  private detached = new Map<string, { amount: number; kind: LedgerKind; meta: Record<string, unknown> }>();
  private seq = 0;

  /**
   * The write currently in progress, if any.
   *
   * A promise rather than a boolean because callers `await flush()` in order to
   * GUARANTEE their data is on disk — founding a crew needs the player row to
   * exist, and `/audit` compares balances it has just settled. The previous
   * boolean made `flush()` return immediately when another write was already
   * running, so those callers got a resolved promise and no write at all.
   *
   * That was invisible against a local database, where a flush finishes in
   * microseconds and is almost never in flight. Against managed Postgres in
   * another region a write takes hundreds of milliseconds and the periodic
   * flusher is frequently mid-transaction, so legitimate new players were told
   * to "play a little before founding a crew" and the audit could compare
   * against rows it believed it had just written.
   */
  private inFlight: Promise<void> | null = null;
  private timer?: NodeJS.Timeout;

  constructor(
    private db: Db,
    private seasonId: number
  ) {}

  start(intervalMs = 5000) {
    this.timer = setInterval(() => {
      this.flush().catch((err) => console.error("[ledger] flush failed:", err?.message ?? err));
    }, intervalMs);
  }

  async stop() {
    if (this.timer) clearInterval(this.timer);
    await this.flush();
  }

  setSeason(id: number) {
    this.seasonId = id;
  }

  get pending() {
    return this.entries.length;
  }

  /**
   * Move currency and record why.
   *
   * Applies the delta to the in-memory balance immediately — play must not wait
   * for a database — and queues the matching ledger row. `ref` makes an entry
   * idempotent: replaying the same reference inserts nothing.
   */
  post(
    deviceId: string,
    target: Balanced,
    kind: LedgerKind,
    amount: number,
    opts: { ref?: string; meta?: Record<string, unknown> } = {}
  ) {
    if (!isFinite(amount) || amount === 0) return;

    target.block += amount;

    this.entries.push({
      deviceId,
      kind,
      amount,
      balanceAfter: target.block,
      ref: opts.ref ?? null,
      meta: opts.meta ?? {},
    });

    // Positive AND earned. See SEASON_EARNING_KINDS: a signup grant moves the
    // balance up without anybody having earned anything.
    if (amount > 0 && COUNTS_AS_EARNED.has(kind)) {
      this.bumpSeason(deviceId, { earned: amount });
    }
    if (kind === "floor_purchase") this.bumpSeason(deviceId, { floorsBought: 1 });

    // A flood of entries between flushes shouldn't grow without bound. Losing
    // the oldest is preferable to exhausting memory, and it can only happen if
    // the database has been unreachable for a long time.
    if (this.entries.length > 20_000) this.entries.splice(0, this.entries.length - 20_000);
  }

  /**
   * Credit a player who may not be online.
   *
   * Landlord royalties are owed whether or not the landlord is connected, so
   * there is no in-memory balance to adjust. These are applied as an atomic
   * SQL increment *after* the absolute player upserts in the same transaction —
   * order matters, because an upsert writes the whole balance from memory and
   * would otherwise overwrite the increment.
   *
   * Credits are aggregated per player per flush, so a landlord of twenty towers
   * costs one UPDATE rather than twenty.
   */
  postDetached(
    deviceId: string,
    kind: LedgerKind,
    amount: number,
    meta: Record<string, unknown> = {}
  ) {
    if (!isFinite(amount) || amount <= 0) return;
    const current = this.detached.get(deviceId) ?? { amount: 0, kind, meta };
    current.amount += amount;
    this.detached.set(deviceId, current);
  }

  /** Record shards collected (not currency, but season-ranked). */
  postShards(deviceId: string, target: Balanced, count: number) {
    if (count <= 0) return;
    target.shards += count;
    this.bumpSeason(deviceId, { shards: count });
  }

  /** Queue the player's row for upsert. Last value before a flush wins. */
  markPlayer(row: PlayerRow) {
    this.players.set(row.deviceId, { ...row });
  }

  /** Queue absolute floor counts for a player. */
  markFloors(deviceId: string, counts: Map<string, number>) {
    this.floors.set(deviceId, new Map(counts));
  }

  /** A unique reference for an action, for idempotency. */
  ref(prefix: string) {
    return `${prefix}:${Date.now().toString(36)}:${(this.seq++).toString(36)}`;
  }

  private bumpSeason(deviceId: string, delta: Partial<SeasonDelta>) {
    const current = this.season.get(deviceId) ?? { shards: 0, earned: 0, floorsBought: 0 };
    current.shards += delta.shards ?? 0;
    current.earned += delta.earned ?? 0;
    current.floorsBought += delta.floorsBought ?? 0;
    this.season.set(deviceId, current);
  }

  /**
   * Drain everything queued into one transaction.
   *
   * Ordering matters: players are upserted first so that ledger, floors and
   * season rows all have a player id to reference.
   */
  async flush(): Promise<void> {
    /**
     * Wait out any write already running before judging whether there is work.
     *
     * The in-flight batch was taken before this caller queued anything, so its
     * completion says nothing about this caller's rows. Looping rather than a
     * single await handles several callers arriving at once.
     */
    while (this.inFlight) {
      await this.inFlight.catch(() => {
        /* the owner of that write reports its own failure */
      });
    }

    if (
      this.entries.length === 0 &&
      this.players.size === 0 &&
      this.floors.size === 0 &&
      this.season.size === 0 &&
      this.detached.size === 0
    ) {
      return;
    }

    // Take the batch before awaiting, so gameplay continuing during the write
    // accumulates into the next one rather than being lost.
    const entries = this.entries;
    const players = this.players;
    const floors = this.floors;
    const season = this.season;
    const detached = this.detached;
    this.entries = [];
    this.players = new Map();
    this.floors = new Map();
    this.season = new Map();
    this.detached = new Map();

    /**
     * Retried on deadlock, because losing one is not an error.
     *
     * Postgres breaks a deadlock by aborting one side; the loser is expected to
     * try again, and by then the winner has committed and released its locks.
     * Ordering the writes above makes this rare, but concurrent transactions
     * elsewhere in the game can still produce one, and the correct response is
     * a retry rather than an error the caller has to interpret.
     *
     * Only 40P01 is retried. Anything else is a real failure and must surface.
     */
    const runBatch = async (): Promise<void> => {
      await this.db.begin(async (tx) => {
        const ids = await upsertPlayers(tx, players, floors, entries, season, detached);
        await insertLedger(tx, entries, ids);
        await upsertFloors(tx, floors, ids);
        await upsertSeason(tx, season, ids, this.seasonId);
        // Last: increments must land after the absolute balance upserts above.
        await applyDetached(tx, detached, ids);
      });
    };

    const write = (async () => {
      for (let attempt = 0; ; attempt++) {
        try {
          await runBatch();
          return;
        } catch (err) {
          const deadlock = (err as { code?: string })?.code === "40P01";
          if (!deadlock || attempt >= 2) throw err;
          console.warn(`[ledger] deadlock, retrying batch (attempt ${attempt + 2}/3)`);
          // A short, growing pause so both losers do not collide again at once.
          await new Promise((r) => setTimeout(r, 40 * (attempt + 1)));
        }
      }
    })();
    /**
     * Published before awaiting, so a concurrent caller waits for THIS write.
     *
     * The rejection handler is not optional. `write.then(fn)` returns a NEW
     * promise, and if the write fails while no other caller happens to be
     * awaiting `inFlight`, that derived promise rejects with nobody listening.
     * Node reports an unhandled rejection, and this server treats those as
     * fatal — so a single failed flush took the whole process down. A database
     * deadlock is a routine, recoverable event; it must never be able to do
     * that.
     *
     * Swallowing here is safe because the real error is still delivered to the
     * `await write` below, which is where it gets reported and where the batch
     * is put back.
     */
    this.inFlight = write.then(
      () => undefined,
      () => undefined
    );

    try {
      await write;
    } catch (err) {
      // Put the batch back so a transient database problem doesn't lose
      // progress; the next tick retries it.
      this.entries = entries.concat(this.entries);
      for (const [k, v] of players) if (!this.players.has(k)) this.players.set(k, v);
      for (const [k, v] of floors) if (!this.floors.has(k)) this.floors.set(k, v);
      for (const [k, v] of season) this.bumpSeason(k, v);
      for (const [k, v] of detached) {
        const existing = this.detached.get(k);
        if (existing) existing.amount += v.amount;
        else this.detached.set(k, v);
      }
      throw err;
    } finally {
      this.inFlight = null;
    }
  }
}

// ---------------------------------------------------------------------------
// Batch writers
// ---------------------------------------------------------------------------

/** Upsert every player touched by this batch, returning deviceId -> id. */
async function upsertPlayers(
  tx: Db,
  players: Map<string, PlayerRow>,
  floors: Map<string, Map<string, number>>,
  entries: PendingEntry[],
  season: Map<string, SeasonDelta>,
  detached: Map<string, { amount: number; kind: LedgerKind; meta: Record<string, unknown> }>
): Promise<Map<string, number>> {
  // Anything referenced anywhere in the batch needs a row to point at.
  const needed = new Set<string>([
    ...players.keys(),
    ...floors.keys(),
    ...season.keys(),
    ...detached.keys(),
    ...entries.map((e) => e.deviceId),
  ]);
  if (needed.size === 0) return new Map();

  /**
   * Always touch player rows in the same order.
   *
   * Two transactions that lock the same rows in opposite orders deadlock, and
   * Postgres resolves that by killing one of them. This set is built from
   * several maps whose iteration order follows whatever happened during the
   * tick, so two consecutive flushes could genuinely disagree about the order —
   * and a flush racing a floor-market transaction did, taking the server with
   * it.
   *
   * Sorting costs nothing at this size and removes the whole class: any two
   * writers that both lock in device-id order can queue, but cannot deadlock.
   */
  for (const deviceId of [...needed].sort()) {
    const row = players.get(deviceId);
    if (row) {
      await tx.query(
        `INSERT INTO players (device_id, wallet, name, color, block, charge, shards, x, z, last_seen_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, now())
         ON CONFLICT (device_id) DO UPDATE SET
           wallet       = COALESCE(EXCLUDED.wallet, players.wallet),
           name         = EXCLUDED.name,
           color        = EXCLUDED.color,
           block        = EXCLUDED.block,
           charge       = EXCLUDED.charge,
           shards       = EXCLUDED.shards,
           x            = EXCLUDED.x,
           z            = EXCLUDED.z,
           last_seen_at = now()`,
        [
          row.deviceId,
          row.wallet,
          row.name,
          row.color,
          round(row.block),
          round(row.charge),
          Math.max(0, Math.round(row.shards)),
          row.x,
          row.z,
        ]
      );
    } else {
      // Referenced but not marked — make sure a row exists to attach to.
      await tx.query(
        `INSERT INTO players (device_id) VALUES ($1) ON CONFLICT (device_id) DO NOTHING`,
        [deviceId]
      );
    }
  }

  const rows = await tx.query<{ id: string | number; device_id: string }>(
    `SELECT id, device_id FROM players WHERE device_id = ANY($1)`,
    [[...needed]]
  );

  const map = new Map<string, number>();
  for (const r of rows) map.set(r.device_id, Number(r.id));

  // Lifetime earnings are a running total, so they're accumulated here rather
  // than overwritten from an in-memory value that only counts this session.
  const earned = new Map<string, number>();
  for (const e of entries) {
    if (e.amount > 0) earned.set(e.deviceId, (earned.get(e.deviceId) ?? 0) + e.amount);
  }
  for (const [deviceId, total] of earned) {
    const id = map.get(deviceId);
    if (id) {
      await tx.query("UPDATE players SET lifetime_earned = lifetime_earned + $1 WHERE id = $2", [
        round(total),
        id,
      ]);
    }
  }

  return map;
}

async function insertLedger(tx: Db, entries: PendingEntry[], ids: Map<string, number>) {
  for (const e of entries) {
    const id = ids.get(e.deviceId);
    if (!id) continue;
    // ON CONFLICT on `ref` is what makes a replayed batch a no-op.
    await tx.query(
      `INSERT INTO ledger (player_id, kind, amount, balance_after, ref, meta)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (ref) DO NOTHING`,
      [id, e.kind, round(e.amount), round(e.balanceAfter), e.ref, JSON.stringify(e.meta)]
    );
  }
}

async function upsertFloors(
  tx: Db,
  floors: Map<string, Map<string, number>>,
  ids: Map<string, number>
) {
  for (const [deviceId, counts] of floors) {
    const id = ids.get(deviceId);
    if (!id) continue;
    for (const [symbol, count] of counts) {
      if (count <= 0) {
        await tx.query("DELETE FROM floors WHERE player_id = $1 AND symbol = $2", [id, symbol]);
        continue;
      }
      await tx.query(
        `INSERT INTO floors (player_id, symbol, count) VALUES ($1,$2,$3)
         ON CONFLICT (player_id, symbol) DO UPDATE SET count = EXCLUDED.count`,
        [id, symbol, Math.round(count)]
      );
    }
  }
}

async function upsertSeason(
  tx: Db,
  season: Map<string, SeasonDelta>,
  ids: Map<string, number>,
  seasonId: number
) {
  for (const [deviceId, delta] of season) {
    const id = ids.get(deviceId);
    if (!id) continue;
    await tx.query(
      `INSERT INTO season_stats (season_id, player_id, shards_collected, block_earned, floors_bought)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (season_id, player_id) DO UPDATE SET
         shards_collected = season_stats.shards_collected + EXCLUDED.shards_collected,
         block_earned     = season_stats.block_earned + EXCLUDED.block_earned,
         floors_bought    = season_stats.floors_bought + EXCLUDED.floors_bought`,
      [seasonId, id, Math.round(delta.shards), round(delta.earned), Math.round(delta.floorsBought)]
    );
  }
}

/**
 * Apply offline credits as atomic increments, recording the matching ledger
 * rows with the resulting balance.
 *
 * `RETURNING block` gives the post-increment value, so `balance_after` stays
 * truthful rather than a guess — it's the column used to reconstruct history
 * when auditing a disputed balance.
 */
async function applyDetached(
  tx: Db,
  detached: Map<string, { amount: number; kind: LedgerKind; meta: Record<string, unknown> }>,
  ids: Map<string, number>
) {
  for (const [deviceId, credit] of detached) {
    const id = ids.get(deviceId);
    if (!id) continue;

    const rows = await tx.query<{ block: number }>(
      `UPDATE players
       SET block = block + $1, lifetime_earned = lifetime_earned + $1
       WHERE id = $2
       RETURNING block::float8 AS block`,
      [round(credit.amount), id]
    );
    const balanceAfter = Number(rows[0]?.block ?? 0);

    await tx.query(
      `INSERT INTO ledger (player_id, kind, amount, balance_after, meta)
       VALUES ($1,$2,$3,$4,$5)`,
      [id, credit.kind, round(credit.amount), round(balanceAfter), JSON.stringify(credit.meta)]
    );
  }
}

function round(v: number) {
  return Math.round(v * 10000) / 10000;
}
