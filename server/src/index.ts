import express from "express";
import { timingSafeEqual } from "node:crypto";
import { createServer } from "http";
import { Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { matchMaker } from "@colyseus/core";
import { CityRoom } from "./rooms/CityRoom.js";
import { ChainlinkPoller } from "./oracle/ChainlinkPoller.js";
import { TICKERS } from "./config/tickers.js";
import { Store } from "./game/store.js";
import { Ledger } from "./game/ledger.js";
import { Leaderboards, BOARDS, auditBalances, type BoardId } from "./game/leaderboards.js";
import { PrivyAuth } from "./game/privy.js";
import { openDb, closeDb, type Db } from "./db/db.js";
import { migrate, ensureSeason } from "./db/migrations.js";

const app = express();
app.use(express.json());

/**
 * Allow the deployed client origins to reach this server.
 *
 * In production the client is served from a CDN on a different domain, so the
 * browser needs an explicit CORS grant for the matchmaking HTTP calls that
 * precede the WebSocket upgrade. Unset means "any origin", which is right for
 * local development only.
 *
 * ALLOWED_ORIGIN takes a comma-separated list rather than a single value,
 * because a site almost never has exactly one origin at a time. Moving to a
 * custom domain means both the old host and the new one are live at once while
 * DNS settles, and a single value would have made whichever half of the
 * audience hit the other host unable to connect at all.
 */
const allowedOrigins = (process.env.ALLOWED_ORIGIN ?? "*")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

app.use((req, res, next) => {
  /**
   * Echo the caller's origin when it is on the list.
   *
   * Access-Control-Allow-Origin accepts one value or "*", never a list, so the
   * matching origin has to be reflected. Vary tells caches that the response
   * differs per origin; without it a CDN can hand one site's grant to another
   * and produce a failure nobody can reproduce locally.
   */
  const origin = req.get("origin");
  if (allowedOrigins.includes("*")) {
    res.setHeader("Access-Control-Allow-Origin", "*");
  } else if (origin && allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }

  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  if (req.method === "OPTIONS") {
    res.sendStatus(204);
    return;
  }
  next();
});

const httpServer = createServer(app);

/**
 * Refuse to start in a configuration nobody can log into.
 *
 * With REQUIRE_AUTH on and no Privy credentials, every single join would be
 * rejected — a server that is up, healthy and completely unusable. Far better
 * to fail at boot with the reason than to serve a city no one can enter.
 */
const REQUIRE_AUTH = (process.env.REQUIRE_AUTH ?? "true").toLowerCase() !== "false";
if (REQUIRE_AUTH && !(process.env.PRIVY_APP_ID && process.env.PRIVY_APP_SECRET)) {
  console.error(
    [
      "",
      "Quanto cannot start: accounts are required but not configured.",
      "",
      "  REQUIRE_AUTH is on, so every player must sign in — but PRIVY_APP_ID",
      "  and PRIVY_APP_SECRET are unset, so no sign-in can be verified and",
      "  every join would be refused.",
      "",
      "  Fix it one of two ways:",
      "    1. Create a free app at privy.io and set PRIVY_APP_ID +",
      "       PRIVY_APP_SECRET here, and VITE_PRIVY_APP_ID on the client.",
      "    2. Set REQUIRE_AUTH=false to allow guest play (local development).",
      "",
    ].join(String.fromCharCode(10))
  );
  process.exit(1);
}

const poller = new ChainlinkPoller();

// Wired up in boot(), once the database is open and migrated.
let db: Db;
let store: Store;
let ledger: Ledger;
let boards: Leaderboards;
const privy = new PrivyAuth();

const gameServer = new Server({
  transport: new WebSocketTransport({ server: httpServer }),
});

app.get("/health", async (_req, res) => {
  const snap = poller.current;
  let population: Record<string, number> | { error: string } = { error: "db not ready" };
  try {
    if (store) population = await store.stats();
  } catch (err) {
    population = { error: String((err as Error)?.message ?? err) };
  }

  res.json({
    ok: true,
    db: { kind: db?.kind ?? "none", pendingWrites: ledger?.pending ?? 0 },
    auth: { privy: privy.enabled ? "enabled" : "guest-only" },
    season: boards?.currentSeason ?? null,
    population,
    oracle: {
      ok: snap.lastPollOk,
      phase: snap.phase,
      lastPollAt: snap.lastPollAt,
      tickers: snap.readings.size,
      marketMood: Number(snap.marketMood.toFixed(3)),
      peak: { symbol: snap.peakSymbol, volatility: snap.peakVolatility },
    },
  });
});

/**
 * Full leaderboards. The in-game panel reads the top ten from replicated state;
 * this serves the deeper list for the website, straight from the cached
 * snapshot so a busy board costs nothing.
 */
app.get("/leaderboard", (req, res) => {
  if (!boards) {
    res.status(503).json({ ok: false, error: "not ready" });
    return;
  }

  const requested = String(req.query.board ?? "floors") as BoardId;
  const known = BOARDS.find((b) => b.id === requested);
  if (!known) {
    res.status(400).json({ ok: false, error: `unknown board ${requested}`, boards: BOARDS });
    return;
  }

  const limit = Math.min(100, Math.max(1, Number(req.query.limit ?? 25)));
  res.setHeader("Cache-Control", "public, max-age=30");
  res.json({
    ok: true,
    board: known,
    season: boards.currentSeason,
    rows: boards.all(requested).slice(0, limit),
  });
});

/**
 * Economy audit: every player's balance must equal the sum of their ledger.
 * Any drift means a balance changed without being recorded, which is the one
 * bug class the ledger exists to make impossible.
 */
/**
 * Past seasons, and whether each one has been closed.
 *
 * `closed_at` is deliberately separate from `ends_at`: one is when the season
 * was scheduled to end, the other when the server actually froze it. If the
 * process was down over a boundary the two differ, and that difference is
 * exactly what somebody disputing a result needs to see.
 */
app.get("/seasons", async (_req, res) => {
  if (!db) {
    res.status(503).json({ ok: false, error: "not ready" });
    return;
  }
  try {
    if (!boards) {
      res.status(503).json({ ok: false, error: "not ready" });
      return;
    }
    const rows = await db.query<{
      id: string | number;
      label: string;
      starts_at: string;
      ends_at: string;
      closed_at: string | null;
    }>(
      `SELECT id, label, starts_at, ends_at, closed_at
         FROM seasons ORDER BY id DESC LIMIT 100`
    );
    res.json({
      ok: true,
      current: boards.currentSeason,
      seasons: rows.map((r) => ({
        id: Number(r.id),
        label: r.label,
        startsAt: r.starts_at,
        endsAt: r.ends_at,
        closedAt: r.closed_at,
        closed: r.closed_at !== null,
      })),
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: String((err as Error)?.message ?? err) });
  }
});

/**
 * The frozen final standings for one season.
 *
 * Public and permanent. A competition result nobody can check independently is a
 * result nobody has any reason to trust, and this sits beside /audit for the
 * same reason: publishing the check is worth more than asserting the outcome.
 *
 * Returns nothing while a season is still open. "Who is winning" is the live
 * board's job; this endpoint only ever answers "who won".
 */
app.get("/season/:id/results", async (req, res) => {
  if (!db) {
    res.status(503).json({ ok: false, error: "not ready" });
    return;
  }

  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ ok: false, error: "bad season id" });
    return;
  }

  try {
    const seasons = await db.query<{ label: string; ends_at: string; closed_at: string | null }>(
      "SELECT label, ends_at, closed_at FROM seasons WHERE id = $1",
      [id]
    );
    const season = seasons[0];
    if (!season) {
      res.status(404).json({ ok: false, error: "no such season" });
      return;
    }

    const board = typeof req.query.board === "string" ? req.query.board : undefined;
    const results = await boards.resultsFor(id, board as never);

    res.json({
      ok: true,
      season: {
        id,
        label: season.label,
        endsAt: season.ends_at,
        closedAt: season.closed_at,
        closed: season.closed_at !== null,
      },
      // Empty rather than an error while a season is open: "not finished yet" is
      // an answer, and a 404 would imply the season does not exist.
      results,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: String((err as Error)?.message ?? err) });
  }
});

/**
 * Admin routes are gated on a shared secret, and fail CLOSED.
 *
 * With ADMIN_TOKEN unset these routes refuse every request rather than falling
 * open. An unset secret is a misconfiguration, and the failure mode of guessing
 * otherwise is that the review data for a paid competition — account ages, login
 * methods, session counts — is served to anybody who finds the URL.
 *
 * Compared with timingSafeEqual so the comparison cannot be used as an oracle.
 */
function adminOk(req: express.Request): boolean {
  const expected = process.env.ADMIN_TOKEN ?? "";
  if (!expected) return false;

  const header = req.get("authorization") ?? "";
  const supplied = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!supplied) return false;

  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  // Different lengths cannot be compared by timingSafeEqual and are never equal.
  return a.length === b.length && timingSafeEqual(a, b);
}

function requireAdmin(req: express.Request, res: express.Response): boolean {
  if (adminOk(req)) return true;
  res.status(process.env.ADMIN_TOKEN ? 401 : 503).json({
    ok: false,
    error: process.env.ADMIN_TOKEN
      ? "unauthorised"
      : "ADMIN_TOKEN is not configured on this server",
  });
  return false;
}

/**
 * Everything needed to review a season's winners before paying them.
 *
 * Deliberately a report for a human rather than an automated verdict. Nobody
 * knows yet what cheating looks like in this game, and an automatic ban system
 * built before the first season would be wrong in both directions — refusing
 * real winners and passing whatever it was not designed to catch.
 *
 * The signals are the ones that separate a player from a farm: how long the
 * account has existed, how many separate sessions it played, how its earnings
 * break down by kind, and how fast they arrived. A single session that earned a
 * season's winnings in an hour is not necessarily cheating, but it is the row a
 * person should look at first.
 */
app.get("/admin/season/:id/review", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  if (!db) {
    res.status(503).json({ ok: false, error: "not ready" });
    return;
  }

  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ ok: false, error: "bad season id" });
    return;
  }

  const board = typeof req.query.board === "string" ? req.query.board : "season_earned";
  const limit = Math.min(Number(req.query.limit ?? 10) || 10, 50);

  try {
    const rows = await db.query<{
      rank: number;
      name: string;
      score: number;
      player_id: string | number | null;
      paid_at: string | null;
      payout_tx: string | null;
      device_id: string | null;
      created_at: string | null;
      last_seen_at: string | null;
      login_method: string | null;
      is_guest: boolean | null;
      email: string | null;
      logins: number;
      wallets: number;
    }>(
      `SELECT r.rank, r.name, r.score::float8 AS score, r.player_id,
              r.paid_at, r.payout_tx,
              p.device_id, p.created_at, p.last_seen_at, p.login_method,
              p.is_guest, p.email,
              (SELECT COUNT(*)::int FROM logins l WHERE l.player_id = p.id) AS logins,
              (SELECT COUNT(*)::int FROM player_wallets w WHERE w.player_id = p.id) AS wallets
         FROM season_results r
         LEFT JOIN players p ON p.id = r.player_id
        WHERE r.season_id = $1 AND r.board = $2
        ORDER BY r.rank
        LIMIT $3`,
      [id, board, limit]
    );

    const season = await db.query<{ starts_at: string; ends_at: string; closed_at: string | null }>(
      "SELECT starts_at, ends_at, closed_at FROM seasons WHERE id = $1",
      [id]
    );
    if (!season[0]) {
      res.status(404).json({ ok: false, error: "no such season" });
      return;
    }

    // Earnings by ledger kind, so a score can be read rather than trusted.
    const entrants = rows.map((r) => Number(r.player_id)).filter((n) => Number.isFinite(n));
    const byKind = new Map<number, Record<string, number>>();
    if (entrants.length) {
      const kinds = await db.query<{ player_id: string | number; kind: string; total: number }>(
        `SELECT player_id, kind, SUM(amount)::float8 AS total
           FROM ledger
          WHERE player_id = ANY($1::bigint[])
            AND amount > 0
            AND created_at >= $2 AND created_at < $3
          GROUP BY player_id, kind`,
        [entrants, season[0].starts_at, season[0].closed_at ?? season[0].ends_at]
      );
      for (const k of kinds) {
        const pid = Number(k.player_id);
        const bucket = byKind.get(pid) ?? {};
        bucket[k.kind] = Number(k.total);
        byKind.set(pid, bucket);
      }
    }

    res.json({
      ok: true,
      season: { id, board, startsAt: season[0].starts_at, closedAt: season[0].closed_at },
      /**
       * device_id IS included here, unlike every public route. This endpoint is
       * for the operator deciding who to pay, and a device id is the only handle
       * that ties a result back to a save. It must never appear on a public
       * route — see the messaging layer, where the same rule applies.
       */
      entrants: rows.map((r) => {
        const pid = Number(r.player_id);
        const created = r.created_at ? new Date(r.created_at).getTime() : null;
        const ageHours = created ? (Date.now() - created) / 3_600_000 : null;
        return {
          rank: Number(r.rank),
          name: r.name,
          score: Number(r.score),
          paid: r.paid_at !== null,
          payoutTx: r.payout_tx,
          deviceId: r.device_id,
          accountAgeHours: ageHours === null ? null : Math.round(ageHours * 10) / 10,
          createdAt: r.created_at,
          lastSeenAt: r.last_seen_at,
          loginMethod: r.login_method,
          isGuest: r.is_guest,
          hasEmail: Boolean(r.email),
          logins: Number(r.logins),
          linkedWallets: Number(r.wallets),
          // The single most useful number on the page: score per hour of
          // account existence. A farm sits at the top of this column.
          scorePerHour:
            ageHours && ageHours > 0 ? Math.round((Number(r.score) / ageHours) * 100) / 100 : null,
          earningsByKind: byKind.get(pid) ?? {},
        };
      }),
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: String((err as Error)?.message ?? err) });
  }
});

/**
 * Record that a prize was paid.
 *
 * Writes only where paid_at IS NULL, which makes it idempotent: asking twice
 * reports the transaction already on file rather than replacing it. That guard
 * is the entire point of the route. Prize disputes are resolved by somebody
 * looking for proof of payment, and if the record can be overwritten there is no
 * proof — just the most recent claim.
 *
 * Deliberately does NOT send anything. Moving funds from a treasury is a
 * deliberate human act; this only records that it happened.
 */
app.post("/admin/season/:id/payout", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  if (!db) {
    res.status(503).json({ ok: false, error: "not ready" });
    return;
  }

  const id = Number(req.params.id);
  const body = (req.body ?? {}) as {
    board?: string;
    rank?: number;
    tx?: string;
    to?: string;
    note?: string;
  };
  const board = String(body.board ?? "");
  const rank = Number(body.rank);
  const tx = String(body.tx ?? "").trim();

  if (!Number.isInteger(id) || id <= 0 || !board || !Number.isInteger(rank) || rank <= 0 || !tx) {
    res.status(400).json({ ok: false, error: "need season id, board, rank and tx" });
    return;
  }

  try {
    const existing = await db.query<{ paid_at: string | null; payout_tx: string | null; name: string }>(
      "SELECT paid_at, payout_tx, name FROM season_results WHERE season_id = $1 AND board = $2 AND rank = $3",
      [id, board, rank]
    );
    if (!existing[0]) {
      res.status(404).json({ ok: false, error: "no such result" });
      return;
    }
    if (existing[0].paid_at) {
      // Not an error. The caller asked whether this is settled, and it is.
      res.status(409).json({
        ok: false,
        error: "already paid",
        paidAt: existing[0].paid_at,
        payoutTx: existing[0].payout_tx,
        name: existing[0].name,
      });
      return;
    }

    await db.query(
      `UPDATE season_results
          SET paid_at = now(), payout_tx = $4, payout_to = $5, payout_note = $6
        WHERE season_id = $1 AND board = $2 AND rank = $3 AND paid_at IS NULL`,
      [id, board, rank, tx, body.to ?? null, body.note ?? null]
    );

    console.log(`[prize] season #${id} ${board} rank ${rank} marked paid — ${tx}`);
    res.json({ ok: true, season: id, board, rank, tx });
  } catch (err) {
    res.status(500).json({ ok: false, error: String((err as Error)?.message ?? err) });
  }
});

app.get("/audit", async (_req, res) => {
  if (!db) {
    res.status(503).json({ ok: false, error: "not ready" });
    return;
  }
  try {
    await ledger.flush();
    const drift = await auditBalances(db);
    res.status(drift.length === 0 ? 200 : 500).json({
      ok: drift.length === 0,
      checked: "sum(ledger.amount) == players.block",
      drifting: drift.length,
      rows: drift.slice(0, 50),
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: String((err as Error)?.message ?? err) });
  }
});

/** Handy for eyeballing what the city is being told, without a browser. */
app.get("/oracle", (_req, res) => {
  const snap = poller.current;
  res.json({
    phase: snap.phase,
    marketMood: snap.marketMood,
    readings: [...snap.readings.values()].sort((a, b) => b.height - a.height),
  });
});

/**
 * Force a volatility storm on demand.
 *
 * Storms normally fire off real market volatility, which means they cannot be
 * exercised at 3am on a closed market. This makes the mechanic testable
 * without waiting for the opening bell.
 */
app.post("/debug/storm/:symbol", async (req, res) => {
  // Anyone could otherwise summon storms on the live server. Set DEBUG_TOKEN in
  // production and pass it as ?token=… ; unset leaves it open for local dev.
  const required = process.env.DEBUG_TOKEN;
  if (required && req.query.token !== required) {
    res.status(403).json({ ok: false, error: "forbidden" });
    return;
  }

  const symbol = String(req.params.symbol).toUpperCase();
  const rooms = await matchMaker.query({ name: "city" });
  if (rooms.length === 0) {
    res.status(409).json({ ok: false, error: "no active city room — join the game first" });
    return;
  }

  let started = false;
  for (const listing of rooms) {
    const room = matchMaker.getLocalRoomById(listing.roomId) as CityRoom | undefined;
    if (room?.forceStorm(symbol)) started = true;
  }

  res.status(started ? 200 : 404).json({
    ok: started,
    symbol,
    error: started ? undefined : `unknown ticker ${symbol}`,
  });
});

const port = Number(process.env.PORT ?? 2567);

async function boot() {
  // ---- database -----------------------------------------------------------
  db = await openDb();
  const applied = await migrate(db);
  if (applied.length) console.log(`[db] applied migrations: ${applied.join(", ")}`);

  const season = await ensureSeason(db);
  store = new Store(db);
  ledger = new Ledger(db, Number(season.id));
  boards = new Leaderboards(db);

  ledger.start(5_000);
  await boards.start(60_000);
  console.log(`[db] ready — season "${boards.currentSeason.label}"`);

  gameServer.define("city", CityRoom, { poller, store, ledger, boards, privy, db });

  // ---- oracle -------------------------------------------------------------
  console.log(`[oracle] reading ${TICKERS.length} Chainlink feeds on Robinhood Chain…`);
  try {
    await poller.start(20_000);
    const snap = poller.current;
    console.log(
      `[oracle] first poll ok — ${snap.readings.size}/${TICKERS.length} feeds, market ${snap.phase}`
    );
  } catch (err) {
    // A dead RPC must not stop the game from booting; the city just starts flat.
    console.error("[oracle] initial poll failed, serving cold city:", (err as Error)?.message);
  }

  startChatRetention();

  httpServer.listen(port, () => {
    console.log(`Quanto game server listening on ws://localhost:${port}`);
  });
}

/**
 * Chat log retention.
 *
 * The log exists because you cannot moderate what you did not record — but
 * "keep it forever" was never the design, and it had no pruning at all. On a
 * busy city that table is the fastest-growing thing in the database, and the
 * managed Postgres tiers this is meant to deploy on are size-capped.
 *
 * Thirty days is long enough to answer a report raised a few weeks late, and
 * short enough that the table reaches a steady size instead of growing forever.
 * Deleting in bounded batches keeps the statement from locking the table for
 * long on a backlog.
 */
const CHAT_RETENTION_DAYS = Number(process.env.CHAT_RETENTION_DAYS ?? 30);

function startChatRetention() {
  if (!Number.isFinite(CHAT_RETENTION_DAYS) || CHAT_RETENTION_DAYS <= 0) {
    console.log("[chat] retention disabled — CHAT_RETENTION_DAYS is not a positive number");
    return;
  }

  const prune = async () => {
    try {
      const removed = await db.query<{ id: string }>(
        `DELETE FROM chat_log
         WHERE id IN (
           SELECT id FROM chat_log
           WHERE at < now() - ($1 || ' days')::interval
           LIMIT 5000
         )
         RETURNING id`,
        [String(CHAT_RETENTION_DAYS)]
      );
      if (removed.length) {
        console.log(`[chat] pruned ${removed.length} messages older than ${CHAT_RETENTION_DAYS}d`);
      }
    } catch (err) {
      // Retention failing must never take the server down with it.
      console.error("[chat] retention sweep failed:", (err as Error)?.message ?? err);
    }
  };

  void prune();
  setInterval(prune, 60 * 60 * 1000).unref();
}

/**
 * Release the port on shutdown.
 *
 * `tsx watch` restarts the process on every file change, and without this the
 * replacement starts before the old listener lets go — producing EADDRINUSE
 * and a dev server that looks alive but is serving the previous build.
 */
let shuttingDown = false;
async function shutdown(signal: string, code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n[server] ${signal} — shutting down`);

  poller.stop();
  boards?.stop();

  // Drain queued writes before exiting, so a graceful deploy loses nothing.
  try {
    if (ledger) {
      const pending = ledger.pending;
      await ledger.stop();
      if (pending) console.log(`[server] flushed ${pending} pending ledger entries`);
    }
    await closeDb();
  } catch (err) {
    console.error("[server] shutdown flush failed:", (err as Error)?.message);
  }

  httpServer.close(() => process.exit(code));
  // Don't let a hung socket keep the port held forever.
  setTimeout(() => process.exit(code), 2000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

/**
 * Crash cleanly rather than abruptly.
 *
 * Since Node 15 an unhandled rejection terminates the process, and an uncaught
 * exception always did — neither runs the signal handlers above, so the pending
 * ledger is lost and, worse, the database is never closed.
 *
 * That second part is why this matters here specifically. PGlite is a
 * single-process embedded database and it has already been corrupted twice in
 * this project by processes that died without closing it; `db.ts` carries a
 * recovery message for exactly that failure. Routing crashes through the same
 * drain-and-close path turns a corrupted data directory into an ordinary
 * restart.
 *
 * The error is still reported and the exit code is still non-zero — this
 * swallows nothing, it only ensures the shutdown work happens first.
 */
process.on("unhandledRejection", (reason) => {
  console.error("[server] unhandled rejection:", reason);
  fatal("unhandledRejection");
});

process.on("uncaughtException", (err) => {
  console.error("[server] uncaught exception:", err);
  fatal("uncaughtException");
});

function fatal(signal: string) {
  // A crash during shutdown must not restart shutdown; just go.
  if (shuttingDown) process.exit(1);
  shutdown(signal, 1).catch(() => process.exit(1));
  // Backstop in case the drain itself hangs.
  setTimeout(() => process.exit(1), 3000).unref();
}

/**
 * A failed boot should say what failed, not surface as an unhandled rejection.
 *
 * The usual cause is the database: a corrupt PGlite directory, or a Postgres
 * URL that will not connect. `openDb` already raises an actionable message for
 * the first; printing it plainly beats burying it in a rejection trace.
 */
boot().catch((err) => {
  console.error("\n[server] failed to start:\n");
  console.error((err as Error)?.message ?? err);
  fatal("boot");
});
