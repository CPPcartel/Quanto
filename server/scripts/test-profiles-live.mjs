/**
 * The profile surface, over a real connection.
 *
 * The unit tests cover the rules. This covers the wiring: that a fresh account
 * really does arrive unclaimed, that claiming is reflected in replicated state
 * where every other player can see it, that a rename survives the write-behind
 * flusher, and that a second player genuinely cannot take a name the first one
 * holds.
 *
 * The flusher assertion is the one that matters most. The player row is upserted
 * absolutely, name included, so writing the database without updating the
 * in-memory copy means the next flush silently puts the old name back — the same
 * class of bug as the trade balances, and just as invisible inside one session.
 *
 *   E2E_URL=ws://localhost:2567 node scripts/test-profiles-live.mjs
 */
import { Client } from "colyseus.js";

const URL = process.env.E2E_URL ?? "ws://localhost:2567";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let fails = 0;
const check = (l, c, d = "") => {
  if (!c) fails++;
  console.log(`  ${c ? "PASS" : "FAIL"}  ${l}${d ? `  — ${d}` : ""}`);
};

const next = (room, type, ms = 8000) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for ${type}`)), ms);
    room.onMessage(type, (payload) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });

const waitUntil = async (fn, ms = 8000) => {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (fn()) return true;
    await sleep(100);
  }
  return false;
};

const stamp = Date.now().toString(36).slice(-5);
const client = new Client(URL);

console.log(`\n=== profiles at ${URL} ===`);

const alice = await client.joinOrCreate("city", { deviceId: `prof-alice-${stamp}` });
const bob = await client.joinOrCreate("city", { deviceId: `prof-bob-${stamp}` });
await sleep(2500);

console.log("\n[1] a new account arrives unclaimed");
const aliceSelf = () => alice.state.players.get(alice.sessionId);
check("alice is in the city", !!aliceSelf());
check("with a name she did not choose", aliceSelf()?.nameClaimed === false, String(aliceSelf()?.nameClaimed));
check("and a placeholder name", /^Trader\d+$/.test(aliceSelf()?.name ?? ""), aliceSelf()?.name);

console.log("\n[2] availability is answered before committing");
const wanted = `Sky${stamp}`;
alice.send("checkName", wanted);
const free = await next(alice, "checkNameResult");
check("a free name reports free", free.ok === true, JSON.stringify(free));

alice.send("checkName", "admin");
const reserved = await next(alice, "checkNameResult");
check("a reserved name is refused", reserved.ok === false, reserved.reason);

alice.send("checkName", "a");
const short = await next(alice, "checkNameResult");
check("a short name is refused", short.ok === false, short.reason);

console.log("\n[3] claiming it");
alice.send("claimName", wanted);
const claimed = await next(alice, "claimNameResult");
check("the claim succeeds", claimed.ok === true, JSON.stringify(claimed));
check("and returns a cooldown", typeof claimed.readyAt === "number" && claimed.readyAt > Date.now());

const seen = await waitUntil(() => aliceSelf()?.name === wanted && aliceSelf()?.nameClaimed === true);
check("replicated state shows the new name", seen, aliceSelf()?.name);

// Everybody in the city sees it, not just her.
const bobSeesAlice = () => bob.state.players.get(alice.sessionId);
check(
  "and every other player sees it too",
  await waitUntil(() => bobSeesAlice()?.name === wanted),
  bobSeesAlice()?.name,
);

console.log("\n[4] the name survives the write-behind flusher");
/**
 * The regression. persist() queues the player row and the flusher upserts it
 * absolutely; if the claim had only written SQL, the next flush would put the
 * placeholder back. Five seconds comfortably outlasts the flush interval.
 */
await sleep(6500);
check("still the claimed name after a flush", aliceSelf()?.name === wanted, aliceSelf()?.name);

console.log("\n[5] a second player cannot take it");
bob.send("claimName", wanted);
const stolen = await next(bob, "claimNameResult");
check("bob is refused", stolen.ok === false, stolen.reason);

bob.send("claimName", wanted.toUpperCase());
const cased = await next(bob, "claimNameResult");
check("nor in different capitals", cased.ok === false, cased.reason);
check("bob is still unclaimed", bob.state.players.get(bob.sessionId)?.nameClaimed === false);

console.log("\n[6] renaming again is refused inside the cooldown");
alice.send("claimName", `Other${stamp}`);
const tooSoon = await next(alice, "claimNameResult");
check("the cooldown holds", tooSoon.ok === false, tooSoon.reason);
check("and says when", typeof tooSoon.readyAt === "number" && tooSoon.readyAt > Date.now());
check("the name did not change", aliceSelf()?.name === wanted, aliceSelf()?.name);

console.log("\n[7] the profile reports the account");
alice.send("getProfile");
const profile = await next(alice, "profile");
check("it comes back", profile?.name === wanted, JSON.stringify(profile).slice(0, 90));
check("marked claimed", profile.nameClaimed === true);
check("with the cooldown", profile.renameReadyAt > Date.now());
check("and no device id", !JSON.stringify(profile).includes("prof-alice"));

/**
 * Types, not just presence.
 *
 * The panel formats these, and a value of the wrong shape does not render
 * wrongly, it throws and unmounts the interface. That is exactly what happened:
 * the driver returns Date objects, msgpack preserves them where JSON would have
 * stringified them, and the client called .slice on a Date. Asserting the
 * contents alone would not have caught it.
 */
check("createdAt is a string, not a Date", typeof profile.createdAt === "string", typeof profile.createdAt);
check("and parses as a date", !Number.isNaN(new Date(profile.createdAt).getTime()), String(profile.createdAt));
check("renameReadyAt is a number", typeof profile.renameReadyAt === "number", typeof profile.renameReadyAt);
check("nameClaimed is a boolean", typeof profile.nameClaimed === "boolean", typeof profile.nameClaimed);
check("color is a string", typeof profile.color === "string", typeof profile.color);
check(
  "every field survives JSON, so no exotic types leak",
  JSON.stringify(profile) === JSON.stringify(JSON.parse(JSON.stringify(profile))),
);

console.log("\n[8] appearance");
alice.send("setAvatar", "120000");
const looked = await next(alice, "setAvatarResult");
check("a permitted look is accepted", looked.ok === true && looked.traits === "120000", String(looked.traits));
check("replicated to everyone", await waitUntil(() => bobSeesAlice()?.traits === "120000"), bobSeesAlice()?.traits);

/**
 * The check that protects the collection. Alice holds nothing, so the halo in
 * the last slot must not survive — whatever the client asks for.
 */
alice.send("setAvatar", "000004");
const greedy = await next(alice, "setAvatarResult");
check("a holder-only trait is refused", greedy.traits?.[5] !== "4", String(greedy.traits));
check("but the rest of the code survives", greedy.traits?.length === 6, String(greedy.traits));

alice.send("setAvatar", null);
const reset = await next(alice, "setAvatarResult");
check("clearing works", reset.ok === true, JSON.stringify(reset));

console.log("\n[9] colour");
alice.send("setColor", "#22e8ff");
check("it replicates", await waitUntil(() => aliceSelf()?.color === "#22e8ff"), aliceSelf()?.color);
alice.send("setColor", "not-a-colour");
await sleep(400);
check("garbage is ignored, not applied", aliceSelf()?.color === "#22e8ff", aliceSelf()?.color);

await alice.leave();
await bob.leave();

console.log(fails === 0 ? "\nALL LIVE PROFILE CHECKS PASSED\n" : `\n${fails} FAILED\n`);
process.exit(fails === 0 ? 0 : 1);
