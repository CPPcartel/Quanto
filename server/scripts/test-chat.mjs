/**
 * Chat routing.
 *
 * Three channels with genuinely different rules: `local` and `district` are
 * about WHERE you are, `crew` is about who you are with. Crew is the only one
 * that ignores distance, which is the point of belonging to one — and also the
 * only one that could accidentally reach the wrong people.
 *
 * The check that matters most is the last one: a player with no crew must have
 * an EMPTY crew audience, not "everyone else who also has no crew". Matching on
 * an empty tag would turn the crew channel into the global channel this game
 * deliberately does not have.
 */
import { ChatService } from "../dist/game/chat.js";
import { CityState, Player, District } from "../dist/rooms/schema/CityState.js";

let fails = 0;
const check = (l, c, d = "") => {
  if (!c) fails++;
  console.log(`  ${c ? "PASS" : "FAIL"}  ${l}${d ? `  — ${d}` : ""}`);
};

const state = new CityState();
const d = new District();
d.id = "tech";
d.cx = 90;
d.cz = -90;
state.districts.push(d);

function add(id, x, z, crewTag = "") {
  const p = new Player();
  p.x = x;
  p.z = z;
  p.crewTag = crewTag;
  p.name = id;
  state.players.set(id, p);
}

// Two crewmates at opposite corners, a stranger beside one, a rival beside the other.
add("alice", -150, -150, "BULL");
add("bob", 150, 150, "BULL");
add("stranger", -148, -148, "");
add("rival", 150, 148, "BEAR");

// The database is only used for the moderation log, which these tests do not touch.
const chat = new ChatService({ query: async () => [] });

console.log("\n[crew reaches across the whole map]");
const crew = chat.audience(state, "alice", "crew");
check("alice hears herself", crew.includes("alice"));
check("bob hears it from 424 units away", crew.includes("bob"),
  "distance is irrelevant on the crew channel");
check("the stranger standing next to her does not", !crew.includes("stranger"));
check("a rival crew does not", !crew.includes("rival"));
check("exactly two recipients", crew.length === 2, `${crew.length}`);

console.log("\n[local is still proximity-based]");
const local = chat.audience(state, "alice", "local");
check("the stranger 2 units away hears it", local.includes("stranger"));
check("her crewmate across the map does not", !local.includes("bob"));

console.log("\n[a crewless player has no crew audience]");
check("empty, not everyone", chat.audience(state, "stranger", "crew").length === 0,
  "matching on an empty tag would reach every crewless player");

console.log("\n[the channel is validated, never trusted]");
check("unknown channel falls back to local",
  chat.accept("s1", { text: "hi", channel: "global" })?.channel === "local");
check("crew is accepted", chat.accept("s2", { text: "hi", channel: "crew" })?.channel === "crew");
check("district still works", chat.accept("s3", { text: "hi", channel: "district" })?.channel === "district");

console.log("\n[sanitising still applies on every channel]");
const nasty = ["hi", String.fromCharCode(0), String.fromCharCode(0x202e), "  there"].join("");
check("control and bidi stripped", chat.accept("s4", { text: nasty, channel: "crew" })?.text === "hi there",
  JSON.stringify(chat.accept("s5", { text: nasty, channel: "crew" })?.text));

console.log(`\n${fails === 0 ? "ALL CHAT CHECKS PASSED" : fails + " FAILED"}\n`);
process.exit(fails ? 1 : 0);
