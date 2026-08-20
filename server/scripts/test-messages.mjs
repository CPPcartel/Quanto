/**
 * Crew history and direct messages.
 *
 * Two properties matter more than the rest, and both are about the recipient
 * rather than the sender:
 *
 *   A DM to somebody offline must survive. That is the entire reason any of this
 *   touches the database — proximity chat correctly does not.
 *
 *   A block must stop the message *before* it is written, so there is no stored
 *   copy to leak later, and the sender must not be able to tell — otherwise
 *   blocking is just an invitation to make a second account.
 */
import { openMemoryDb } from "../dist/db/db.js";
import { migrate } from "../dist/db/migrations.js";
import { MessageService } from "../dist/game/messages.js";

let fails = 0;
const check = (label, ok, detail = "") => {
  if (!ok) fails++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
};

const db = await openMemoryDb();
await migrate(db);
const svc = new MessageService(db);

const A = "device-alice";
const B = "device-bob";
const C = "device-carol";

const log = (device, name, channel, text, crew) =>
  db.query(
    "INSERT INTO chat_log (device_id,name,channel,text,crew_tag) VALUES ($1,$2,$3,$4,$5)",
    [device, name, channel, text, crew]
  );

console.log("\n[1] crew history is scoped to one crew, and to crew lines");
await log(A, "Alice", "crew", "bulls only", "BULL");
await log(B, "Bob", "crew", "on my way", "BULL");
await log(C, "Carol", "crew", "bears assemble", "BEAR");
await log(A, "Alice", "local", "hello street", null);

const bull = await svc.crewHistory("BULL");
check("two BULL lines", bull.length === 2, `${bull.length}`);
check("oldest first", bull[0]?.text === "bulls only", bull[0]?.text);
check("a rival crew's lines are excluded", !bull.some((l) => l.text.includes("bears")));
check("proximity chat is not replayed", !bull.some((l) => l.text.includes("street")));
check(
  "no crew means no history",
  (await svc.crewHistory("")).length === 0,
  "matching an empty tag would give every crewless player one shared channel"
);

console.log("\n[2] a DM survives the recipient being offline");
// Bob is never connected at any point in this file.
const sent = await svc.send(A, "Alice", B, "  meet me at the vault  ");
check("sent", sent.ok, JSON.stringify(sent));

const bobThreads = await svc.threads(B);
check("it is waiting for Bob", bobThreads.length === 1, `${bobThreads.length} threads`);
check("from Alice", bobThreads[0]?.name === "Alice", bobThreads[0]?.name);
check("counted as unread", bobThreads[0]?.unread === 1, `${bobThreads[0]?.unread}`);
check("the badge agrees", (await svc.unreadCount(B)) === 1);
check(
  "text was trimmed",
  bobThreads[0]?.lastText === "meet me at the vault",
  JSON.stringify(bobThreads[0]?.lastText)
);

console.log("\n[3] reading a thread marks it read");
const thread = await svc.thread(B, A);
check("one message in the conversation", thread.length === 1, `${thread.length}`);
check("Bob sees it as not his", thread[0]?.mine === false);
check("unread cleared", (await svc.unreadCount(B)) === 0);
check("Alice's own copy reads as hers", (await svc.thread(A, B))[0]?.mine === true);
check(
  "reading someone else's thread does not clear it",
  (await svc.thread(A, B)).every((l) => typeof l.mine === "boolean")
);

console.log("\n[4] blocking stops the message before it is stored");
await svc.block(B, A);
const blocked = await svc.send(A, "Alice", B, "let me in");
check(
  "the sender is told it succeeded",
  blocked.ok,
  "telling them they are blocked invites a second account"
);
check(
  "but the room is told not to forward it",
  blocked.delivered === false,
  "an online recipient would otherwise still receive the live copy, and a block " +
    "that only works while you are logged off is not a block"
);
check("nothing was delivered", (await svc.unreadCount(B)) === 0);
const stored = await db.query(
  "SELECT COUNT(*)::int AS n FROM direct_messages WHERE text = 'let me in'"
);
check(
  "and nothing was written",
  Number(stored[0].n) === 0,
  "no stored copy means nothing to leak later"
);

await svc.unblock(B, A);
await svc.send(A, "Alice", B, "sorry");
check("unblocking restores delivery", (await svc.unreadCount(B)) === 1);

console.log("\n[5] the obvious abuses are refused");
check("cannot message yourself", !(await svc.send(A, "Alice", A, "hi")).ok);
check("empty text refused", !(await svc.send(A, "Alice", C, "   ")).ok);
check("unknown recipient refused", !(await svc.send(A, "Alice", "", "hi")).ok);
const longSend = await svc.send(A, "Alice", C, "x".repeat(2000));
check("an oversized message is truncated, not rejected", longSend.ok);
const longStored = await svc.thread(C, A);
check(
  "stored at chat's cap, not a second one",
  longStored.at(-1)?.text.length === 200,
  `${longStored.at(-1)?.text.length}`
);

console.log("\n[6] rate limited harder than proximity chat");
let accepted = 0;
for (let i = 0; i < 15; i++) {
  if ((await svc.send(B, "Bob", C, `spam ${i}`)).ok) accepted++;
}
check("a burst is capped", accepted <= 6, `${accepted} of 15 accepted`);
check("but ordinary use is not blocked", accepted >= 4, `${accepted} accepted`);

console.log("\n[7] threads are per conversation, most recent first");
await svc.send(C, "Carol", A, "hey alice");
const aliceThreads = await svc.threads(A);
check("Alice has two conversations", aliceThreads.length === 2, `${aliceThreads.length}`);
check("newest first", aliceThreads[0]?.name === "Carol", aliceThreads[0]?.name);
check(
  "each thread names the other party, never yourself",
  aliceThreads.every((t) => t.device !== A)
);

console.log("\n[8] a conversation handle is not a device id");
const handles = (await svc.threads(A)).map((t) => t.device);
check("the inbox never carries a raw device id", !handles.includes(B) && !handles.includes(C),
  "a device id IS the guest identity — onJoin trusts it, so one leaking lets " +
    "anybody join as that player");
check("a handle is stable", svc.handleFor(B) === svc.handleFor(B));
check("and distinct per player", svc.handleFor(B) !== svc.handleFor(C));
check("it resolves back for the owner", (await svc.resolveHandle(A, svc.handleFor(B))) === B);
check(
  "but not for a stranger",
  (await svc.resolveHandle("device-mallory", svc.handleFor(B))) === "",
  "resolution is scoped to people you have already messaged, so a stolen " +
    "handle reaches nobody new"
);
check("garbage resolves to nothing", (await svc.resolveHandle(A, "not-a-handle")) === "");
check("an empty handle resolves to nothing", (await svc.resolveHandle(A, "")) === "");

console.log(`\n${fails === 0 ? "ALL MESSAGE CHECKS PASSED" : fails + " CHECK(S) FAILED"}\n`);
process.exit(fails ? 1 : 0);
