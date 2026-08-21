import type { Db } from "../db/db.js";

/**
 * Player-to-player floor market.
 *
 * The whole feature turns on one property: **a purchase moves the floor and the
 * money together, or neither.** Taking payment without delivering the floor is
 * the worst bug this can have, so settlement is a single transaction and every
 * precondition is re-checked inside it — not at listing time, when the seller
 * may still have owned what they're selling.
 *
 * Balances are adjusted here in SQL rather than through the in-memory Ledger,
 * because either party may be offline. Ledger rows are written in the same
 * transaction so `SUM(ledger) == balance` continues to hold for both sides.
 */

export const MIN_PRICE = 1;
export const MAX_PRICE = 1_000_000;
/** Listings one player may have open at once. */
const MAX_OPEN_PER_PLAYER = 10;

export interface Listing {
  id: number;
  symbol: string;
  price: number;
  sellerName: string;
  sellerDevice: string;
  createdAt: number;
}

export type ListResult = { ok: true; id: number } | { ok: false; reason: string };
export type BuyResult =
  | {
      ok: true;
      symbol: string;
      price: number;
      sellerName: string;
      sellerDevice: string;
      /**
       * Authoritative balances, straight out of the settling transaction.
       *
       * The room used to re-read these from the database afterwards, which is a
       * second round trip the periodic flusher can slip inside — writing a stale
       * in-memory balance over the settled trade. Returning them here means the
       * room can apply the true values without asking again.
       */
      buyerBlock: number;
      sellerBlock: number;
    }
  | { ok: false; reason: string };

export class MarketService {
  constructor(private db: Db) {}

  /** Open listings, cheapest first. */
  async open(limit = 200): Promise<Listing[]> {
    const rows = await this.db.query<{
      id: string | number;
      symbol: string;
      price: number;
      name: string;
      device_id: string;
      created_at: string;
    }>(
      `SELECT l.id, l.symbol, l.price::float8 AS price, p.name, p.device_id, l.created_at
       FROM listings l JOIN players p ON p.id = l.seller_id
       WHERE l.sold_at IS NULL
       ORDER BY l.symbol, l.price ASC
       LIMIT $1`,
      [limit]
    );

    return rows.map((r) => ({
      id: Number(r.id),
      symbol: r.symbol,
      price: Number(r.price),
      sellerName: r.name || "Trader",
      sellerDevice: r.device_id,
      createdAt: new Date(r.created_at).getTime(),
    }));
  }

  /**
   * List a floor for sale.
   *
   * The floor is not escrowed — the seller keeps using it until it sells, and
   * ownership is re-checked at purchase. Escrowing would mean a listed floor
   * stops earning, which quietly punishes anyone who lists.
   */
  async list(deviceId: string, symbol: string, rawPrice: number): Promise<ListResult> {
    const price = Math.round(Number(rawPrice));
    if (!isFinite(price) || price < MIN_PRICE || price > MAX_PRICE) {
      return { ok: false, reason: `Price must be between ${MIN_PRICE} and ${MAX_PRICE}.` };
    }
    if (typeof symbol !== "string" || !symbol) return { ok: false, reason: "Pick a tower." };

    return this.db.begin(async (tx) => {
      const player = await one<{ id: string | number }>(
        tx,
        "SELECT id FROM players WHERE device_id = $1",
        [deviceId]
      );
      if (!player) return { ok: false, reason: "Unknown player." };
      const sellerId = Number(player.id);

      const held = await one<{ count: number }>(
        tx,
        "SELECT count FROM floors WHERE player_id = $1 AND symbol = $2",
        [sellerId, symbol]
      );
      const owned = Number(held?.count ?? 0);
      if (owned < 1) return { ok: false, reason: `You don't own a floor in ${symbol}.` };

      // Can't list more floors than you hold, counting what's already listed.
      const openRows = await tx.query<{ n: number; forSymbol: number }>(
        `SELECT COUNT(*)::int AS n,
                COUNT(*) FILTER (WHERE symbol = $2)::int AS "forSymbol"
         FROM listings WHERE seller_id = $1 AND sold_at IS NULL`,
        [sellerId, symbol]
      );
      const openTotal = Number(openRows[0]?.n ?? 0);
      const openForSymbol = Number(openRows[0]?.forSymbol ?? 0);

      if (openTotal >= MAX_OPEN_PER_PLAYER) {
        return { ok: false, reason: `You already have ${MAX_OPEN_PER_PLAYER} listings open.` };
      }
      if (openForSymbol >= owned) {
        return { ok: false, reason: `All your ${symbol} floors are already listed.` };
      }

      const created = await one<{ id: string | number }>(
        tx,
        "INSERT INTO listings (seller_id, symbol, price) VALUES ($1,$2,$3) RETURNING id",
        [sellerId, symbol, price]
      );
      return { ok: true, id: Number(created!.id) };
    });
  }

  async cancel(deviceId: string, listingId: number): Promise<{ ok: boolean; reason?: string }> {
    const rows = await this.db.query(
      `DELETE FROM listings
       WHERE id = $1 AND sold_at IS NULL
         AND seller_id = (SELECT id FROM players WHERE device_id = $2)
       RETURNING id`,
      [listingId, deviceId]
    );
    return rows.length ? { ok: true } : { ok: false, reason: "Listing is gone." };
  }

  /**
   * Buy a listed floor.
   *
   * Everything is verified inside the transaction: the listing is still open,
   * the seller still owns a floor there, and the buyer can afford it. A floor
   * sold twice, or sold after being traded away, fails cleanly and moves
   * nothing.
   */
  /**
   * Buy a listed floor.
   *
   * Retried on deadlock. Ordering the player locks makes one unlikely, but two
   * trades touching an overlapping pair of players can still collide, and
   * Postgres settles that by aborting one of them.
   *
   * Retrying is safe because the whole transaction rolls back: the listing claim
   * that marks it sold is undone with everything else, so the second attempt
   * sees exactly the state the first one did. Without this the losing player
   * simply loses the trade for reasons they cannot see or act on, which is the
   * worst possible way to spend somebody's money.
   */
  async buy(buyerDevice: string, listingId: number): Promise<BuyResult> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.buyOnce(buyerDevice, listingId);
      } catch (err) {
        const deadlock = (err as { code?: string })?.code === "40P01";
        if (!deadlock || attempt >= 2) throw err;
        console.warn(`[market] deadlock on buy, retrying (attempt ${attempt + 2}/3)`);
        await new Promise((r) => setTimeout(r, 40 * (attempt + 1)));
      }
    }
  }

  private async buyOnce(buyerDevice: string, listingId: number): Promise<BuyResult> {
    return this.db
      .begin<BuyResult>(async (tx) => {
      // Claim the listing first. Marking it sold up front means a second buyer
      // in the same instant finds nothing to claim rather than racing us.
      const claimed = await one<{
        id: string | number;
        seller_id: string | number;
        symbol: string;
        price: number;
      }>(
        tx,
        `UPDATE listings SET sold_at = now()
         WHERE id = $1 AND sold_at IS NULL
         RETURNING id, seller_id, symbol, price::float8 AS price`,
        [listingId]
      );
      if (!claimed) return { ok: false, reason: "Already sold." };

      const sellerId = Number(claimed.seller_id);
      const price = Number(claimed.price);
      const symbol = claimed.symbol;

      const buyer = await one<{ id: string | number; block: number }>(
        tx,
        "SELECT id, block::float8 AS block FROM players WHERE device_id = $1",
        [buyerDevice]
      );
      if (!buyer) throw new Error("buyer missing");
      const buyerId = Number(buyer.id);

      if (buyerId === sellerId) {
        throw new MarketAbort("That's your own listing.");
      }
      if (Number(buyer.block) < price) {
        throw new MarketAbort(`Need ${price} $BLOCK, you have ${Math.floor(Number(buyer.block))}.`);
      }

      // Re-check ownership now, not at listing time — the seller may have sold
      // or traded the floor since.
      const held = await one<{ count: number }>(
        tx,
        "SELECT count FROM floors WHERE player_id = $1 AND symbol = $2",
        [sellerId, symbol]
      );
      if (!held || Number(held.count) < 1) {
        throw new MarketAbort("Seller no longer owns that floor.");
      }

      // ---- move the floor ------------------------------------------------
      if (Number(held.count) === 1) {
        await tx.query("DELETE FROM floors WHERE player_id = $1 AND symbol = $2", [sellerId, symbol]);
      } else {
        await tx.query(
          "UPDATE floors SET count = count - 1 WHERE player_id = $1 AND symbol = $2",
          [sellerId, symbol]
        );
      }
      await tx.query(
        `INSERT INTO floors (player_id, symbol, count) VALUES ($1,$2,1)
         ON CONFLICT (player_id, symbol) DO UPDATE SET count = floors.count + 1`,
        [buyerId, symbol]
      );

      // ---- move the money --------------------------------------------------
      /**
       * Lock both player rows up front, in id order.
       *
       * The updates below touch the buyer and then the seller, always in that
       * order. The ledger flusher touches whatever players its batch contains,
       * in its own order. Two transactions taking the same locks in different
       * orders is the definition of a deadlock, and Postgres resolves it by
       * killing one of them — which is what happened here, repeatedly, under
       * nothing more exotic than a trade landing during a routine flush.
       *
       * Taking both locks in a single statement ordered by id gives every
       * writer the same sequence. Contending transactions then queue instead of
       * dying. This has to happen before the first UPDATE, because by then the
       * lock has already been taken in the wrong order.
       */
      await tx.query(
        "SELECT id FROM players WHERE id IN ($1,$2) ORDER BY id FOR UPDATE",
        [buyerId, sellerId]
      );

      const buyerAfter = await one<{ block: number }>(
        tx,
        "UPDATE players SET block = block - $1 WHERE id = $2 RETURNING block::float8 AS block",
        [price, buyerId]
      );
      const sellerAfter = await one<{ block: number; name: string; device_id: string }>(
        tx,
        `UPDATE players SET block = block + $1, lifetime_earned = lifetime_earned + $1
         WHERE id = $2 RETURNING block::float8 AS block, name, device_id`,
        [price, sellerId]
      );

      await tx.query(
        `INSERT INTO ledger (player_id, kind, amount, balance_after, ref, meta)
         VALUES ($1,'floor_buy',$2,$3,$4,$5)`,
        [
          buyerId,
          -price,
          Number(buyerAfter?.block ?? 0),
          `buy:${listingId}`,
          JSON.stringify({ symbol, listingId }),
        ]
      );
      await tx.query(
        `INSERT INTO ledger (player_id, kind, amount, balance_after, ref, meta)
         VALUES ($1,'floor_sale',$2,$3,$4,$5)`,
        [
          sellerId,
          price,
          Number(sellerAfter?.block ?? 0),
          `sale:${listingId}`,
          JSON.stringify({ symbol, listingId }),
        ]
      );

      await tx.query("UPDATE listings SET buyer_id = $1 WHERE id = $2", [buyerId, listingId]);

        return {
          ok: true as const,
          symbol,
          price,
          sellerName: sellerAfter?.name || "Trader",
          // The caller needs this to refresh the seller's live room state. If
          // the seller is online, their in-memory balance and floors are now
          // stale, and the next flush would write them back over this trade.
          sellerDevice: sellerAfter?.device_id ?? "",
          buyerBlock: Number(buyerAfter?.block ?? 0),
          sellerBlock: Number(sellerAfter?.block ?? 0),
        };
      })
      .catch((err): BuyResult => {
        // A refusal rolls the whole transaction back, so the listing is
        // released and nothing moved. Anything else is a real fault.
        if (err instanceof MarketAbort) return { ok: false, reason: err.message };
        throw err;
      });
  }
}

/** Thrown to abort a purchase and roll back, carrying a player-facing reason. */
class MarketAbort extends Error {}

async function one<T>(db: Db, sql: string, params: unknown[]): Promise<T | undefined> {
  const rows = await db.query<T>(sql, params);
  return rows[0];
}
