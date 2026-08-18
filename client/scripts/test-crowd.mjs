/**
 * NPC pathing: pedestrians must stay on the pavement.
 *
 * Reproduces the walk logic from `src/pixi/Crowd.ts` and simulates a long walk,
 * checking every position against the city plan.
 *
 * The bug this guards against: turning at a junction kept the old-axis
 * coordinate on the crossing road's CENTRELINE, so after one turn a pedestrian
 * walked down the middle of the carriageway. A second fault let a walker at the
 * map edge end up with both axes moving, sending it diagonally across a block.
 *
 * Run: node scripts/test-crowd.mjs
 */
const ROAD_SPACING = 52;
const ROAD_HALF = 9;
const KERB = 4;
const CITY_HALF = 200;
const KERB_OFFSET = ROAD_HALF + 2.5;
const SPEED = 3.4;

const off = (v) => {
  const m = ((v % ROAD_SPACING) + ROAD_SPACING) % ROAD_SPACING;
  return Math.min(m, ROAD_SPACING - m);
};

/** Straight from plan.ts. */
const isPavement = (x, z) => {
  const dx = off(x);
  const dz = off(z);
  const onX = dx > ROAD_HALF && dx <= ROAD_HALF + KERB;
  const onZ = dz > ROAD_HALF && dz <= ROAD_HALF + KERB;
  return (onX && dz > ROAD_HALF) || (onZ && dx > ROAD_HALF) || (onX && onZ);
};

const roadLines = () => {
  const lines = [];
  const first = -Math.floor(CITY_HALF / ROAD_SPACING) * ROAD_SPACING;
  for (let v = first; v <= CITY_HALF; v += ROAD_SPACING) lines.push(v);
  return lines;
};
const LINES = roadLines();

function retarget(w) {
  const along = w.dx !== 0 ? w.x : w.z;
  const dir = w.dx !== 0 ? w.dx : w.dz;
  let next = dir > 0 ? CITY_HALF : -CITY_HALF;
  let found = false;
  for (const line of LINES) {
    if (dir > 0 && line > along + 2 && line < next) {
      next = line;
      found = true;
    }
    if (dir < 0 && line < along - 2 && line > next) {
      next = line;
      found = true;
    }
  }
  w.atEdge = !found;
  if (w.dx !== 0) {
    w.goalX = next;
    w.goalZ = w.z;
  } else {
    w.goalX = w.x;
    w.goalZ = next;
  }
}

function atJunction(w, rand) {
  if (w.atEdge) {
    w.dx = -w.dx;
    w.dz = -w.dz;
    retarget(w);
    return;
  }
  if (rand() < 0.4) {
    const side = rand() < 0.5 ? 1 : -1;
    if (w.dx !== 0) {
      w.x = w.goalX + KERB_OFFSET * side;
      w.dz = side;
      w.dx = 0;
    } else {
      w.z = w.goalZ + KERB_OFFSET * side;
      w.dx = side;
      w.dz = 0;
    }
  }
  retarget(w);
}

let fails = 0;
const check = (l, c, d = "") => {
  if (!c) fails++;
  console.log(`  ${c ? "PASS" : "FAIL"}  ${l}${d ? `  — ${d}` : ""}`);
};

const walkers = [];
for (let i = 0; i < 60; i++) {
  const alongX = i % 2 === 0;
  const line = LINES[i % LINES.length];
  const side = i % 3 === 0 ? -1 : 1;
  const t = ((i * 37) % 400) - 200;
  const w = alongX
    ? { x: t, z: line + KERB_OFFSET * side, dx: 1, dz: 0 }
    : { x: line + KERB_OFFSET * side, z: t, dx: 0, dz: 1 };
  retarget(w);
  walkers.push(w);
}

let offPavement = 0;
let diagonal = 0;
let offMap = 0;
let turns = 0;
let samples = 0;
const worst = [];
const dt = 1 / 60;

for (let step = 0; step < 60 * 90; step++) {
  for (const w of walkers) {
    const dx = w.goalX - w.x;
    const dz = w.goalZ - w.z;
    if (Math.abs(dx) + Math.abs(dz) < 0.8) {
      const before = `${w.dx},${w.dz}`;
      atJunction(w, Math.random);
      if (`${w.dx},${w.dz}` !== before) turns++;
    } else {
      const len = Math.hypot(dx, dz) || 1;
      w.x += (dx / len) * SPEED * dt;
      w.z += (dz / len) * SPEED * dt;
    }

    if (w.dx !== 0 && w.dz !== 0) diagonal++;
    if (Math.abs(w.x) > CITY_HALF + 1 || Math.abs(w.z) > CITY_HALF + 1) offMap++;

    /**
     * Sample only where the walker is genuinely mid-block.
     *
     * "Distance to the goal junction" is the wrong measure — a walker that has
     * just crossed a junction is 52 units from its next goal and standing on
     * the carriageway it is still crossing. What matters is the distance to the
     * NEAREST road on the axis being travelled.
     */
    const travel = w.dx !== 0 ? w.x : w.z;
    if (off(travel) > ROAD_HALF) {
      samples++;
      if (!isPavement(w.x, w.z)) {
        offPavement++;
        if (worst.length < 5) worst.push({ x: +w.x.toFixed(1), z: +w.z.toFixed(1), dx: w.dx, dz: w.dz });
      }
    }
  }
}

console.log("\n[NPC pathing over 90 simulated seconds, 60 walkers]");
check("the simulation actually sampled positions", samples > 100_000, `${samples} samples`);
check("walkers actually turned", turns > 100, `${turns} turns`);
check("never move diagonally", diagonal === 0, `${diagonal} diagonal frames`);
check("never leave the map", offMap === 0, `${offMap} escapes`);
check(
  "always on the pavement mid-block",
  offPavement === 0,
  `${offPavement} of ${samples} samples off-pavement${
    worst.length ? " — e.g. " + JSON.stringify(worst[0]) : ""
  }`
);

console.log(`\n${fails === 0 ? "NPC PATHING VERIFIED" : fails + " FAILED"}\n`);
process.exit(fails ? 1 : 0);
