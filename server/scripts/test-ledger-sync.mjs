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

console.log(`\n${fails === 0 ? "ALL LEDGER SYNC CHECKS PASSED" : fails + " FAILED"}\n`);
process.exit(fails ? 1 : 0);
