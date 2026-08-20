import { createHmac, randomBytes } from "node:crypto";
import type { Db } from "../db/db.js";
import { sanitise } from "./chat.js";

/**
 * Crew history and direct messages.
 *
 * These are the two places chat needs storage. Proximity and district chat are
 * correctly ephemeral — you had to be standing there — but:
 *
 *   **Crew** is about who you are with, not where you stand, so people expect
 *   scrollback. A message posted while you slept should still be there.
 *
 *   **A DM to somebody offline** that vanishes is not a direct message.
 *
 * ---------------------------------------------------------------------------
 * Device ids never leave the server
 *
 * A device id IS the guest identity — `onJoin` trusts it. Handing one to a
 * client would let anyone join as that player. So a live message is addressed by
 * *session*, and a stored conversation is addressed by an opaque handle that
 * this file mints and resolves. Neither is a device id, and neither can be
 * turned back into one.
 */

/** Crew lines replayed on join. Enough to catch up, not enough to be a wall. */
const CREW_HISTORY = 40;
/** Conversation length returned when a thread is opened. */
const THREAD_LENGTH = 50;

/**
 * DMs a player may send in a burst, and how fast the allowance returns.
 *
 * Tighter than proximity chat. A local message reaches whoever is standing
 * nearby and stops; a DM reaches a specific person wherever they are, which is
 * the shape spam takes.
 */
const DM_BURST = 5;
const DM_REFILL_MS = 4000;

export interface CrewLine {
  name: string;
  text: string;
  at: number;
}

export interface DirectLine {
  id: number;
  fromName: string;
  /** True when the local player sent it. */
  mine: boolean;
  text: string;
  at: number;
}

export interface Thread {
  /**
   * An opaque handle for the other party — NOT their device id.
   *
   * See `handleFor` below. This is the field the client echoes back to reopen
   * or block a conversation.
   */
  device: string;
  name: string;
  lastText: string;
  at: number;
  unread: number;
}

/**
 * The outcome of a send.
 *
 * `delivered` and `text` are for the server only and must never reach a client.
 * A blocked send reports `ok: true` — deliberately indistinguishable from
 * success — with `delivered: false`, which is what stops the room forwarding a
 * live copy to a recipient who is online. Without that flag a block would only
 * work while its target happened to be logged off.
 */
export type SendResult =
  | { ok: true; at: number; delivered: boolean; text: string }
  | { ok: false; reason: string };

interface Bucket {
  tokens: number;
  refilledAt: number;
}

export class MessageService {
  private buckets = new Map<string, Bucket>();

  /**
   * Keys the conversation handles.
   *
   * Regenerated every start, so a handle is worthless the moment the process
   * restarts. Clients are pushed a fresh inbox on join anyway, which is what
   * makes rotating it free.
   */
  private readonly handleKey = randomBytes(32);

  constructor(private db: Db) {}

  // ------------------------------------------------------------ handles ----

  /**
   * A stable, opaque name for one player, safe to send to another.
   *
   * A device id cannot leave the server — `onJoin` treats one as proof of
   * identity, so handing Bob Alice's device id would let Bob join *as* Alice.
   * But the client still has to be able to say "reopen the conversation with
   * that person", so it gets a keyed hash instead: stable within a run,
   * meaningless outside it, and not reversible.
   */
  handleFor(device: string): string {
    return createHmac("sha256", this.handleKey).update(device).digest("base64url").slice(0, 22);
  }

  /**
   * Turn a handle back into a device id.
   *
   * Deliberately scoped: it only searches people `device` has actually
   * exchanged messages with. A handle for a stranger resolves to nothing even if
   * it is genuine, so the worst a guessed handle can do is reach somebody the
   * sender could already reach.
   */
  async resolveHandle(device: string, handle: string): Promise<string> {
    if (!device || !handle) return "";
    const rows = await this.db.query<{ other: string }>(
      `SELECT DISTINCT CASE WHEN from_device = $1 THEN to_device ELSE from_device END AS other
       FROM direct_messages
       WHERE from_device = $1 OR to_device = $1`,
      [device]
    );
    for (const row of rows) {
      if (this.handleFor(row.other) === handle) return row.other;
    }
    return "";
  }

  // -------------------------------------------------------------- crew ----

  /**
   * The last lines a crew said, oldest first.
   *
   * Returns nothing for a player with no crew — matching on an empty tag would
   * hand every crewless player the same shared history, which is the global
   * channel this game deliberately does not have.
   */
  async crewHistory(crewTag: string): Promise<CrewLine[]> {
    if (!crewTag) return [];
    const rows = await this.db.query<{ name: string; text: string; at: string }>(
      `SELECT name, text, at FROM chat_log
       WHERE crew_tag = $1 AND channel = 'crew'
       ORDER BY at DESC
       LIMIT $2`,
      [crewTag, CREW_HISTORY]
    );
    return rows
      .map((r) => ({ name: r.name, text: r.text, at: new Date(r.at).getTime() }))
      .reverse();
  }

  // ---------------------------------------------------------------- dms ----

  /**
   * Send a direct message.
   *
   * Blocking is checked before anything is written, so a blocked message is
   * never stored and never delivered — there is no copy of it to leak later.
   */
  async send(fromDevice: string, fromName: string, toDevice: string, raw: string): Promise<SendResult> {
    // `sanitise` strips control and invisible characters and enforces the same
    // length cap chat uses. A second cap here would be dead code today and a
    // silent disagreement the day one of them changed.
    const text = sanitise(String(raw ?? ""));
    if (!text) return { ok: false, reason: "Say something." };
    if (!fromDevice || !toDevice) return { ok: false, reason: "Unknown recipient." };
    if (fromDevice === toDevice) return { ok: false, reason: "You cannot message yourself." };

    if (!this.spend(fromDevice)) {
      return { ok: false, reason: "Slow down." };
    }

    if (await this.isBlocked(toDevice, fromDevice)) {
      /**
       * Deliberately indistinguishable from success.
       *
       * Telling a sender they have been blocked is an invitation to make a new
       * account and try again, and it exposes a decision the recipient made
       * privately.
       */
      return { ok: true, at: Date.now(), delivered: false, text: "" };
    }

    const rows = await this.db.query<{ at: string }>(
      `INSERT INTO direct_messages (from_device, to_device, from_name, text)
       VALUES ($1,$2,$3,$4) RETURNING at`,
      [fromDevice, toDevice, fromName || "Trader", text]
    );
    return { ok: true, at: new Date(rows[0].at).getTime(), delivered: true, text };
  }

  /** Everyone this player has a conversation with, most recent first. */
  async threads(device: string): Promise<Thread[]> {
    if (!device) return [];
    const rows = await this.db.query<{
      other: string;
      name: string;
      text: string;
      at: string;
      unread: number;
    }>(
      `SELECT other,
              (ARRAY_AGG(from_name ORDER BY at DESC))[1] AS name,
              (ARRAY_AGG(text ORDER BY at DESC))[1]      AS text,
              MAX(at)                                    AS at,
              COUNT(*) FILTER (WHERE to_device = $1 AND read_at IS NULL)::int AS unread
       FROM (
         SELECT CASE WHEN from_device = $1 THEN to_device ELSE from_device END AS other,
                from_name, text, at, to_device, read_at
         FROM direct_messages
         WHERE from_device = $1 OR to_device = $1
       ) t
       GROUP BY other
       ORDER BY at DESC
       LIMIT 30`,
      [device]
    );

    return rows.map((r) => ({
      device: this.handleFor(r.other),
      name: r.name || "Trader",
      lastText: r.text,
      at: new Date(r.at).getTime(),
      unread: Number(r.unread),
    }));
  }

  /** One conversation, oldest first. Reading it marks it read. */
  async thread(device: string, otherDevice: string): Promise<DirectLine[]> {
    if (!device || !otherDevice) return [];

    const rows = await this.db.query<{
      id: string | number;
      from_device: string;
      from_name: string;
      text: string;
      at: string;
    }>(
      `SELECT id, from_device, from_name, text, at FROM direct_messages
       WHERE (from_device = $1 AND to_device = $2)
          OR (from_device = $2 AND to_device = $1)
       ORDER BY at DESC LIMIT $3`,
      [device, otherDevice, THREAD_LENGTH]
    );

    await this.db
      .query(
        `UPDATE direct_messages SET read_at = now()
         WHERE to_device = $1 AND from_device = $2 AND read_at IS NULL`,
        [device, otherDevice]
      )
      .catch(() => {
        /* marking read is not worth failing a read for */
      });

    return rows
      .map((r) => ({
        id: Number(r.id),
        fromName: r.from_name || "Trader",
        mine: r.from_device === device,
        text: r.text,
        at: new Date(r.at).getTime(),
      }))
      .reverse();
  }

  /** How many unread messages are waiting, for the badge. */
  async unreadCount(device: string): Promise<number> {
    if (!device) return 0;
    const rows = await this.db.query<{ n: number }>(
      "SELECT COUNT(*)::int AS n FROM direct_messages WHERE to_device = $1 AND read_at IS NULL",
      [device]
    );
    return Number(rows[0]?.n ?? 0);
  }

  // ------------------------------------------------------------- blocks ----

  async block(device: string, otherDevice: string): Promise<boolean> {
    if (!device || !otherDevice || device === otherDevice) return false;
    await this.db.query(
      `INSERT INTO blocks (device_id, blocked_device) VALUES ($1,$2)
       ON CONFLICT DO NOTHING`,
      [device, otherDevice]
    );
    return true;
  }

  async unblock(device: string, otherDevice: string): Promise<boolean> {
    await this.db.query("DELETE FROM blocks WHERE device_id = $1 AND blocked_device = $2", [
      device,
      otherDevice,
    ]);
    return true;
  }

  private async isBlocked(byDevice: string, senderDevice: string): Promise<boolean> {
    const rows = await this.db.query(
      "SELECT 1 FROM blocks WHERE device_id = $1 AND blocked_device = $2 LIMIT 1",
      [byDevice, senderDevice]
    );
    return rows.length > 0;
  }

  // -------------------------------------------------------------------------

  /** Token bucket, same shape as chat's — steady rate, small burst allowed. */
  private spend(device: string): boolean {
    const now = Date.now();
    const b = this.buckets.get(device) ?? { tokens: DM_BURST, refilledAt: now };
    b.tokens = Math.min(DM_BURST, b.tokens + (now - b.refilledAt) / DM_REFILL_MS);
    b.refilledAt = now;

    if (b.tokens < 1) {
      this.buckets.set(device, b);
      return false;
    }
    b.tokens -= 1;
    this.buckets.set(device, b);
    return true;
  }

  /** Drop buckets for players who have not sent anything in a while. */
  sweep() {
    const now = Date.now();
    this.buckets.forEach((b, device) => {
      if (now - b.refilledAt > DM_REFILL_MS * DM_BURST * 4) this.buckets.delete(device);
    });
  }
}
