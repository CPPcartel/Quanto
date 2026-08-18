import { openMemoryDb } from "../dist/db/db.js";
import { migrate } from "../dist/db/migrations.js";
import { TerritoryService, CONTROL_THRESHOLD, ROYALTY_RATE } from "../dist/game/territory.js";

let fails = 0;
const check = (l, c, d = "") => {
  if (!c) fails++;
  console.log(`  ${c ? "PASS" : "FAIL"}  ${l}${d ? `  — ${d}` : ""}`);
};

const db = await openMemoryDb();
await migrate(db);

// Fake tickers: height 60 -> floorsFor = 20 floors, threshold 25% = 5.
const state = {
  tickers: new Map([
    ["NVDA", { height: 60, landlordName: "", landlordHeld: 0, landlordIsCrew: false, landlordColor: "" }],
    ["GME",  { height: 60, landlordName: "", landlordHeld: 0, landlordIsCrew: false, landlordColor: "" }],
  ]),
};
state.tickers.forEach = Map.prototype.forEach.bind(state.tickers);

async function player(device, name) {
  const r = await db.query(
    "INSERT INTO players (device_id, name) VALUES ($1,$2) RETURNING id", [device, name]);
  return Number(r[0].id);
}
const setFloors = (id, sym, n) =>
  db.query(`INSERT INTO floors (player_id,symbol,count) VALUES ($1,$2,$3)
            ON CONFLICT (player_id,symbol) DO UPDATE SET count=EXCLUDED.count`, [id, sym, n]);

const alice = await player("alice", "Alice");
const bob   = await player("bob", "Bob");
const t = new TerritoryService(db);

console.log("\n[1] threshold");
await setFloors(alice, "NVDA", 3);          // 3 of 20 = 15%, under 25%
await t.refresh(state);
check("3/20 floors does NOT grant control", !t.get("NVDA"), `held=3 need=5`);

await setFloors(alice, "NVDA", 10);
await t.refresh(state);
check("10/20 grants control", t.get("NVDA")?.name === "Alice");

console.log("\n[2] contest");
await setFloors(bob, "NVDA", 6);
await t.refresh(state);
check("higher holder stays landlord", t.get("NVDA")?.name === "Alice", "A=10 B=6");

await setFloors(bob, "NVDA", 11);
await t.refresh(state);
check("control flips when overtaken", t.get("NVDA")?.name === "Bob", "A=10 B=11");

console.log("\n[3] royalty split");
const s = t.split("NVDA", "alice", 100);
check("owner keeps 90%", Math.abs(s.toEarner - 90) < 0.001, `got ${s.toEarner}`);
check("landlord gets 10%", Math.abs(s.royalty - 10) < 0.001, `got ${s.royalty}`);
check("royalty routed to Bob", s.landlord?.deviceId === "bob");

const own = t.split("NVDA", "bob", 100);
check("landlord pays no royalty to self", own.royalty === 0 && own.toEarner === 100);

const none = t.split("GME", "alice", 100);
check("uncontrolled tower takes no cut", none.royalty === 0 && none.toEarner === 100);

console.log("\n[4] crews pool");
const crew = await db.query(
  "INSERT INTO crews (name,tag,color,leader_id) VALUES ('Bulls','BULL','#0f0',$1) RETURNING id", [alice]);
const crewId = Number(crew[0].id);
const carl = await player("carl", "Carl");
await db.query("INSERT INTO crew_members (crew_id,player_id) VALUES ($1,$2),($1,$3)", [crewId, alice, carl]);
await setFloors(carl, "NVDA", 5);   // crew = alice 10 + carl 5 = 15 > bob 11
await t.refresh(state);
check("crew total beats top individual", t.get("NVDA")?.isCrew === true, JSON.stringify(t.get("NVDA")));
check("crew shown by tag", t.get("NVDA")?.name === "BULL");
check("crew landlord takes no rent", t.split("NVDA", "bob", 100).royalty === 0);

console.log(`\n${fails === 0 ? "ALL TERRITORY CHECKS PASSED" : fails + " FAILED"}\n`);
process.exit(fails ? 1 : 0);
