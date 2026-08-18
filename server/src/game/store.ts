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
   * Link a verified wallet to a save.
   *
   * If the wallet has been seen before, its original save wins — it may hold
   * progress made from another browser. Otherwise the current guest save is
   * adopted, so nothing earned before connecting is lost.
   */
  async linkWallet(wallet: string, deviceId: string): Promise<string> {
    const existing = await this.db.query<{ device_id: string }>(
      "SELECT device_id FROM players WHERE wallet = $1",
      [wallet]
    );
    if (existing[0]) return existing[0].device_id;

    await this.db.query(
      `INSERT INTO players (device_id, wallet) VALUES ($1, $2)
       ON CONFLICT (device_id) DO UPDATE SET wallet = EXCLUDED.wallet`,
      [deviceId, wallet]
    );
    return deviceId;
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
