import { openMemoryDb } from "../dist/db/db.js";
import { migrate } from "../dist/db/migrations.js";
import { MarketService } from "../dist/game/market.js";
import { CrewService } from "../dist/game/crews.js";
import { auditBalances } from "../dist/game/leaderboards.js";

let fails = 0;
const check = (l, c, d = "") => { if (!c) fails++; console.log(`  ${c ? "PASS" : "FAIL"}  ${l}${d ? `  — ${d}` : ""}`); };

const db = await openMemoryDb();
await migrate(db);

async function mk(device, name, block) {
  const r = await db.query(
    "INSERT INTO players (device_id,name,block) VALUES ($1,$2,$3) RETURNING id", [device, name, block]);
  // Seed the ledger so the audit invariant starts satisfied.
  await db.query("INSERT INTO ledger (player_id,kind,amount,balance_after) VALUES ($1,'signup_grant',$2,$2)",
    [Number(r[0].id), block]);
  return Number(r[0].id);
}
const give = (id, sym, n) => db.query(
  `INSERT INTO floors (player_id,symbol,count) VALUES ($1,$2,$3)
   ON CONFLICT (player_id,symbol) DO UPDATE SET count=EXCLUDED.count`, [id, sym, n]);
const blockOf = async (d) =>
  Number((await db.query("SELECT block::float8 b FROM players WHERE device_id=$1",[d]))[0].b);
const floorsOf = async (d, s) =>
  Number((await db.query(
    "SELECT COALESCE(count,0) c FROM floors f JOIN players p ON p.id=f.player_id WHERE p.device_id=$1 AND f.symbol=$2",[d,s]))[0]?.c ?? 0);

const seller = await mk("sell","Seller",100);
const buyer  = await mk("buy","Buyer",500);
await give(seller,"NVDA",3);

const m = new MarketService(db);

console.log("\n[1] listing validation");
check("rejects price of 0", !(await m.list("sell","NVDA",0)).ok);
check("rejects tower you don't own", !(await m.list("sell","GME",50)).ok);
const listed = await m.list("sell","NVDA",120);
check("valid listing accepted", listed.ok, JSON.stringify(listed));

console.log("\n[2] purchase moves floor AND money together");
const r = await m.buy("buy", listed.id);
check("purchase succeeded", r.ok, JSON.stringify(r));
check("buyer paid 120", await blockOf("buy") === 380, `buyer=${await blockOf("buy")}`);
check("seller received 120", await blockOf("sell") === 220, `seller=${await blockOf("sell")}`);
check("seller floors 3 -> 2", await floorsOf("sell","NVDA") === 2);
check("buyer floors 0 -> 1", await floorsOf("buy","NVDA") === 1);

console.log("\n[3] ledger invariant after a trade");
const drift = await auditBalances(db);
check("balance == ledger for BOTH sides", drift.length === 0, JSON.stringify(drift));

console.log("\n[4] refusals move nothing");
const l2 = await m.list("sell","NVDA",1000);
const beforeB = await blockOf("buy"), beforeS = await blockOf("sell");
const poor = await m.buy("buy", l2.id);
check("insufficient funds refused", !poor.ok, poor.reason);
check("buyer balance unchanged", await blockOf("buy") === beforeB);
check("seller balance unchanged", await blockOf("sell") === beforeS);
const stillOpen = (await m.open()).some(x => x.id === l2.id);
check("listing released, not consumed", stillOpen);

console.log("\n[5] double-buy");
const l3 = await m.list("sell","NVDA",10);
const a1 = await m.buy("buy", l3.id);
const a2 = await m.buy("buy", l3.id);
check("first buy succeeds", a1.ok);
check("second buy refused", !a2.ok, a2.reason);

console.log("\n[6] self-purchase");
// Top the seller up first. The oversell guard (correctly) refuses to list more
// floors than are held, and without this the next two listings fail silently —
// buy(undefined) then returns "Already sold." and the paths below go untested.
await give(seller,"NVDA",5);
const l4 = await m.list("sell","NVDA",5);
check("listing created for the test", l4.ok, JSON.stringify(l4));
const self = await m.buy("sell", l4.id);
check("cannot buy your own listing", !self.ok, self.reason);
check("still open after refusal", (await m.open()).some(x=>x.id===l4.id));

console.log("\n[7] selling a floor you no longer own");
// Seller has 1 NVDA left and lists it, then loses it another way.
const l5 = await m.list("sell","NVDA",10);
check("listing created for the test", l5.ok, JSON.stringify(l5));
await db.query("DELETE FROM floors WHERE player_id=$1 AND symbol='NVDA'", [seller]);
const bBefore7 = await blockOf("buy");
const gone = await m.buy("buy", l5.id);
check("purchase refused when floor is gone", !gone.ok, gone.reason);
check("buyer not charged for the failed purchase", await blockOf("buy") === bBefore7, `buyer=${await blockOf("buy")}`);

console.log("\n[8] final integrity");
const drift2 = await auditBalances(db);
check("ledger still reconciles exactly", drift2.length === 0, JSON.stringify(drift2));

console.log("\n[9] crews");
const cs = new CrewService(db);
const c1 = await cs.create("sell","The Bulls","BULL","#22e8ff");
check("crew created", c1.ok, JSON.stringify(c1.ok ? c1.crew.tag : c1));
check("duplicate tag rejected", !(await cs.create("buy","Other","BULL","#22e8ff")).ok);
check("cannot found two crews", !(await cs.create("sell","Again","AGN","#22e8ff")).ok);
check("bad tag rejected", !(await cs.create("buy","X","!!","#22e8ff")).ok);
const j = await cs.join("buy","BULL");
check("joined by tag", j.ok, j.ok ? `members=${j.crew.members}` : j.reason);
check("crew pools floors", (await cs.forDevice("buy")).floors >= 0);
const lv = await cs.leave("sell");
check("leader can leave", lv.ok);
check("crew survives with members left", !lv.disbanded);
const after = await cs.forDevice("buy");
check("leadership transferred", after?.leaderDevice === "buy", JSON.stringify(after?.leaderDevice));
const lv2 = await cs.leave("buy");
check("last member disbands crew", lv2.disbanded === true);

console.log(`\n${fails === 0 ? "ALL MARKET + CREW CHECKS PASSED" : fails + " FAILED"}\n`);
process.exit(fails ? 1 : 0);
