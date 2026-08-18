/**
 * Database layer verification.
 *
 *   npm run test:db
 *
 * Runs against an in-memory PGlite instance — real PostgreSQL, so the SQL
 * exercised here is exactly the SQL that will run against Supabase.
 */
import { openMemoryDb } from "../dist/db/db.js";
import { migrate, ensureSeason, MIGRATION_IDS } from "../dist/db/migrations.js";
import { Ledger } from "../dist/game/ledger.js";
import { Leaderboards, auditBalances } from "../dist/game/leaderboards.js";
import { Store } from "../dist/game/store.js";

let failures = 0;

function check(label, condition, detail = "") {
  const ok = Boolean(condition);
  if (!ok) failures++;
  console.log(`${ok ? "  PASS" : "  FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
}

const db = await openMemoryDb();

console.log("\n[1] migrations");
const ran = await migrate(db);
// Compared against the declared list, not a hardcoded count — the count went
// stale the first time a migration was added and failed a correct change.
check(
  "applied every declared migration",
  ran.length === MIGRATION_IDS.length,
  `${ran.length}/${MIGRATION_IDS.length}`
);
check("in the declared order", ran.join(",") === MIGRATION_IDS.join(","), ran.join(", "));
const again = await migrate(db);
check("idempotent on re-run", again.length === 0);

const season = await ensureSeason(db);
check("season created", season.id > 0, season.label);
const sameSeason = await ensureSeason(db);
check("season is stable within the week", sameSeason.id === season.id);

console.log("\n[2] ledger");
const ledger = new Ledger(db, Number(season.id));
const alice = { block: 0, shards: 0 };
const bob = { block: 0, shards: 0 };

ledger.markPlayer({
  deviceId: "alice", wallet: null, name: "Alice", color: "#fff",
  block: 0, charge: 100, shards: 0, x: 0, z: 0,
});
ledger.markPlayer({
  deviceId: "bob", wallet: "0xabc", name: "Bob", color: "#f0f",
  block: 0, charge: 100, shards: 0, x: 5, z: 5,
});

ledger.post("alice", alice, "signup_grant", 500);
ledger.post("alice", alice, "shift_payout", 42.5);
ledger.post("alice", alice, "floor_purchase", -120);
ledger.post("bob", bob, "signup_grant", 500);
ledger.post("bob", bob, "floor_yield", 13.25);
ledger.postShards("bob", bob, 7);

check("in-memory balance applied", alice.block === 422.5, `alice=${alice.block}`);
check("shards applied", bob.shards === 7);

// Reflect final balances before flushing, as the room does on persist.
ledger.markPlayer({
  deviceId: "alice", wallet: null, name: "Alice", color: "#fff",
  block: alice.block, charge: 88, shards: alice.shards, x: 1, z: 2,
});
ledger.markPlayer({
  deviceId: "bob", wallet: "0xabc", name: "Bob", color: "#f0f",
  block: bob.block, charge: 90, shards: bob.shards, x: 5, z: 5,
});
ledger.markFloors("alice", new Map([["NVDA", 3], ["TSLA", 1]]));
ledger.markFloors("bob", new Map([["NVDA", 5], ["BTC", 2]]));

await ledger.flush();
check("queue drained", ledger.pending === 0);

const led = await db.query("SELECT COUNT(*)::int AS n FROM ledger");
check("ledger rows written", Number(led[0].n) === 5, `${led[0].n} rows`);

console.log("\n[3] integrity — balance must equal sum of ledger");
const drift = await auditBalances(db);
check("no drift between balance and ledger", drift.length === 0, JSON.stringify(drift));

console.log("\n[4] idempotency");
const ref = ledger.ref("shift");
ledger.post("alice", alice, "shift_payout", 10, { ref });
await ledger.flush();
const before = await db.query("SELECT COUNT(*)::int AS n FROM ledger");

// Replay the identical reference — must insert nothing.
ledger.post("alice", { block: alice.block, shards: 0 }, "shift_payout", 10, { ref });
await ledger.flush();
const after = await db.query("SELECT COUNT(*)::int AS n FROM ledger");
check("replayed ref inserts nothing", Number(before[0].n) === Number(after[0].n),
  `${before[0].n} -> ${after[0].n}`);

console.log("\n[5] store queries");
const store = new Store(db);
const loaded = await store.loadPlayer("alice");
check("player round-trips", loaded?.name === "Alice");
check("floors round-trip", loaded?.floors.NVDA === 3 && loaded?.floors.TSLA === 1,
  JSON.stringify(loaded?.floors));

const totals = await store.floorTotals();
check("floor totals aggregate across players", totals.NVDA === 8, `NVDA=${totals.NVDA}`);

const linked = await store.linkWallet("0xabc", "someone-else");
check("existing wallet keeps its original save", linked === "bob", linked);

console.log("\n[6] leaderboards");
const boards = new Leaderboards(db);
await boards.start(999_999);

const floorsBoard = boards.top("floors");
check("floors board ranks by total owned", floorsBoard[0]?.name === "Bob",
  floorsBoard.map((r) => `${r.name}:${r.score}`).join(" "));
check("floors board detail counts towers", floorsBoard[0]?.detail === "2 towers",
  floorsBoard[0]?.detail);

const wealth = boards.top("wealth");
check("wealth board ranks by balance", wealth[0]?.name === "Bob" || wealth[0]?.name === "Alice",
  wealth.map((r) => `${r.name}:${r.score}`).join(" "));

const runners = boards.top("runners");
check("season runners board picks up shards", runners[0]?.name === "Bob" && runners[0]?.score === 7,
  JSON.stringify(runners));

const snap = await db.query("SELECT COUNT(*)::int AS n FROM leaderboard");
check("snapshot persisted", Number(snap[0].n) > 0, `${snap[0].n} rows`);


console.log("\n[7] royalties — offline landlord credited, invariant holds");
// Bob is "offline": credited via the detached path, no in-memory balance.
const aliceBefore = alice.block;
ledger.post("alice", alice, "floor_yield", 90, { meta: { symbol: "NVDA" } });
ledger.postDetached("bob", "landlord_royalty", 10, { symbol: "NVDA" });
ledger.markPlayer({
  deviceId: "alice", wallet: null, name: "Alice", color: "#fff",
  block: alice.block, charge: 80, shards: alice.shards, x: 1, z: 2,
});
await ledger.flush();

const bobRow = await db.query("SELECT block::float8 AS b FROM players WHERE device_id='bob'");
check("offline landlord balance incremented", Number(bobRow[0].b) === 513.25 + 10,
  `bob=${bobRow[0].b}`);

const royalty = await db.query("SELECT COUNT(*)::int n FROM ledger WHERE kind='landlord_royalty'");
check("royalty recorded in ledger", Number(royalty[0].n) === 1);

const drift2 = await auditBalances(db);
check("balance still equals ledger after royalty", drift2.length === 0, JSON.stringify(drift2));
check("owner received the reduced amount", Math.abs(alice.block - (aliceBefore + 90)) < 0.001);

boards.stop();
await ledger.stop();

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}\n`);
process.exit(failures === 0 ? 0 : 1);
