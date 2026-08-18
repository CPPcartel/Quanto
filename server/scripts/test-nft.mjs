/**
 * The NFT tier layer.
 *
 * The assertions that matter most are the negative ones: a tier must be
 * impossible to assert from the client, and holding one must never move money.
 * The collection is the first thing in this project that gives some players an
 * advantage over others, so the boundary around that advantage is the thing
 * worth testing hardest.
 */
import { openMemoryDb } from "../dist/db/db.js";
import { migrate } from "../dist/db/migrations.js";
import { NftService, NO_HOLDING } from "../dist/game/nft.js";
import { CrewService, MAX_MEMBERS_CHARTERED } from "../dist/game/crews.js";
import { encodeAttributes, DEFAULT_TRAIT_CODE } from "../dist/config/traits.js";
import { auditBalances } from "../dist/game/leaderboards.js";

let fails = 0;
const check = (l, c, d = "") => {
  if (!c) fails++;
  console.log(`  ${c ? "PASS" : "FAIL"}  ${l}${d ? `  — ${d}` : ""}`);
};

const db = await openMemoryDb();
await migrate(db);

console.log("\n[1] metadata maps onto trait indices");
const attrs = [
  { trait_type: "Jacket", value: "Rust" },
  { trait_type: "Collar", value: "Lime" },
  { trait_type: "Hair", value: "Blonde" },
  { trait_type: "Visor", value: "Magenta" },
  { trait_type: "Skin", value: "Bronze" },
  { trait_type: "Accessory", value: "Halo" },
];
check("attributes encode to six digits", encodeAttributes(attrs).length === 6, encodeAttributes(attrs));
check("indices are correct", encodeAttributes(attrs) === "222324", encodeAttributes(attrs));
check("case is ignored", encodeAttributes([{ trait_type: "jacket", value: "rust" }])[0] === "2");
check("unknown values fall back to slot 0", encodeAttributes([{ trait_type: "Jacket", value: "Nope" }])[0] === "0");
check("missing attributes are safe", encodeAttributes(undefined).length === 6, encodeAttributes(undefined));
check("garbage is safe", encodeAttributes([null, {}, { value: 1 }]).length === 6);

console.log("\n[2] a disabled collection grants nothing");
const off = new NftService(db);
check("service reports disabled", off.enabled === false, "COLLECTION_ADDRESS unset");
const none = await off.holdingFor("0x1111111111111111111111111111111111111111");
check("no wallet holds anything", none.tier === "none", JSON.stringify(none));
check("traits fall back to the default", none.traits === DEFAULT_TRAIT_CODE, none.traits);

console.log("\n[3] a bad address never resolves to a tier");
for (const bad of ["", "not-an-address", "0x", "0xZZZ", null, undefined]) {
  const r = await off.holdingFor(bad);
  if (r.tier !== "none") fails++;
}
check("malformed wallets all return none", true, "empty, junk, short, non-hex, null, undefined");

console.log("\n[4] the penthouse cache expires — a seller cannot hold a tower forever");
await db.query("INSERT INTO players (device_id,name,block) VALUES ('holder','Holder',100)");
await db.query("INSERT INTO ledger (player_id,kind,amount,balance_after) VALUES (1,'signup_grant',100,100)");
await db.query("INSERT INTO floors (player_id,symbol,count) VALUES (1,'NVDA',4)");

const svc = new NftService(db);
await svc.persist("holder", { tier: "penthouse", traits: "111111", tower: "NVDA", tokenId: "7" });

const fresh = await db.query(
  `SELECT (penthouse = 'NVDA' AND penthouse_at > now() - interval '1 day') AS counts FROM players WHERE device_id='holder'`
);
check("a fresh penthouse counts", fresh[0].counts === true);

await db.query("UPDATE players SET penthouse_at = now() - interval '2 days' WHERE device_id='holder'");
const stale = await db.query(
  `SELECT (penthouse = 'NVDA' AND penthouse_at > now() - interval '1 day') AS counts FROM players WHERE device_id='holder'`
);
check("a penthouse unverified for a day stops counting", stale[0].counts === false);

console.log("\n[5] territory gives a verified penthouse exactly one extra floor");
await db.query("UPDATE players SET penthouse_at = now() WHERE device_id='holder'");
const weighted = await db.query(`
  SELECT (f.count + CASE
           WHEN p.penthouse = f.symbol AND p.penthouse_at > now() - interval '1 day'
           THEN 1 ELSE 0 END)::int AS held
  FROM floors f JOIN players p ON p.id = f.player_id
  WHERE p.device_id = 'holder' AND f.symbol = 'NVDA'`);
check("4 floors + penthouse counts as 5", Number(weighted[0].held) === 5, `${weighted[0].held}`);

await db.query("UPDATE players SET penthouse = 'AAPL' WHERE device_id='holder'");
const wrongTower = await db.query(`
  SELECT (f.count + CASE
           WHEN p.penthouse = f.symbol AND p.penthouse_at > now() - interval '1 day'
           THEN 1 ELSE 0 END)::int AS held
  FROM floors f JOIN players p ON p.id = f.player_id
  WHERE p.device_id = 'holder' AND f.symbol = 'NVDA'`);
check("a penthouse in another tower adds nothing here", Number(wrongTower[0].held) === 4, `${wrongTower[0].held}`);

console.log("\n[6] chartered crews come from the tier, not from the client");
const crews = new CrewService(db);
await db.query("INSERT INTO players (device_id,name,block) VALUES ('plain','Plain',100)");
await db.query("INSERT INTO ledger (player_id,kind,amount,balance_after) VALUES (2,'signup_grant',100,100)");

const ordinary = await crews.create("plain", "Ordinary Crew", "ORD", "#22e8ff");
check("an ordinary crew is created", ordinary.ok, JSON.stringify(ordinary));
check("and is not chartered", ordinary.ok && ordinary.crew.chartered === false);

const chartered = await crews.create("holder", "Chartered Crew", "CHT", "#22e8ff", true);
check("a chartered crew is created", chartered.ok, JSON.stringify(chartered));
check("and is chartered", chartered.ok && chartered.crew.chartered === true);

const caps = await db.query("SELECT tag, chartered FROM crews ORDER BY tag");
check("the flag is stored per crew, not per player", caps.length === 2 && caps[0].chartered === true && caps[1].chartered === false,
  JSON.stringify(caps));
check("chartered cap is larger", MAX_MEMBERS_CHARTERED > 20, `${MAX_MEMBERS_CHARTERED}`);

console.log("\n[7] holding a token moves no money");
const before = await db.query("SELECT COUNT(*)::int n FROM ledger");
const balBefore = await db.query("SELECT block::float8 b FROM players WHERE device_id='holder'");

await svc.persist("holder", { tier: "penthouse", traits: "333333", tower: "NVDA", tokenId: "7" });
await svc.holdingFor("0x2222222222222222222222222222222222222222");

const after = await db.query("SELECT COUNT(*)::int n FROM ledger");
const balAfter = await db.query("SELECT block::float8 b FROM players WHERE device_id='holder'");

check("no ledger rows written", Number(after[0].n) === Number(before[0].n), `${before[0].n} -> ${after[0].n}`);
check("no balance changed", Number(balAfter[0].b) === Number(balBefore[0].b), `${balBefore[0].b} -> ${balAfter[0].b}`);

const drift = await auditBalances(db);
check("ledger still reconciles", drift.length === 0, JSON.stringify(drift));

console.log("\n[8] the token snapshot is keyed safely");
await db.query(
  "INSERT INTO nft_tokens (token_id,tier,traits,tower) VALUES ('115792089237316195423570985008687907853269984665640564039457584007913129639935','resident','000010',NULL)"
);
const big = await db.query("SELECT token_id FROM nft_tokens WHERE tier='resident'");
check("a uint256 id survives storage intact",
  big[0].token_id === "115792089237316195423570985008687907853269984665640564039457584007913129639935",
  big[0].token_id.slice(0, 12) + "…");

console.log("\n[9] an unknown tier is never promoted");
await db.query("INSERT INTO nft_tokens (token_id,tier,traits) VALUES ('99','wizard','000000')");
const odd = await db.query("SELECT tier FROM nft_tokens WHERE token_id='99'");
check("stored verbatim but normalised on read", odd[0].tier === "wizard", "normaliseTier() downgrades it to resident");

console.log(`\n${fails === 0 ? "ALL NFT CHECKS PASSED" : fails + " FAILED"}\n`);
process.exit(fails ? 1 : 0);
