/**
 * The trait schema is duplicated across two npm packages. This proves the two
 * copies agree.
 *
 * `client/src/pixi/traits.ts` owns colour and rendering; `server/src/config/
 * traits.ts` owns the names it maps NFT metadata onto. They must list the same
 * values in the same order, because the wire format carries **positions**, not
 * names — a reorder on one side silently repaints every minted token.
 *
 * This project has already been broken twice by two sides deriving the same
 * thing independently (roads vs buildings; park lots vs the filler hash). Both
 * looked correct until they were compared. This is that comparison.
 *
 * Run: node scripts/test-traits.mjs
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const clientFile = resolve(here, "../src/pixi/traits.ts");
const serverFile = resolve(here, "../../server/src/config/traits.ts");

let fails = 0;
const check = (label, cond, detail = "") => {
  if (!cond) fails++;
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
};

const clientSrc = readFileSync(clientFile, "utf8");
const serverSrc = readFileSync(serverFile, "utf8");

/** Pull `name: "X"` values per slot out of the client's TRAIT_VALUES table. */
function clientNames() {
  const body = clientSrc.split("export const TRAIT_VALUES")[1];
  if (!body) throw new Error("TRAIT_VALUES not found in the client schema");
  const out = {};
  // Each slot is `slot: [ ... ],` — capture up to the closing bracket.
  const slotRe = /(\w+):\s*\[([\s\S]*?)\n\s{2}\]/g;
  let m;
  while ((m = slotRe.exec(body))) {
    const names = [...m[2].matchAll(/name:\s*"([^"]+)"/g)].map((x) => x[1]);
    if (names.length) out[m[1]] = names;
  }
  return out;
}

/** Pull the plain string arrays out of the server's TRAIT_NAMES table. */
function serverNames() {
  const body = serverSrc.split("export const TRAIT_NAMES")[1];
  if (!body) throw new Error("TRAIT_NAMES not found in the server schema");
  const out = {};
  const slotRe = /(\w+):\s*\[([^\]]*)\]/g;
  let m;
  while ((m = slotRe.exec(body))) {
    const names = [...m[2].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
    if (names.length) out[m[1]] = names;
  }
  return out;
}

const c = clientNames();
const s = serverNames();

console.log("\n[both schemas parsed]");
check("client table found", Object.keys(c).length > 0, `${Object.keys(c).length} slots`);
check("server table found", Object.keys(s).length > 0, `${Object.keys(s).length} slots`);

console.log("\n[the same slots exist on both sides]");
const cSlots = Object.keys(c).sort();
const sSlots = Object.keys(s).sort();
check("slot names match", JSON.stringify(cSlots) === JSON.stringify(sSlots),
  `client=[${cSlots}] server=[${sSlots}]`);

console.log("\n[every slot lists the same values in the same order]");
for (const slot of cSlots) {
  const a = c[slot] ?? [];
  const b = s[slot] ?? [];
  check(
    `${slot} (${a.length} values)`,
    JSON.stringify(a) === JSON.stringify(b),
    JSON.stringify(a) === JSON.stringify(b) ? a.join(", ") : `client=${JSON.stringify(a)} server=${JSON.stringify(b)}`
  );
}

console.log("\n[slot order is identical — the wire format depends on it]");
const cOrder = clientSrc.match(/TRAIT_SLOTS = \[([^\]]+)\]/)?.[1] ?? "";
const sOrder = serverSrc.match(/TRAIT_SLOTS = \[([^\]]+)\]/)?.[1] ?? "";
const norm = (v) => [...v.matchAll(/"([^"]+)"/g)].map((x) => x[1]);
check("TRAIT_SLOTS match", JSON.stringify(norm(cOrder)) === JSON.stringify(norm(sOrder)),
  `client=[${norm(cOrder)}] server=[${norm(sOrder)}]`);

console.log("\n[the collection fits the wire format]");
for (const slot of cSlots) {
  check(`${slot} fits one base36 digit`, (c[slot] ?? []).length <= 36, `${(c[slot] ?? []).length} values`);
}

const combos = cSlots.reduce((n, slot) => n * (c[slot]?.length ?? 1), 1);
console.log(`\n  distinct trait combinations: ${combos.toLocaleString()}`);
check("enough combinations for the supply", combos >= 3400, `${combos} >= 3400 tokens`);

/**
 * The generator is the third copy, and the one with the shortest fuse.
 *
 * It carries its own hex table because it runs outside the client bundle. If
 * those colours drift from the renderer's, a token's portrait and its in-game
 * avatar are different characters — and the portrait is immutable once minted,
 * so the *game* becomes the thing that looks wrong.
 */
const genFile = resolve(here, "../../collection/src/traits.mjs");

if (existsSync(genFile)) {
  console.log("\n[the generator's colours match the renderer's]");
  const genSrc = readFileSync(genFile, "utf8");

  const clientHex = {};
  const clientBody = clientSrc.split("export const TRAIT_VALUES")[1] ?? "";
  const clientSlotRe = /(\w+):\s*\[([\s\S]*?)\n\s{2}\]/g;
  let cm;
  while ((cm = clientSlotRe.exec(clientBody))) {
    const hexes = [...cm[2].matchAll(/hex:\s*"([^"]+)"/g)].map((x) => x[1].toUpperCase());
    if (hexes.length) clientHex[cm[1]] = hexes;
  }

  const genHex = {};
  const genBody = genSrc.split("export const TRAIT_HEX")[1] ?? "";
  const genSlotRe = /(\w+):\s*\[([^\]]*)\]/g;
  let gm;
  while ((gm = genSlotRe.exec(genBody))) {
    const hexes = [...gm[2].matchAll(/"(#[0-9A-Fa-f]{6})"/g)].map((x) => x[1].toUpperCase());
    if (hexes.length) genHex[gm[1]] = hexes;
  }

  check("generator table found", Object.keys(genHex).length > 0, `${Object.keys(genHex).length} slots`);

  for (const slot of Object.keys(clientHex).sort()) {
    const a = clientHex[slot] ?? [];
    const b = genHex[slot] ?? [];
    const same = JSON.stringify(a) === JSON.stringify(b);
    check(
      `${slot} colours identical`,
      same,
      same ? `${a.length} values` : `renderer=${JSON.stringify(a)} generator=${JSON.stringify(b)}`
    );
  }
} else {
  console.log("\n  (collection generator not present — skipping colour parity)");
}

console.log(`\n${fails === 0 ? "TRAIT SCHEMA IN SYNC" : fails + " FAILED"}\n`);
process.exit(fails ? 1 : 0);
