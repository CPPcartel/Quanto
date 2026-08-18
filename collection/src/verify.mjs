import { readFileSync, readdirSync, existsSync } from "node:fs";
import { encodeAttributes, TRAIT_NAMES, TRAIT_SLOTS } from "../../server/dist/config/traits.js";
import { TICKERS } from "../../server/dist/config/tickers.js";

/**
 * Verify the generated collection before anything is minted.
 *
 * The whole point is that this runs against the FILES, not the generator — a
 * generator that verifies its own intentions proves nothing. Everything here
 * reads what was actually written to disk and puts it through the same
 * `encodeAttributes` the game server will use.
 *
 * The check that matters most is the round trip: every attribute the metadata
 * declares must survive being read by the server and come back as the same
 * name. A value the server does not recognise silently becomes slot 0, and on
 * an immutable collection that is permanent.
 */

const dir = process.argv[2] ?? "out";
let fails = 0;
const check = (label, cond, detail = "") => {
  if (!cond) fails++;
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
};

if (!existsSync(dir)) {
  console.error(`No output at ${dir}/ — run "npm run build" first.`);
  process.exit(1);
}

const EXPECTED = { resident: 3000, landlord: 300, penthouse: 38 };
const TOTAL = EXPECTED.resident + EXPECTED.landlord + EXPECTED.penthouse;

const images = readdirSync(`${dir}/images`).filter((f) => f.endsWith(".png"));
const metas = readdirSync(`${dir}/metadata`).filter((f) => f.endsWith(".json"));

console.log("\n[1] the set is complete");
check("image count", images.length === TOTAL, `${images.length}/${TOTAL}`);
check("metadata count", metas.length === TOTAL, `${metas.length}/${TOTAL}`);

let missing = 0;
for (let id = 1; id <= TOTAL; id++) {
  if (!existsSync(`${dir}/images/${id}.png`)) missing++;
  if (!existsSync(`${dir}/metadata/${id}.json`)) missing++;
}
check("every id from 1 to N has both files", missing === 0, `${missing} missing`);

// ---------------------------------------------------------------------------

console.log("\n[2] every attribute survives the server's reader");

const tokens = [];
for (let id = 1; id <= TOTAL; id++) {
  tokens.push(JSON.parse(readFileSync(`${dir}/metadata/${id}.json`, "utf8")));
}

let unknownValues = 0;
let roundTripFailures = 0;
const firstBad = [];

for (const token of tokens) {
  const byType = new Map(
    token.attributes.map((a) => [String(a.trait_type).toLowerCase(), String(a.value)])
  );

  // Declared values must exist in the schema.
  for (const slot of TRAIT_SLOTS) {
    const value = byType.get(slot);
    if (!TRAIT_NAMES[slot].includes(value)) {
      unknownValues++;
      if (firstBad.length < 3) firstBad.push(`${token.name}: ${slot}="${value}"`);
    }
  }

  /**
   * The round trip. Encode through the server's own function, decode the
   * indices back to names, and require they match what the file declared.
   */
  const code = encodeAttributes(token.attributes);
  const BASE36 = "0123456789abcdefghijklmnopqrstuvwxyz";
  TRAIT_SLOTS.forEach((slot, i) => {
    const index = BASE36.indexOf(code[i]);
    const decoded = TRAIT_NAMES[slot][index];
    if (decoded !== byType.get(slot)) {
      roundTripFailures++;
      if (firstBad.length < 6) {
        firstBad.push(`${token.name}: ${slot} "${byType.get(slot)}" -> "${decoded}"`);
      }
    }
  });
}

check("no unrecognised trait values", unknownValues === 0, `${unknownValues}`);
check(
  "every token round-trips through encodeAttributes",
  roundTripFailures === 0,
  roundTripFailures ? firstBad.join(" | ") : `${tokens.length} tokens`
);

// ---------------------------------------------------------------------------

console.log("\n[3] the supply plan holds");

const tierOf = (t) =>
  String(t.attributes.find((a) => a.trait_type === "Tier")?.value ?? "").toLowerCase();
const counts = { resident: 0, landlord: 0, penthouse: 0, other: 0 };
for (const t of tokens) {
  const tier = tierOf(t);
  if (tier in counts) counts[tier]++;
  else counts.other++;
}

check("residents", counts.resident === EXPECTED.resident, `${counts.resident}`);
check("landlords", counts.landlord === EXPECTED.landlord, `${counts.landlord}`);
check("penthouses", counts.penthouse === EXPECTED.penthouse, `${counts.penthouse}`);
check("no unknown tier", counts.other === 0, `${counts.other}`);

console.log("\n[4] penthouses map one-to-one onto real towers");

const symbols = new Set(TICKERS.map((t) => t.symbol));
const towers = tokens
  .filter((t) => tierOf(t) === "penthouse")
  .map((t) => String(t.attributes.find((a) => a.trait_type === "Tower")?.value ?? ""));

check("every penthouse names a tower", towers.every(Boolean), `${towers.filter(Boolean).length}/${towers.length}`);
check("all towers are real tickers", towers.every((s) => symbols.has(s)),
  towers.filter((s) => !symbols.has(s)).join(", ") || "all valid");
check("no tower is claimed twice", new Set(towers).size === towers.length,
  `${new Set(towers).size} distinct of ${towers.length}`);
check("every tower is claimed", new Set(towers).size === symbols.size,
  `${new Set(towers).size}/${symbols.size}`);

const nonPenthouseWithTower = tokens.filter(
  (t) => tierOf(t) !== "penthouse" && t.attributes.some((a) => a.trait_type === "Tower")
);
check("only penthouses carry a Tower", nonPenthouseWithTower.length === 0,
  `${nonPenthouseWithTower.length}`);

// ---------------------------------------------------------------------------

console.log("\n[5] no two tokens look the same");

const combos = new Set(
  tokens.map((t) =>
    TRAIT_SLOTS.map((s) =>
      t.attributes.find((a) => a.trait_type.toLowerCase() === s)?.value
    ).join("|")
  )
);
check("all trait combinations unique", combos.size === tokens.length, `${combos.size}/${tokens.length}`);

const names = new Set(tokens.map((t) => t.name));
check("all names unique", names.size === tokens.length, `${names.size}`);

// ---------------------------------------------------------------------------

console.log("\n[6] the images are real PNGs of the right size");

const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
let badPng = 0;
let wrongSize = 0;
let bytes = 0;
const sample = [1, 2, 500, 1500, 3000, TOTAL];

for (const id of sample) {
  const buf = readFileSync(`${dir}/images/${id}.png`);
  bytes += buf.length;
  if (!buf.subarray(0, 8).equals(SIG)) badPng++;
  // IHDR width/height live at bytes 16..24.
  const w = buf.readUInt32BE(16);
  const h = buf.readUInt32BE(20);
  if (w !== 1024 || h !== 1024) wrongSize++;
}
check("PNG signature valid", badPng === 0, `${sample.length} sampled`);
check("1024x1024", wrongSize === 0, `${sample.length} sampled`);

// Full sweep of file sizes — a zero-byte image would be invisible otherwise.
let empty = 0;
let total = 0;
for (const f of images) {
  const size = readFileSync(`${dir}/images/${f}`).length;
  total += size;
  if (size < 512) empty++;
}
check("no truncated images", empty === 0, `${empty}`);
console.log(`\n  collection size: ${(total / 1024 / 1024).toFixed(1)} MB, avg ${Math.round(total / images.length / 1024)} KB/token`);

// ---------------------------------------------------------------------------

console.log("\n[7] rarity is recorded and plausible");

const rarity = JSON.parse(readFileSync(`${dir}/rarity.json`, "utf8"));
check("rarity report present", !!rarity.traits);
check("seed recorded for reproducibility", !!rarity.seed, rarity.seed);
check("report agrees with the files", rarity.total === TOTAL, `${rarity.total}`);

let skewed = 0;
for (const slot of TRAIT_SLOTS) {
  const values = Object.values(rarity.traits[slot] ?? {});
  const pcts = values.map((v) => v.percent);
  const expected = 100 / TRAIT_NAMES[slot].length;
  // Uniform sampling: nothing should be more than half again the even share.
  if (pcts.some((p) => p > expected * 1.5 || p < expected * 0.5)) skewed++;
}
check("no trait is wildly over- or under-represented", skewed === 0, `${skewed} skewed slots`);

console.log(`\n${fails === 0 ? "COLLECTION VERIFIED" : fails + " FAILED"}\n`);
process.exit(fails ? 1 : 0);
