import type { Db } from "../db/db.js";

/**
 * Read-side repository.
 *
 * Everything here is a query. All *writes* go through the Ledger's batched
 * flusher — that separation is deliberate, because the previous design wrote
 * synchronously from the game loop and stalled the simulation once a minute.
 *
 * Identity is a client-generated device id until a wallet is linked. That is
 * not authentication; it exists so casual play survives a reload.
 */

export interface SavedPlayer {
  deviceId: string;
  wallet: string | null;
  name: string;
  color: string;
  block: number;
  charge: number;
  shards: number;
  floors: Record<string, number>;
  x: number;
  z: number;
}

export interface SavedSign {
  id: string;
  deviceId: string;
  symbol: string;
  ownerName: string;
  text: string;
  color: string;
  floor: number;
}

export class Store {
  constructor(private db: Db) {}

  /** Load a player and their floors in one round trip each. */
  async loadPlayer(deviceId: string): Promise<SavedPlayer | null> {
    const rows = await this.db.query<{
      id: string | number;
      device_id: string;
      wallet: string | null;
      name: string;
      color: string;
      block: number;
      charge: number;
      shards: number;
      x: number;
      z: number;
    }>(
      `SELECT id, device_id, wallet, name, color,
              block::float8 AS block, charge::float8 AS charge,
              shards, x, z
       FROM players WHERE device_id = $1`,
      [deviceId]
    );

    const row = rows[0];
    if (!row) return null;

    const floorRows = await this.db.query<{ symbol: string; count: number }>(
      "SELECT symbol, count FROM floors WHERE player_id = $1",
      [Number(row.id)]
    );

    const floors: Record<string, number> = {};
    for (const f of floorRows) floors[f.symbol] = Number(f.count);

    return {
      deviceId: row.device_id,
      wallet: row.wallet,
      name: row.name,
      color: row.color,
      block: Number(row.block),
      charge: Number(row.charge),
      shards: Number(row.shards),
      floors,
      x: Number(row.x),
      z: Number(row.z),
    };
  }

  /**
   * Total floors leased per tower, across every player including offline ones.
   *
   * A single grouped aggregate — the previous implementation read every player
   * row and JSON-parsed it, which was O(everyone who ever played) on each boot.
   */
  async floorTotals(): Promise<Record<string, number>> {
    const rows = await this.db.query<{ symbol: string; total: number }>(
      "SELECT symbol, SUM(count)::int AS total FROM floors GROUP BY symbol"
    );
    const totals: Record<string, number> = {};
    for (const r of rows) totals[r.symbol] = Number(r.total);
    return totals;
  }

  async allSigns(): Promise<SavedSign[]> {
    const rows = await this.db.query<{
      id: string;
      device_id: string;
      symbol: string;
      name: string;
      text: string;
      color: string;
      floor: number;
    }>(
      `SELECT s.id, p.device_id, s.symbol, p.name, s.text, s.color, s.floor
       FROM signs s JOIN players p ON p.id = s.player_id`
    );

    return rows.map((r) => ({
      id: r.id,
      deviceId: r.device_id,
      symbol: r.symbol,
      ownerName: r.name,
      text: r.text,
      color: r.color,
      floor: Number(r.floor),
    }));
  }

  /** Signs are rare and player-initiated, so they write through immediately. */
  async saveSign(sign: SavedSign): Promise<void> {
    const ids = await this.db.query<{ id: string | number }>(
      "SELECT id FROM players WHERE device_id = $1",
      [sign.deviceId]
    );
    const playerId = ids[0]?.id;
    if (!playerId) return;

    await this.db.query(
      `INSERT INTO signs (id, player_id, symbol, text, color, floor)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (id) DO NOTHING`,
      [sign.id, Number(playerId), sign.symbol, sign.text, sign.color, sign.floor]
    );
  }

  /**
   * Attach a proved wallet to this account.
   *
   * Deliberately does NOT touch the save. The previous version adopted whichever
   * save the wallet had played on before, because back then the wallet *was* the
   * identity. With accounts, that behaviour becomes a second identity system
   * competing with the first: sign in as yourself, connect a wallet that once
   * played in another browser, and someone else's balance and floors land on
   * your account. Privy decides who you are; this only records what you hold.
   *
   * @returns ok, or the reason it was refused.
   */
  async linkWallet(
    wallet: string,
    deviceId: string
  ): Promise<{ ok: true } | { ok: false; reason: string }> {
    const players = await this.db.query<{ id: string | number }>(
      "SELECT id FROM players WHERE device_id = $1",
      [deviceId]
    );
    const playerId = players[0] ? Number(players[0].id) : null;
    if (playerId === null) return { ok: false, reason: "No save to attach this wallet to." };

    /**
     * Also refuse an address held by another row's legacy players.wallet.
     *
     * player_wallets is backfilled from that column at migration time, but a row
     * written before the table existed — or by anything that still sets the
     * column directly — is invisible to the primary key below. Without this the
     * address would be claimed here and then silently fail to appear as the
     * display wallet, leaving two accounts disagreeing about who owns it.
     */
    const legacy = await this.db.query<{ id: string | number }>(
      "SELECT id FROM players WHERE wallet = $1 AND id <> $2",
      [wallet, playerId]
    );
    if (legacy[0]) {
      return { ok: false, reason: "That wallet is already connected to another account." };
    }

    /**
     * One wallet, one account — enforced by the primary key rather than by a
     * check-then-insert, which two simultaneous connections could both pass.
     * DO NOTHING plus a re-read tells us whether we won it.
     */
    await this.db.query(
      `INSERT INTO player_wallets (address, player_id) VALUES ($1, $2)
       ON CONFLICT (address) DO NOTHING`,
      [wallet, playerId]
    );

    const owner = await this.db.query<{ player_id: string | number }>(
      "SELECT player_id FROM player_wallets WHERE address = $1",
      [wallet]
    );
    if (!owner[0] || Number(owner[0].player_id) !== playerId) {
      return { ok: false, reason: "That wallet is already connected to another account." };
    }

    /**
     * players.wallet stays as the display address — leaderboards show one. It is
     * no longer where holdings are read from, so it is only set when empty and
     * never overwritten by a later link.
     */
    /**
     * players.wallet is the display address only — leaderboards show one wallet,
     * not a list. Holdings are read from player_wallets, so this is cosmetic.
     *
     * It carries a UNIQUE constraint from when it *was* the identity, and rows
     * written before player_wallets existed can still hold an address that is
     * not mirrored there. Setting it blindly then throws a constraint violation
     * out of a link that had already succeeded. Since it is only a label, it is
     * set when free and skipped when not.
     */
    await this.db.query(
      `UPDATE players SET wallet = $2
        WHERE device_id = $1
          AND (wallet IS NULL OR wallet = '')
          AND NOT EXISTS (SELECT 1 FROM players other WHERE other.wallet = $2)`,
      [deviceId, wallet]
    );

    return { ok: true };
  }

  /**
   * Every wallet proved by this account.
   *
   * Holdings are resolved across all of them: people routinely keep tokens in
   * one wallet and spend from another, and a single-address check refuses a
   * genuine holder — the one failure the whole gating design must not produce.
   */
  async walletsFor(deviceId: string): Promise<string[]> {
    /**
     * The legacy players.wallet is unioned in deliberately.
     *
     * It is backfilled into player_wallets at migration time, so in practice the
     * two agree — but if a row ever drifts, the cost of each direction is wildly
     * asymmetric. Missing an address refuses a genuine holder, which is a refund
     * request; including a stale one costs a chain read that returns nothing.
     * When in doubt, read the extra address.
     */
    const rows = await this.db.query<{ address: string }>(
      `SELECT w.address, w.linked_at
         FROM player_wallets w
         JOIN players p ON p.id = w.player_id
        WHERE p.device_id = $1
        UNION
       SELECT p.wallet AS address, p.created_at AS linked_at
         FROM players p
        WHERE p.device_id = $1 AND p.wallet IS NOT NULL AND p.wallet <> ''
        ORDER BY linked_at`,
      [deviceId]
    );

    // UNION can still return the same address twice when the timestamps differ.
    return [...new Set(rows.map((r) => r.address))];
  }

  async walletFor(deviceId: string): Promise<string | null> {
    const rows = await this.db.query<{ wallet: string | null }>(
      "SELECT wallet FROM players WHERE device_id = $1",
      [deviceId]
    );
    return rows[0]?.wallet ?? null;
  }

  /** Population counters for /health. */
  async stats(): Promise<{ players: number; floors: number; signs: number; ledger: number }> {
    const rows = await this.db.query<{
      players: number;
      floors: number;
      signs: number;
      ledger: number;
    }>(`
      SELECT
        (SELECT COUNT(*) FROM players)::int              AS players,
        (SELECT COALESCE(SUM(count),0) FROM floors)::int AS floors,
        (SELECT COUNT(*) FROM signs)::int                AS signs,
        (SELECT COUNT(*) FROM ledger)::int               AS ledger
    `);
    const r = rows[0];
    return {
      players: Number(r?.players ?? 0),
      floors: Number(r?.floors ?? 0),
      signs: Number(r?.signs ?? 0),
      ledger: Number(r?.ledger ?? 0),
    };
  }
}
