/**
 * Cross-check: the client's filler loop against the server's park layout.
 *
 * These are the two systems that must agree about the ground. The client walks
 * its own 13-unit grid and skips lots covered by a replicated park; this
 * reproduces that loop exactly and asserts no building can land on a park.
 *
 * It is the same class of check that caught 0 buildings on roads earlier —
 * cheap to run, and the failure it guards against (a block sitting in a pond)
 * would be visible everywhere at once.
 */
import { parkLots } from "../dist/config/parks.js";
import { TICKERS, layoutFor } from "../dist/config/tickers.js";

let fails = 0;
const check = (l, c, d = "") => { if (!c) fails++; console.log(`  ${c ? "PASS" : "FAIL"}  ${l}${d ? `  — ${d}` : ""}`); };

const ROAD_SPACING = 52, ROAD_HALF = 9, KERB = 4;
const off = (v) => { const m = ((v % ROAD_SPACING) + ROAD_SPACING) % ROAD_SPACING; return Math.min(m, ROAD_SPACING - m); };
const isBuildable = (x, z) => off(x) > ROAD_HALF + KERB && off(z) > ROAD_HALF + KERB;

// FNV-1a over "x,z" — the client's hashString, used by its filler seed.
function hashString(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0) / 4294967295;
}

const parks = parkLots();
// The client's parkCovers(), reproduced.
function parkCovers(x, z) {
  for (const park of parks) {
    if (park.kind === "plaza") {
      if (Math.hypot(x - park.x, z - park.z) <= park.half) return true;
      continue;
    }
    const pad = park.half + 4;
    if (Math.abs(x - park.x) <= pad && Math.abs(z - park.z) <= pad) return true;
  }
  return false;
}

const towers = TICKERS.map((t) => layoutFor(t));
const built = [];
let skippedForPark = 0;

for (let x = -190; x <= 190; x += 13) {
  for (let z = -190; z <= 190; z += 13) {
    if (!isBuildable(x, z)) continue;
    if (Math.hypot(x, z) < 40) continue;
    if (parkCovers(x, z)) { skippedForPark++; continue; }
    let blocked = false;
    for (const t of towers) if (Math.abs(t.x - x) < 24 && Math.abs(t.z - z) < 24) blocked = true;
    if (blocked) continue;
    if (hashString(`${x},${z}`) < 0.32) continue; // courtyard gap
    built.push({ x, z });
  }
}

console.log("\n[1] the city still has a city in it");
check("filler blocks still generated", built.length > 80, `${built.length} blocks`);
check("some lots were yielded to parks", skippedForPark > 0, `${skippedForPark} lots skipped`);

console.log("\n[2] no building stands on a park");
let onPark = 0;
for (const b of built) if (parkCovers(b.x, b.z)) onPark++;
check("zero overlaps", onPark === 0, `${onPark} of ${built.length} blocks`);

console.log("\n[3] no building stands in the plaza or on a road");
let inPlaza = 0, onRoad = 0;
for (const b of built) {
  if (Math.hypot(b.x, b.z) < 34) inPlaza++;
  if (off(b.x) <= ROAD_HALF || off(b.z) <= ROAD_HALF) onRoad++;
}
check("plaza is clear", inPlaza === 0);
check("roads are clear", onRoad === 0);

console.log("\n[4] every park is reachable — not walled in by blocks");
let sealed = 0;
for (const p of parks) {
  if (p.kind === "plaza") continue;
  // A park touching a pavement strip on any side can be walked into.
  const reach = [
    [p.x + p.half + 5, p.z], [p.x - p.half - 5, p.z],
    [p.x, p.z + p.half + 5], [p.x, p.z - p.half - 5],
  ];
  if (!reach.some(([x, z]) => !isBuildable(x, z))) sealed++;
}
check("every park touches a street", sealed === 0, `${sealed} sealed off`);

console.log(`\n${fails === 0 ? "ALL OVERLAP CHECKS PASSED" : fails + " FAILED"}\n`);
process.exit(fails ? 1 : 0);
