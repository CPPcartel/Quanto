import { parkLots, parkAt, PLAZA_RADIUS } from "../dist/config/parks.js";
import { TICKERS, layoutFor } from "../dist/config/tickers.js";

let fails = 0;
const check = (l, c, d = "") => { if (!c) fails++; console.log(`  ${c ? "PASS" : "FAIL"}  ${l}${d ? `  — ${d}` : ""}`); };

const lots = parkLots();
const parks = lots.filter((l) => l.kind !== "plaza");
const water = lots.filter((l) => l.kind === "water");

console.log("\n[1] layout");
check("parks were generated", parks.length > 10, `${parks.length} parks, ${water.length} with water`);
check("exactly one plaza", lots.filter((l) => l.kind === "plaza").length === 1);
check("plaza is at the origin", lots[0].x === 0 && lots[0].z === 0 && lots[0].half === PLAZA_RADIUS);

console.log("\n[2] no park sits on a road or pavement");
const ROAD_SPACING = 52, ROAD_HALF = 9, KERB = 4;
const off = (v) => { const m = ((v % ROAD_SPACING) + ROAD_SPACING) % ROAD_SPACING; return Math.min(m, ROAD_SPACING - m); };
let onRoad = 0;
for (const p of parks) {
  // Check the whole footprint, not just the centre.
  for (const dx of [-p.half, 0, p.half]) for (const dz of [-p.half, 0, p.half]) {
    if (off(p.x + dx) <= ROAD_HALF || off(p.z + dz) <= ROAD_HALF) onRoad++;
  }
}
check("no park footprint touches tarmac", onRoad === 0, `${onRoad} overlaps across ${parks.length * 9} sample points`);

console.log("\n[3] no park overlaps a hero tower plot");
const towers = TICKERS.map((t) => layoutFor(t));
let onTower = 0;
for (const p of parks) for (const t of towers) {
  if (Math.abs(t.x - p.x) < 24 && Math.abs(t.z - p.z) < 24) onTower++;
}
check("towers are clear", onTower === 0, `${onTower} collisions`);

console.log("\n[4] no two parks overlap each other");
let overlaps = 0;
for (let i = 0; i < parks.length; i++) for (let j = i + 1; j < parks.length; j++) {
  const a = parks[i], b = parks[j];
  if (Math.abs(a.x - b.x) < a.half + b.half && Math.abs(a.z - b.z) < a.half + b.half) overlaps++;
}
check("parks are disjoint", overlaps === 0, `${overlaps} overlapping pairs`);

console.log("\n[5] parks keep clear of the plaza");
let inPlaza = 0;
for (const p of parks) if (Math.hypot(p.x, p.z) < PLAZA_RADIUS + p.half) inPlaza++;
check("no park intrudes on the plaza", inPlaza === 0, `${inPlaza}`);

console.log("\n[6] containment test agrees with the layout");
check("centre of a park reads as park", parkAt(parks[0].x, parks[0].z)?.id === parks[0].id);
check("just inside the edge is a park", parkAt(parks[0].x + parks[0].half - 0.1, parks[0].z) !== null);
check("just outside the edge is not", parkAt(parks[0].x + parks[0].half + 0.5, parks[0].z) === null);
check("plaza centre is a park", parkAt(0, 0)?.kind === "plaza");
check("just outside the plaza is not", parkAt(PLAZA_RADIUS + 1, 0) === null);
check("far corner of the map is not", parkAt(189, 189) === null || parkAt(189, 189).kind !== "plaza");

console.log("\n[7] determinism");
const again = parkLots();
check("same layout on every call", JSON.stringify(again) === JSON.stringify(lots));

console.log("\n[8] density is sane");
const pct = (parks.length / 244) * 100;
check("parks take a minority of lots", pct > 5 && pct < 30, `${parks.length} parks = ${pct.toFixed(0)}% of 244 buildable lots`);

console.log(`\n${fails === 0 ? "ALL PARK CHECKS PASSED" : fails + " FAILED"}\n`);
process.exit(fails ? 1 : 0);
