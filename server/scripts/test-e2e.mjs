/**
 * End-to-end test against a running server, over a real websocket.
 *
 * The unit tests exercise the services directly; this one goes through the
 * Colyseus room the way the browser does, so it covers the wiring between them
 * — message names, schema replication, and the ledger flush ordering that only
 * matters when state lives in memory and on disk at the same time.
 *
 * Run against a throwaway server:
 *   PORT=2599 DATA_DIR=./data-e2e node dist/index.js
 *   node scripts/test-e2e.mjs
 */
import { Client } from "colyseus.js";

const URL = process.env.E2E_URL ?? "ws://localhost:2599";
let fails = 0;
const check = (label, cond, detail = "") => {
  if (!cond) fails++;
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Wait for a named message, or reject so a hang fails loudly instead of stalling. */
function next(room, type, ms = 8000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for "${type}"`)), ms);
    const off = room.onMessage(type, (payload) => {
      clearTimeout(timer);
      off();
      resolve(payload);
    });
  });
}

/**
 * Fresh identities each run. Fixed device ids made the suite pass once and then
 * fail on every rerun, because the second Alice was already in a crew and
 * already owned floors from the first.
 */
const RUN = Date.now().toString(36);
const ALICE = `e2e-alice-${RUN}`;
const BOB = `e2e-bob-${RUN}`;
const TAG = "N" + RUN.slice(-3).toUpperCase();

const client = new Client(URL);
const alice = await client.joinOrCreate("city", { deviceId: ALICE });
const bob = await client.joinOrCreate("city", { deviceId: BOB });

console.log("\n[1] both players are in the same city");
// Towers arrive before their economics do — floorPrice lands in a later patch,
// so a short wait here finds 38 tickers with no prices on any of them.
await sleep(3000);
check("alice sees bob", alice.state.players.size >= 2, `players=${alice.state.players.size}`);
check("towers replicated", alice.state.tickers.size > 0, `tickers=${alice.state.tickers.size}`);

alice.send("setName", "Alice");
bob.send("setName", "Bob");
await sleep(300);

console.log("\n[2] buying a floor");
// Pick the cheapest tower so the starting grant definitely covers it.
const towers = [...alice.state.tickers.values()]
  .filter((t) => t.floorPrice > 0)
  .sort((a, b) => a.floorPrice - b.floorPrice);
const target = towers[0];
check("found a purchasable tower", !!target, target ? `${target.symbol} @ ${target.floorPrice}` : "none");

/**
 * Occupancy is asserted as a delta, not an absolute.
 *
 * The database outlives a single run, so this tower may already hold floors
 * bought by an earlier run. What must be true is that a purchase adds exactly
 * one and a *transfer* adds none — which is the property worth testing anyway.
 */
const baseOccupancy = target.ownedFloors ?? 0;

alice.send("buyFloor", target.symbol);
const bought = await next(alice, "buyFloorResult");
check("alice bought a floor", bought.ok, JSON.stringify(bought));

await sleep(400);
const aliceP = alice.state.players.get(alice.sessionId);
check("floor shows on her player", aliceP.floors.get(target.symbol) >= 1);
check(
  "the tower lights up for everyone",
  bob.state.tickers.get(target.symbol).ownedFloors === baseOccupancy + 1,
  `ownedFloors=${bob.state.tickers.get(target.symbol).ownedFloors} (was ${baseOccupancy})`
);

console.log("\n[3] crews");
alice.send("crewCreate", { name: "Neon Bulls", tag: TAG, color: "#22e8ff" });
const created = await next(alice, "crewResult");
check("crew founded", created.ok, JSON.stringify(created));

const aliceCrew = await next(alice, "crewState");
check("crew state pushed to founder", aliceCrew?.tag === TAG, JSON.stringify(aliceCrew));
check("founder is leader", aliceCrew?.isLeader === true);

await sleep(500);
check(
  "bob sees her crew tag in-world",
  bob.state.players.get(alice.sessionId)?.crewTag === TAG,
  `tag=${bob.state.players.get(alice.sessionId)?.crewTag}`
);

bob.send("crewJoin", TAG);
const joined = await next(bob, "crewResult");
check("bob joined by tag", joined.ok, JSON.stringify(joined));
const bobCrew = await next(bob, "crewState");
check("bob is a member, not leader", bobCrew?.members === 2 && bobCrew.isLeader === false, JSON.stringify(bobCrew));

bob.send("crewJoin", TAG);
const again = await next(bob, "crewResult");
check("cannot join twice", !again.ok, again.reason);

console.log("\n[4] chat");
const heard = new Promise((resolve) => bob.onMessage("chat", resolve));
// Nasty input, written as escapes rather than pasted: a literal NUL and bidi
// override make this file binary to grep and diff, and one careless save would
// silently drop the very characters the test exists to check.
const NASTY = [
  "  hello   city ",
  String.fromCharCode(0x00),   // NUL
  String.fromCharCode(0x202e), // right-to-left override
  "  ",
].join("");
alice.send("chat", { text: NASTY, channel: "district" });
const msg = await heard;
check("bob received it", !!msg, JSON.stringify(msg));
check("control + bidi chars stripped", msg.text === "hello city", JSON.stringify(msg.text));
check("crew tag travels with the message", msg.crewTag === TAG, msg.crewTag);

console.log("\n[5] floor market");
alice.send("listFloor", { symbol: target.symbol, price: 60 });
const listed = await next(alice, "listFloorResult");
check("floor listed", listed.ok, JSON.stringify(listed));

await sleep(600);
const visible = [...bob.state.listings.values()];
check("listing replicated to bob", visible.length === 1, `listings=${visible.length}`);
check("listing carries the seller", visible[0]?.sellerName === "Alice", visible[0]?.sellerName);

const bobBefore = bob.state.players.get(bob.sessionId).block;
const aliceBefore = alice.state.players.get(alice.sessionId).block;

bob.send("buyListing", visible[0].id);
const traded = await next(bob, "buyListingResult");
check("trade settled", traded.ok, JSON.stringify(traded));

await sleep(900);
const bobAfter = bob.state.players.get(bob.sessionId).block;
const aliceAfter = alice.state.players.get(alice.sessionId).block;
check("buyer debited 60", Math.round(bobBefore - bobAfter) === 60, `${bobBefore} -> ${bobAfter}`);
check("seller credited 60", Math.round(aliceAfter - aliceBefore) === 60, `${aliceBefore} -> ${aliceAfter}`);
check("floor moved to bob", bob.state.players.get(bob.sessionId).floors.get(target.symbol) >= 1);
check(
  "and left alice",
  (alice.state.players.get(alice.sessionId).floors.get(target.symbol) ?? 0) === 0,
  `alice still has ${alice.state.players.get(alice.sessionId).floors.get(target.symbol)}`
);
check("listing cleared from state", bob.state.listings.size === 0, `size=${bob.state.listings.size}`);

console.log("\n[6] the tower did not lose or gain floors in the trade");
await sleep(400);
check(
  "occupancy unchanged by a transfer",
  bob.state.tickers.get(target.symbol).ownedFloors === baseOccupancy + 1,
  `ownedFloors=${bob.state.tickers.get(target.symbol).ownedFloors} (was ${baseOccupancy})`
);

console.log("\n[7] the trade survives a flush and a reconnect");
/**
 * This is the check that matters. Settlement happens in SQL while both players
 * also exist in memory, and the write-behind flusher writes memory back with an
 * absolute upsert. If the seller's live state isn't corrected after a trade,
 * the flush silently undoes the payment and restores the sold floor — the buyer
 * has paid for a floor that now exists twice. Only a reload shows it.
 */
await sleep(7000); // past the 5s flush interval
await alice.leave();
await sleep(500);

const alice2 = await client.joinOrCreate("city", { deviceId: ALICE });
await sleep(2500);
const reloaded = alice2.state.players.get(alice2.sessionId);
// 500 granted, minus what the floor cost, plus the 60 it sold for. Compared
// with a tolerance because yield accrues in the background throughout the run.
const expected = 500 - bought.spent + 60;
check(
  "seller's payment persisted",
  Math.abs(reloaded.block - expected) < 2,
  `block=${reloaded.block}, expected ~${expected}`
);
check(
  "sold floor did not come back",
  (reloaded.floors.get(target.symbol) ?? 0) === 0,
  `floors=${reloaded.floors.get(target.symbol)}`
);
check(
  "buyer still holds the floor",
  bob.state.players.get(bob.sessionId).floors.get(target.symbol) === 1,
  `floors=${bob.state.players.get(bob.sessionId).floors.get(target.symbol)}`
);
check(
  "the floor was not duplicated",
  bob.state.tickers.get(target.symbol).ownedFloors === baseOccupancy + 1,
  `ownedFloors=${bob.state.tickers.get(target.symbol).ownedFloors} (was ${baseOccupancy})`
);

await alice2.leave();
await bob.leave();
console.log(`\n${fails === 0 ? "ALL E2E CHECKS PASSED" : fails + " FAILED"}\n`);
process.exit(fails ? 1 : 0);
