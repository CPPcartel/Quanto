import express from "express";
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
 * Allow the deployed client origin to reach this server.
 *
 * In production the client is served from a CDN on a different domain, so the
 * browser needs an explicit CORS grant for the matchmaking HTTP calls that
 * precede the WebSocket upgrade. Set ALLOWED_ORIGIN to the client's URL;
 * unset means "any origin", which is right for local dev only.
 */
const allowedOrigin = process.env.ALLOWED_ORIGIN ?? "*";
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  if (req.method === "OPTIONS") {
    res.sendStatus(204);
    return;
  }
  next();
});

const httpServer = createServer(app);

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
    console.log(`Candlestick City game server listening on ws://localhost:${port}`);
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
