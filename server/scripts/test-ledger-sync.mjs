/**
 * The ledger and the balance must flush together.
 *
 * `Ledger.post` credits an in-memory balance and queues a ledger row. If the
 * player row is not ALSO queued in the same batch, the database ends up holding
 * entries whose credit is in no balance — and because player rows are written
 * absolutely, a restart in that window freezes the difference forever: the
 * player silently loses the money, and `/audit` reports a drift that can never
 * resolve.
 *
 * This is the invariant `/audit` exists to protect, so it is worth a test that
 * fails loudly rather than a comment asking people to remember.
 */
import { openMemoryDb } from "../dist/db/db.js";
import { migrate } from "../dist/db/migrations.js";
import { Ledger } from "../dist/game/ledger.js";

let fails = 0;
const check = (l, c, d = "") => {
  if (!c) fails++;
  console.log(`  ${c ? "PASS" : "FAIL"}  ${l}${d ? `  — ${d}` : ""}`);
};

const db = await openMemoryDb();
await migrate(db);
/** The Ledger writes season stats on every credit, so it needs a real season. */
const season = await db.query(
  `INSERT INTO seasons (label, starts_at, ends_at)
   VALUES ($1, now(), now() + interval '''7 days''') RETURNING id`.replace(/'''/g, String.fromCharCode(39)),
  ["Test Week"]
);
const ledger = new Ledger(db, Number(season[0].id));

const DEVICE = "sync-alice";
const player = { block: 0, charge: 100, shards: 0 };

/** Everything a room would queue for a player it is about to credit. */
const mark = () =>
  ledger.markPlayer({
    deviceId: DEVICE,
    wallet: null,
    name: "Alice",
    color: "#fff",
    block: player.block,
    charge: player.charge,
    shards: player.shards,
    x: 0,
    z: 0,
  });

console.log("\n[1] a credit that is queued with its balance reconciles");
mark();
ledger.post(DEVICE, player, "signup_grant", 500);
mark();
await ledger.flush();

const read = async () => {
  const rows = await db.query(
    `SELECT p.block::float8 AS block, COALESCE(SUM(l.amount),0)::float8 AS ledger
     FROM players p LEFT JOIN ledger l ON l.player_id = p.id
     WHERE p.device_id = $1 GROUP BY p.id, p.block`,
    [DEVICE]
  );
  return { block: Number(rows[0]?.block ?? 0), ledger: Number(rows[0]?.ledger ?? 0) };
};

let s = await read();
check("balance matches the ledger", Math.abs(s.block - s.ledger) < 0.0001, `block ${s.block} vs ledger ${s.ledger}`);

console.log("\n[2] repeated accrual stays reconciled");
for (let i = 0; i < 40; i++) {
  ledger.post(DEVICE, player, "floor_yield", 0.4);
  // What the room's accrual loop now does: queue the row in the same batch.
  mark();
  if (i % 7 === 0) await ledger.flush();
}
await ledger.flush();
s = await read();
check(
  "no drift after 40 credits across several flushes",
  Math.abs(s.block - s.ledger) < 0.0001,
  `block ${s.block.toFixed(4)} vs ledger ${s.ledger.toFixed(4)}`
);
check("the credits actually landed", s.block > 500, `${s.block.toFixed(4)}`);

console.log("\n[3] the failure mode this guards against");
/**
 * Posting WITHOUT queueing the balance is exactly the old bug. Reproduced here
 * so the test proves it would have been caught, rather than asserting a
 * behaviour that was never at risk.
 */
ledger.post(DEVICE, player, "floor_yield", 5);
await ledger.flush();
const bad = await read();
check(
  "an unqueued credit does drift, which is why the room must queue it",
  Math.abs(bad.block - bad.ledger) > 0.0001,
  `block ${bad.block.toFixed(4)} vs ledger ${bad.ledger.toFixed(4)}`
);

// And it heals as soon as the balance is queued.
mark();
await ledger.flush();
const healed = await read();
check("queueing the balance repairs it", Math.abs(healed.block - healed.ledger) < 0.0001,
  `block ${healed.block.toFixed(4)} vs ledger ${healed.ledger.toFixed(4)}`);

console.log("\n[4] awaiting a flush guarantees the write, even during another flush");
/**
 * `await flush()` used to return immediately when a write was already in
 * flight — no wait, and no write of the caller's rows. Anything awaiting it for
 * a guarantee (founding a crew needs the player row to exist; /audit compares
 * balances it has just settled) silently got neither.
 *
 * Invisible against a local database that flushes in microseconds. A real fault
 * against managed Postgres in another region, where a write takes hundreds of
 * milliseconds and the periodic flusher is often mid-transaction.
 */
const CONCURRENT = "sync-bob";
const bob = { block: 0, charge: 100, shards: 0 };
const markBob = () =>
  ledger.markPlayer({
    deviceId: CONCURRENT, wallet: null, name: "Bob", color: "#fff",
    block: bob.block, charge: bob.charge, shards: bob.shards, x: 0, z: 0,
  });

// Start a flush without awaiting it, then queue new data and flush again —
// exactly the shape of a player acting while the periodic flusher runs.
ledger.post(DEVICE, player, "floor_yield", 1);
mark();
const inFlight = ledger.flush();

ledger.post(CONCURRENT, bob, "signup_grant", 500);
markBob();
await ledger.flush();
await inFlight;

const bobRows = await db.query(
  "SELECT block::float8 AS block FROM players WHERE device_id = $1",
  [CONCURRENT]
);
check(
  "a player queued during another flush is written",
  bobRows.length === 1 && Math.abs(Number(bobRows[0].block) - 500) < 0.0001,
  bobRows.length ? `block ${Number(bobRows[0].block).toFixed(4)}` : "no row written at all"
);

console.log("\n[5] a failed flush must not take the server down");
/**
 * This killed the live server.
 *
 * `flush` publishes its in-flight write so concurrent callers can await it, and
 * did so with `write.then(fn)` — which returns a NEW promise. When the write
 * failed and no other caller happened to be awaiting at that moment, that
 * derived promise rejected with nobody listening. Node reported an unhandled
 * rejection, this server treats those as fatal, and the process exited.
 *
 * The trigger was a Postgres deadlock: a routine, recoverable event that a
 * database is entitled to produce whenever two transactions touch the same rows
 * in different orders. Nothing about it should be fatal.
 */
{
  const seen = [];
  const onUnhandled = (err) => seen.push(err);
  process.on("unhandledRejection", onUnhandled);

  const deadlock = () => Object.assign(new Error("deadlock detected"), { code: "40P01" });

  /** Fails every time, so the retry gives up and the error surfaces normally. */
  const alwaysDeadlocks = {
    begin: async () => {
      throw deadlock();
    },
    query: async () => [],
  };

  const doomed = new Ledger(alwaysDeadlocks, 1);
  doomed.post("nobody", { block: 0, shards: 0 }, "shift_payout", 10);

  let surfaced = null;
  await doomed.flush().catch((err) => {
    surfaced = err;
  });

  // Unhandled rejections are reported on a later turn of the loop, so give the
  // process a chance to report one before concluding there was none.
  await new Promise((r) => setTimeout(r, 60));

  check("the failure reaches the caller", surfaced?.code === "40P01", String(surfaced?.code));
  check(
    "and nothing is left unhandled",
    seen.length === 0,
    seen.length ? String(seen[0]?.message ?? seen[0]) : "none",
  );

  console.log("\n[6] a deadlock is retried, not surfaced");
  /**
   * Postgres resolves a deadlock by aborting one side and expects the loser to
   * try again. By the retry the winner has committed and released its locks, so
   * the correct behaviour is to succeed on the second attempt rather than to
   * hand the caller an error it cannot do anything useful with.
   */
  let attempts = 0;
  const failsOnce = {
    begin: async (fn) => {
      attempts++;
      if (attempts === 1) throw deadlock();
      return fn({ query: async () => [] });
    },
    query: async () => [],
  };

  const flaky = new Ledger(failsOnce, 1);
  flaky.post("nobody", { block: 0, shards: 0 }, "shift_payout", 10);

  let retryError = null;
  await flaky.flush().catch((err) => {
    retryError = err;
  });

  check("the retry succeeded", retryError === null, String(retryError?.message ?? ""));
  check("it took two attempts", attempts === 2, String(attempts));

  process.off("unhandledRejection", onUnhandled);
}

console.log(`\n${fails === 0 ? "ALL LEDGER SYNC CHECKS PASSED" : fails + " FAILED"}\n`);
process.exit(fails ? 1 : 0);
