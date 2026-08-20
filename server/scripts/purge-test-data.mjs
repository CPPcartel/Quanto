/**
 * Remove test accounts and everything they own.
 *
 * The e2e scripts create real players, buy real floors and post real ledger
 * rows. Against a database that is reset between runs that is harmless. Against
 * the live one it is not: the fixtures hold floors that real players could
 * otherwise buy, they show up on leaderboards, and their balances count toward
 * the audit total.
 *
 * Deliberately matches on device-id prefix only. Nothing here guesses at which
 * *real* players look disposable — the only rows it will ever touch are ones a
 * test script created under a reserved prefix.
 *
 *   node scripts/purge-test-data.mjs          # report
 *   node scripts/purge-test-data.mjs --fix    # delete
 */
import postgres from "postgres";

const PREFIXES = ["e2e-", "msg-", "test-", "live-", "bench-"];

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set. This tool only runs against Postgres.");
  process.exit(1);
}

const fix = process.argv.includes("--fix");
const sql = postgres(url, { max: 1, prepare: false });
/**
 * Built fresh per query on purpose. A `sql.array(...)` fragment carries the
 * parameter binding for the statement it was made for; reusing one across
 * statements sends it as a scalar and Postgres rejects the ANY().
 */
const like = () => sql.array(PREFIXES.map((p) => `${p}%`), 1009);

const doomed = await sql`
  SELECT id, device_id, name, block FROM players
  WHERE device_id LIKE ANY(${like()})
  ORDER BY device_id
`;

if (doomed.length === 0) {
  console.log("No test accounts found. Nothing to do.");
  await sql.end();
  process.exit(0);
}

/**
 * Most tables key on the numeric player id; only `players`, `direct_messages`,
 * `chat_log` and `blocks` carry the device id itself. Both are needed.
 */
const pids = () => sql.array(doomed.map((r) => r.id), 1007);
const devs = () => sql.array(doomed.map((r) => r.device_id), 1009);

const [{ n: heldFloors }] = await sql`
  SELECT COALESCE(SUM(count), 0)::int AS n FROM floors WHERE player_id = ANY(${pids()})
`;
const [{ n: ledgerRows }] = await sql`
  SELECT COUNT(*)::int AS n FROM ledger WHERE player_id = ANY(${pids()})
`;

console.log(
  `${doomed.length} test account(s), ${heldFloors} floor(s) held, ${ledgerRows} ledger row(s)`,
);
for (const r of doomed) {
  console.log(`  ${r.device_id}  ${r.name ?? ""}  ${Number(r.block).toFixed(4)}`);
}

if (!fix) {
  console.log("\nReport only. Re-run with --fix to delete.");
  await sql.end();
  process.exit(0);
}

/**
 * One transaction: a half-purged account is worse than an unpurged one, because
 * it leaves floors and listings owned by a player who no longer exists.
 */
await sql.begin(async (tx) => {
  // Listings first — they point at floors that are about to go. Both sides of a
  // trade matter: a test account may be the buyer on a real player's listing.
  await tx`DELETE FROM listings WHERE seller_id = ANY(${pids()}) OR buyer_id = ANY(${pids()})`;
  await tx`DELETE FROM signs WHERE player_id = ANY(${pids()})`;
  await tx`DELETE FROM direct_messages WHERE from_device = ANY(${devs()}) OR to_device = ANY(${devs()})`;
  await tx`DELETE FROM blocks WHERE device_id = ANY(${devs()}) OR blocked_device = ANY(${devs()})`;
  await tx`DELETE FROM chat_log WHERE device_id = ANY(${devs()})`;
  await tx`DELETE FROM crew_members WHERE player_id = ANY(${pids()})`;

  // Crews founded by a test account go too, membership and all — otherwise the
  // crew survives with no leader and no way to appoint one.
  const crews = await tx`SELECT id FROM crews WHERE leader_id = ANY(${pids()})`;
  if (crews.length) {
    const cids = () => sql.array(crews.map((c) => c.id), 1007);
    await tx`DELETE FROM crew_members WHERE crew_id = ANY(${cids()})`;
    await tx`DELETE FROM crews WHERE id = ANY(${cids()})`;
  }

  await tx`DELETE FROM season_stats WHERE player_id = ANY(${pids()})`;
  await tx`DELETE FROM leaderboard WHERE player_id = ANY(${pids()})`;
  await tx`DELETE FROM logins WHERE player_id = ANY(${pids()})`;
  await tx`DELETE FROM floors WHERE player_id = ANY(${pids()})`;
  await tx`DELETE FROM ledger WHERE player_id = ANY(${pids()})`;
  await tx`DELETE FROM players WHERE id = ANY(${pids()})`;
});

console.log(`\nPurged ${doomed.length} test account(s).`);
await sql.end();
