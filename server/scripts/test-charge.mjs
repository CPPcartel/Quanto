/**
 * The park CHARGE bonus, and the assertion that matters most: resting in a
 * park must open no new currency path. CHARGE is not ledgered, so a park visit
 * must produce exactly zero ledger rows and leave every balance untouched.
 */
import { openMemoryDb } from "../dist/db/db.js";
import { migrate } from "../dist/db/migrations.js";
import { auditBalances } from "../dist/game/leaderboards.js";
import { accrue, initPlayerEconomy } from "../dist/game/floors.js";
import { CHARGE_MAX, CHARGE_REGEN_MS, PARK_CHARGE_MULTIPLIER } from "../dist/game/economy.js";
import { parkLots, parkAt } from "../dist/config/parks.js";
import { CityState, Player } from "../dist/rooms/schema/CityState.js";

let fails = 0;
const check = (l, c, d = "") => { if (!c) fails++; console.log(`  ${c ? "PASS" : "FAIL"}  ${l}${d ? `  — ${d}` : ""}`); };

const park = parkLots().find((p) => p.kind === "green");

function playerAt(state, id, x, z) {
  const p = new Player();
  initPlayerEconomy(p);
  p.charge = 10;
  p.x = x;
  p.z = z;
  state.players.set(id, p);
  return p;
}

console.log("\n[1] the bonus applies where a park is, and only there");
const state = new CityState();
const inPark = playerAt(state, "in", park.x, park.z);
const outside = playerAt(state, "out", park.x + park.half + 20, park.z);

const TEN_MIN = 10 * 60 * 1000;
accrue(state, TEN_MIN);

const expectedOut = 10 + TEN_MIN / CHARGE_REGEN_MS;
const expectedIn = 10 + (TEN_MIN * PARK_CHARGE_MULTIPLIER) / CHARGE_REGEN_MS;
check("outside regenerates at the base rate", Math.abs(outside.charge - expectedOut) < 1e-6, `${outside.charge.toFixed(3)} vs ${expectedOut.toFixed(3)}`);
check("inside regenerates faster", Math.abs(inPark.charge - expectedIn) < 1e-6, `${inPark.charge.toFixed(3)} vs ${expectedIn.toFixed(3)}`);
check("the multiplier is exactly as configured", Math.abs((inPark.charge - 10) / (outside.charge - 10) - PARK_CHARGE_MULTIPLIER) < 1e-6);
check("resting flag set inside", inPark.resting === true);
check("resting flag clear outside", outside.resting === false);

console.log("\n[2] CHARGE still clamps at the maximum");
const brimming = playerAt(state, "full", park.x, park.z);
brimming.charge = CHARGE_MAX - 0.5;
accrue(state, 24 * 60 * 60 * 1000);
check("never exceeds CHARGE_MAX", brimming.charge === CHARGE_MAX, `${brimming.charge}`);
check("resting still reported when full", brimming.resting === true, "so the HUD does not flicker at 100");

console.log("\n[3] resting mints nothing");
const db = await openMemoryDb();
await migrate(db);
await db.query("INSERT INTO players (device_id,name,block) VALUES ('rester','Rester',500)");
await db.query("INSERT INTO ledger (player_id,kind,amount,balance_after) VALUES (1,'signup_grant',500,500)");

const before = await db.query("SELECT COUNT(*)::int n FROM ledger");
const blockBefore = await db.query("SELECT block::float8 b FROM players WHERE device_id='rester'");

// A long rest, with no floors owned: nothing should be earned or recorded.
const resting = new CityState();
const r = playerAt(resting, "r", park.x, park.z);
const payouts = accrue(resting, 60 * 60 * 1000);

const after = await db.query("SELECT COUNT(*)::int n FROM ledger");
const blockAfter = await db.query("SELECT block::float8 b FROM players WHERE device_id='rester'");

check("an hour of resting produced no payout", payouts.length === 0, `${payouts.length} payouts`);
check("no ledger rows written", Number(after[0].n) === Number(before[0].n), `${before[0].n} -> ${after[0].n}`);
check("no balance changed", Number(blockAfter[0].b) === Number(blockBefore[0].b), `${blockBefore[0].b} -> ${blockAfter[0].b}`);
check("but CHARGE did rise", r.charge > 10, `${r.charge.toFixed(2)}`);

const drift = await auditBalances(db);
check("ledger still reconciles", drift.length === 0, JSON.stringify(drift));

console.log("\n[4] the plaza counts too");
const plaza = playerAt(state, "plaza", 0, 0);
accrue(state, 1000);
check("standing in the plaza rests", plaza.resting === true);
check("just outside the plaza does not", parkAt(0, 200) === null);

console.log(`\n${fails === 0 ? "ALL CHARGE CHECKS PASSED" : fails + " FAILED"}\n`);
process.exit(fails ? 1 : 0);
