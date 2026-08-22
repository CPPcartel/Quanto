/**
 * An unknown message type must not disconnect the player.
 *
 * Colyseus's default handler for an unregistered message calls
 * client.leave(WS_CLOSE_WITH_ERROR) unless the server is in dev mode. That
 * turns any drift between what the client sends and what the server handles
 * into a kick, in production, for the player who did nothing wrong.
 *
 * It is not hypothetical. The HUD's rename form went on sending "setName"
 * after the claim flow replaced that handler, so renaming threw the player out
 * of the city. The room now registers a "*" handler, which replaces the kick
 * with a log line and a message telling the client it is out of date.
 *
 * To see this test fail, comment out the onMessage("*") registration in
 * CityRoom and run it again: the disconnect assertion fires immediately.
 *
 *   E2E_URL=ws://localhost:2567 node scripts/test-protocol-live.mjs
 */
import { Client } from "colyseus.js";

const URL = process.env.E2E_URL ?? "ws://localhost:2567";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let fails = 0;
const check = (l, c, d = "") => {
  if (!c) fails++;
  console.log(`  ${c ? "PASS" : "FAIL"}  ${l}${d ? `  — ${d}` : ""}`);
};

const client = new Client(URL);
console.log(`\n=== protocol resilience at ${URL} ===`);

const room = await client.joinOrCreate("city", { deviceId: `proto-${Date.now()}` });
await sleep(2000);

let left = null;
room.onLeave((code) => {
  left = code;
});

let told = null;
room.onMessage("actionFailed", (p) => {
  told = p;
});

console.log("\n[1] the exact message the HUD used to send");
room.send("setName", "Renamed");
await sleep(2500);

check("still in the city after sending setName", left === null, left === null ? "connected" : `kicked with code ${left}`);
check("and told the client it is out of date", told?.type === "setName", JSON.stringify(told));

console.log("\n[2] any other unknown type is equally harmless");
room.send("thisWillNeverExist", { anything: true });
await sleep(2000);
check("still connected", left === null, left === null ? "connected" : `kicked with code ${left}`);

console.log("\n[3] and the connection still works afterwards");
const before = room.state.players.get(room.sessionId)?.name;
room.send("claimName", `proto${String(Date.now()).slice(-6)}`);
await sleep(3000);
const after = room.state.players.get(room.sessionId)?.name;
check("a real handler still runs", !!after && after !== before, `${before} -> ${after}`);

if (left === null) try {
  await room.leave();
} catch {
  /* already gone */
}

console.log(fails === 0 ? "\nALL PROTOCOL CHECKS PASSED\n" : `\n${fails} CHECK(S) FAILED\n`);
process.exit(fails === 0 ? 0 : 1);
