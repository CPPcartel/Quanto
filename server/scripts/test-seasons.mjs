/**
 * Season results, and the boundary that decides them.
 *
 * The live leaderboard is a rolling snapshot rewritten every refresh. It answers
 * "who is winning". It cannot answer "who won", because by the time a season has
 * ended the board has already been recomputed for the next one.
 *
 * That gap was harmless while standings were bragging rights. The moment a
 * season result is worth money it becomes the whole game, so the assertions here
 * are almost entirely about the last few seconds before a boundary — the window
 * where the old code would rank a player by data up to a refresh interval stale.
 *
 * The other half covers what counts as earning at all. Season earnings used to
 * include the signup grant, which made creating an account worth more than a day
 * of play and put every fresh account above a real player on the board.
 */
import { openMemoryDb } from "../dist/db/db.js";
import { migrate } from "../dist/db/migrations.js";
import { Leaderboards } from "../dist/game/leaderboards.js";
import { Ledger, SEASON_EARNING_KINDS } from "../dist/game/ledger.js";

let fails = 0;
const check = (l, c, d = "") => {
  if (!c) fails++;
  console.log(`  ${c ? "PASS" : "FAIL"}  ${l}${d ? `  — ${d}` : ""}`);
};

const db = await openMemoryDb();
await migrate(db);

async function addPlayer(deviceId, name) {
  await db.query(
    `INSERT INTO players (device_id, name, color, block, charge, shards, x, z)
     VALUES ($1,$2,'#4F4DC4',500,100,0,0,0) ON CONFLICT (device_id) DO NOTHING`,
    [deviceId, name],
  );
  const rows = await db.query("SELECT id FROM players WHERE device_id = $1", [deviceId]);
  return Number(rows[0].id);
}

/** Write season earnings straight in, standing in for a week of play. */
async function setEarned(seasonId, playerId, earned) {
  await db.query(
    `INSERT INTO season_stats (season_id, player_id, shards_collected, block_earned, floors_bought)
     VALUES ($1,$2,0,$3,0)
     ON CONFLICT (season_id, player_id) DO UPDATE SET block_earned = EXCLUDED.block_earned`,
    [seasonId, playerId, earned],
  );
}

/** End the current season so the next roll opens a new one. */
async function expireSeason(seasonId) {
  await db.query(
    "UPDATE seasons SET ends_at = now() - interval '1 minute' WHERE id = $1",
    [seasonId],
  );
}

const boards = new Leaderboards(db);

console.log("\n[1] a season opens");
const season1 = await boards.rollSeason();
check("a season is current", season1 > 0, `#${season1}`);

const alice = await addPlayer("s-alice", "Alice");
const bob = await addPlayer("s-bob", "Bob");

console.log("\n[2] the live board tracks the leader");
await setEarned(season1, alice, 100);
await setEarned(season1, bob, 50);
await boards.refresh();
let live = boards.top("season_earned");
check("alice leads on the live board", live[0]?.name === "Alice", live.map((r) => r.name).join(", "));

console.log("\n[3] a lead taken in the final seconds still wins");
/**
 * The regression this file exists for.
 *
 * Bob overtakes after the last refresh and before the boundary. Under the old
 * roll-then-compute order the closing standings were whatever the stale board
 * held, so this surge was invisible and Alice would have been paid.
 */
await setEarned(season1, bob, 250);
await expireSeason(season1);
const season2 = await boards.rollSeason();

check("the season rolled", season2 !== season1, `#${season1} -> #${season2}`);

const frozen = await boards.resultsFor(season1, "season_earned");
check("standings were frozen at all", frozen.length > 0, `${frozen.length} rows`);
check("bob won, not alice", frozen[0]?.name === "Bob", frozen.map((r) => r.name).join(", "));
check("with his final score", frozen[0]?.score === 250, String(frozen[0]?.score));
check("alice is second", frozen[1]?.name === "Alice", frozen[1]?.name);
check("ranks start at 1", frozen[0]?.rank === 1, String(frozen[0]?.rank));

console.log("\n[4] the close is recorded");
const closed = await db.query("SELECT closed_at FROM seasons WHERE id = $1", [season1]);
check("closed_at is stamped", closed[0]?.closed_at != null);
const open = await db.query("SELECT closed_at FROM seasons WHERE id = $1", [season2]);
check("the open season is not closed", open[0]?.closed_at == null);

console.log("\n[5] frozen results are immutable");
/**
 * A paid result must not move. Anything that re-runs the freeze — a restart
 * part-way through a roll, a retry after a failure — has to be a no-op.
 */
await setEarned(season1, alice, 99999);
await boards.refresh();
await boards.rollSeason();
const again = await boards.resultsFor(season1, "season_earned");
check("still bob", again[0]?.name === "Bob", again[0]?.name);
check("score unchanged", again[0]?.score === 250, String(again[0]?.score));
check("no duplicate ranks", new Set(again.map((r) => r.rank)).size === again.length);

console.log("\n[6] results carry nothing identifying");
const raw = JSON.stringify(again);
check("no device ids", !raw.includes("s-alice") && !raw.includes("s-bob"));
check("no player ids", !("player_id" in (again[0] ?? {})) && !("playerId" in (again[0] ?? {})));

console.log("\n[7] a signup grant is not an earning");
/**
 * Every account is created with 500 $BLOCK. Counting that as season earnings put
 * a brand new account above a player who had earned 400 by playing, and made
 * registering an account the most profitable action in the game.
 */
check("signup_grant is excluded", !SEASON_EARNING_KINDS.has("signup_grant"));
check("floor_purchase is excluded", !SEASON_EARNING_KINDS.has("floor_purchase"));
check("shift_payout counts", SEASON_EARNING_KINDS.has("shift_payout"));
check("floor_sale counts", SEASON_EARNING_KINDS.has("floor_sale"));

const ledger = new Ledger(db, season2);
const carol = await addPlayer("s-carol", "Carol");
const wallet = { block: 0, shards: 0 };
ledger.post("s-carol", wallet, "signup_grant", 500, { ref: "signup:s-carol" });
await ledger.flush();

const carolStats = await db.query(
  "SELECT block_earned::float8 AS earned FROM season_stats WHERE season_id = $1 AND player_id = $2",
  [season2, carol],
);
const carolEarned = Number(carolStats[0]?.earned ?? 0);
check("a new account has earned nothing", carolEarned === 0, String(carolEarned));
check("but the grant did reach the balance", wallet.block === 500, String(wallet.block));

console.log("\n[8] real earning does count");
ledger.post("s-carol", wallet, "shift_payout", 40, { ref: "shift:1" });
await ledger.flush();
const after = await db.query(
  "SELECT block_earned::float8 AS earned FROM season_stats WHERE season_id = $1 AND player_id = $2",
  [season2, carol],
);
check("a shift counts", Number(after[0]?.earned) === 40, String(after[0]?.earned));

console.log(fails === 0 ? "\nALL SEASON CHECKS PASSED\n" : `\n${fails} FAILED\n`);
process.exit(fails === 0 ? 0 : 1);
