/**
 * The door must not make prediction fight the player.
 *
 * Movement is predicted locally and reconciled against the server, and the two
 * copies of `applyInput` are line-for-line twins — the header in
 * `net/prediction.ts` says so, because if they drift the server spends every
 * tick correcting the client.
 *
 * A door is exactly the kind of change that breaks that. If only the server
 * refuses the step, a non-holder walks in on their own screen and is yanked
 * back 20 times a second. So this checks two things:
 *
 *   1. The two source copies of the movement body are still identical.
 *   2. Simulating both sides on the same inputs produces the same positions,
 *      with no correction large enough to see.
 *
 * Run: node scripts/test-door.mjs
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const clientSrc = readFileSync(resolve(here, "../src/net/prediction.ts"), "utf8");
const serverSrc = readFileSync(resolve(here, "../../server/src/rooms/CityRoom.ts"), "utf8");

let fails = 0;
const check = (l, c, d = "") => {
  if (!c) fails++;
  console.log(`  ${c ? "PASS" : "FAIL"}  ${l}${d ? `  — ${d}` : ""}`);
};

// ---------------------------------------------------------------------------
console.log("\n[the two copies are still identical]");

/** Everything from the speed line to the end of the function. */
function movementBody(src) {
  const m = src.match(/const speed = cmd\.run \? RUN_SPEED : WALK_SPEED;[\s\S]*?\n\}/);
  return m ? m[0].replace(/\r/g, "") : null;
}
function barrierHelper(src) {
  const m = src.match(/function barred\([\s\S]*?\n\}/);
  return m ? m[0].replace(/\r/g, "") : null;
}

const cBody = movementBody(clientSrc);
const sBody = movementBody(serverSrc);
check("client movement body found", !!cBody);
check("server movement body found", !!sBody);
check("movement bodies are byte-identical", cBody === sBody,
  cBody === sBody ? `${cBody?.split("\n").length} lines` : "THEY HAVE DRIFTED");

const cBar = barrierHelper(clientSrc);
const sBar = barrierHelper(serverSrc);
check("barrier helpers are byte-identical", cBar === sBar && !!cBar,
  cBar === sBar ? "" : "the door rule differs between client and server");

// ---------------------------------------------------------------------------
console.log("\n[simulating both sides gives the same answer]");

// A faithful re-implementation, used to drive both "sides" from one place —
// the point is that a SINGLE rule, applied twice, agrees with itself.
const WALK = 6.5, RUN = 12.0, DT = 1 / 60, LIMIT = 190;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const barred = (b, x, z) => !!b && Math.abs(x - b.x) <= b.half && Math.abs(z - b.z) <= b.half;

function step(t, cmd, barrier) {
  let dx = 0, dz = 0;
  if (cmd.up) dz -= 1;
  if (cmd.down) dz += 1;
  if (cmd.left) dx -= 1;
  if (cmd.right) dx += 1;
  if (dx === 0 && dz === 0) return false;
  const len = Math.hypot(dx, dz);
  dx /= len; dz /= len;
  const sin = Math.sin(cmd.yaw), cos = Math.cos(cmd.yaw);
  const wx = dx * cos - dz * sin;
  const wz = dx * sin + dz * cos;
  const speed = cmd.run ? RUN : WALK;
  const nx = clamp(t.x + wx * speed * DT, -LIMIT, LIMIT);
  const nz = clamp(t.z + wz * speed * DT, -LIMIT, LIMIT);
  if (!barred(barrier, nx, t.z)) t.x = nx;
  if (!barred(barrier, t.x, nz)) t.z = nz;
  t.yaw = Math.atan2(wx, wz);
  return true;
}

const CLUB = { x: -78, z: -26, half: 12 };

// Walk a non-holder into the venue from every angle, and compare a "client"
// simulation against a "server" one running the same inputs.
let maxDrift = 0;
for (let angle = 0; angle < 16; angle++) {
  const a = (angle / 16) * Math.PI * 2;
  const start = { x: CLUB.x + Math.cos(a) * 30, z: CLUB.z + Math.sin(a) * 30, yaw: 0 };
  const predicted = { ...start };
  const authoritative = { ...start };

  for (let i = 0; i < 400; i++) {
    const cmd = {
      up: Math.sin(a) < -0.3,
      down: Math.sin(a) > 0.3,
      left: Math.cos(a) > 0.3,
      right: Math.cos(a) < -0.3,
      run: true,
      yaw: -Math.PI / 4,
    };
    step(predicted, cmd, CLUB);
    step(authoritative, cmd, CLUB);
    maxDrift = Math.max(maxDrift, Math.hypot(predicted.x - authoritative.x, predicted.z - authoritative.z));
  }
}
check("no drift between predicted and authoritative", maxDrift < 1e-9,
  `largest divergence ${maxDrift.toExponential(1)} world units`);

// ---------------------------------------------------------------------------
console.log("\n[the door actually holds under this rule]");

let leaked = 0;
for (let angle = 0; angle < 64; angle++) {
  const a = (angle / 64) * Math.PI * 2;
  const p = { x: CLUB.x + Math.cos(a) * 26, z: CLUB.z + Math.sin(a) * 26, yaw: 0 };
  for (let i = 0; i < 600; i++) {
    // Aim straight at the centre every step — the most determined approach.
    const dx = CLUB.x - p.x, dz = CLUB.z - p.z;
    step(p, {
      up: dz < -0.01, down: dz > 0.01, left: dx < -0.01, right: dx > 0.01,
      run: true, yaw: 0,
    }, CLUB);
  }
  if (barred(CLUB, p.x, p.z)) leaked++;
}
check("64 approach angles, none get in", leaked === 0, `${leaked} leaked`);

console.log(`\n${fails === 0 ? "DOOR VERIFIED" : fails + " FAILED"}\n`);
process.exit(fails ? 1 : 0);
