/**
 * The Vault.
 *
 * Two things must hold, and the first one matters far more than the second:
 *
 *   The door holds. A non-holder cannot walk in, cannot be nudged in by forged
 *   input, and cannot slip in diagonally along a wall.
 *
 *   The club pays nothing. It is a cosmetic space. A holders-only area that also
 *   earns is an earnings advantage bought with money, which is the one shape
 *   this project has avoided everywhere else.
 */
import { applyInput } from "../dist/rooms/CityRoom.js";
import { CLUB, insideClub, parkAt, parkLots } from "../dist/config/parks.js";
import { ClubService } from "../dist/game/club.js";
import { CityState, Player } from "../dist/rooms/schema/CityState.js";
import { accrue, initPlayerEconomy } from "../dist/game/floors.js";

let fails = 0;
const check = (l, c, d = "") => {
  if (!c) fails++;
  console.log(`  ${c ? "PASS" : "FAIL"}  ${l}${d ? `  — ${d}` : ""}`);
};

const BARRIER = { x: CLUB.x, z: CLUB.z, half: CLUB.half };
const SIM_DT = 1 / 60;
const move = (target, dir, barrier, steps = 600) => {
  for (let i = 0; i < steps; i++) {
    applyInput(target, { seq: i, ...dir, run: true, yaw: 0 }, SIM_DT, barrier);
  }
  return target;
};

console.log("\n[1] the venue exists and is where it should be");
const lots = parkLots();
const club = lots.filter((l) => l.kind === "club");
check("exactly one club", club.length === 1);
check("it is The Vault", club[0]?.id === "vault", club[0]?.id);
check("centre reads as inside", insideClub(CLUB.x, CLUB.z));
check("just outside reads as outside", !insideClub(CLUB.x + CLUB.half + 1, CLUB.z));
check(
  "no park overlaps it",
  !lots.some(
    (l) =>
      l.kind !== "club" &&
      l.kind !== "plaza" &&
      Math.abs(l.x - CLUB.x) < l.half + CLUB.half &&
      Math.abs(l.z - CLUB.z) < l.half + CLUB.half
  )
);

console.log("\n[2] THE DOOR — a non-holder cannot get in");
// Walk straight at it from every side, hard, for ten seconds.
const approaches = [
  ["from the east", { x: CLUB.x + 40, z: CLUB.z }, { up: false, down: false, left: true, right: false }],
  ["from the west", { x: CLUB.x - 40, z: CLUB.z }, { up: false, down: false, left: false, right: true }],
  ["from the north", { x: CLUB.x, z: CLUB.z - 40 }, { up: false, down: true, left: false, right: false }],
  ["from the south", { x: CLUB.x, z: CLUB.z + 40 }, { up: true, down: false, left: false, right: false }],
];
for (const [label, start, dir] of approaches) {
  const p = { ...start, yaw: 0 };
  move(p, dir, BARRIER);
  check(label, !insideClub(p.x, p.z), `ended at ${p.x.toFixed(1)}, ${p.z.toFixed(1)}`);
}

console.log("\n[3] and cannot slip in diagonally");
for (const [dx, dz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
  const p = { x: CLUB.x - dx * 40, z: CLUB.z - dz * 40, yaw: 0 };
  move(p, { up: dz > 0, down: dz < 0, left: dx < 0, right: dx > 0 }, BARRIER);
  if (insideClub(p.x, p.z)) fails++;
}
check("all four diagonals refused", true, "corner approach is where a naive check leaks");

console.log("\n[4] a holder walks straight in");
// 200 steps at run speed is 40 units — just enough to reach the middle. 600
// carried them clean through the venue and out the far side, which proved the
// door was open but failed the assertion.
const holder = { x: CLUB.x + 40, z: CLUB.z, yaw: 0 };
move(holder, { up: false, down: false, left: true, right: false }, null, 200);
check("no barrier means no obstruction", insideClub(holder.x, holder.z),
  `ended at ${holder.x.toFixed(1)}, ${holder.z.toFixed(1)}`);

console.log("\n[5] the wall can be slid along, not stuck to");
// Approach the side, then walk parallel. A combined-axis test would freeze here.
const slider = { x: CLUB.x + CLUB.half + 1.5, z: CLUB.z - 30, yaw: 0 };
const startZ = slider.z;
move(slider, { up: false, down: true, left: false, right: false }, BARRIER, 300);
check("moved along the wall", Math.abs(slider.z - startZ) > 20, `travelled ${(slider.z - startZ).toFixed(1)}`);
check("without entering", !insideClub(slider.x, slider.z));

console.log("\n[6] nothing outside the club is restricted");
const far = { x: 120, z: 120, yaw: 0 };
const before = { ...far };
move(far, { up: true, down: false, left: false, right: false }, BARRIER, 120);
check("a non-holder moves freely elsewhere", Math.abs(far.z - before.z) > 5,
  `moved ${(before.z - far.z).toFixed(1)}`);

console.log("\n[7] the club pays nothing");
const state = new CityState();
const p = new Player();
initPlayerEconomy(p);
p.charge = 10;
p.x = CLUB.x;
p.z = CLUB.z;
state.players.set("clubber", p);

const blockBefore = p.block;
const payouts = accrue(state, 10 * 60 * 1000);
check("standing in the club earns no $BLOCK", p.block === blockBefore, `${blockBefore} -> ${p.block}`);
check("and produces no payout row", payouts.length === 0, `${payouts.length}`);
check("and does NOT pay the park resting bonus", parkAt(CLUB.x, CLUB.z) === null,
  "a venue is not a park");
check("resting flag is false inside the club", p.resting === false);

console.log("\n[8] events fire from market transitions, not a timer");
const svc = new ClubService();
const s2 = new CityState();
s2.phase = "open";

check("first tick primes rather than firing", svc.tick(s2, "Week A") === "",
  "a restart must not throw a party nobody came to");

s2.phase = "closed";
check("open -> closed starts the Closing Bell", svc.tick(s2, "Week A") === "closing_bell");
check("it has an end time", s2.clubEndsAt > Date.now());
check("staying closed does not re-fire", svc.tick(s2, "Week A") === "");

s2.stormSymbol = "NVDA";
check("a storm outranks and starts a rave", svc.tick(s2, "Week A") === "storm_rave");
check("intensity is maxed during a rave", s2.clubIntensity === 1, `${s2.clubIntensity}`);

s2.stormSymbol = "";
svc.tick(s2, "Week A");
check("a new season starts a party", svc.tick(s2, "Week B") === "season_party");

console.log("\n[9] occupancy is counted from real positions");
const s3 = new CityState();
for (const [id, x, z] of [["in1", CLUB.x, CLUB.z], ["in2", CLUB.x + 5, CLUB.z + 5], ["out", 150, 150]]) {
  const q = new Player();
  q.x = x;
  q.z = z;
  s3.players.set(id, q);
}
new ClubService().tick(s3, "Week A");
check("two inside, one outside", s3.clubInside === 2, `${s3.clubInside}`);

console.log(`\n${fails === 0 ? "ALL CLUB CHECKS PASSED" : fails + " FAILED"}\n`);
process.exit(fails ? 1 : 0);
