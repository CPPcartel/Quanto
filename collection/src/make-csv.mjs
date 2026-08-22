/**
 * Export the collection as a CSV for a marketplace bulk import.
 *
 * Reads the metadata already generated rather than regenerating it, so the CSV
 * and the JSON can never describe different tokens. If they ever disagree, the
 * JSON is the one the contract points at and this file is wrong.
 *
 *   node src/make-csv.mjs                       # uses the live site
 *   node src/make-csv.mjs https://quanto.fun     # once the domain is yours
 */
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(dirname(fileURLToPath(import.meta.url)));
const META = join(HERE, "out", "metadata");
const OUT = join(HERE, "out", "quanto-residents.csv");

/**
 * Where a token links out to.
 *
 * Worth getting right the first time: this is written into metadata that
 * outlives any redeploy, and a marketplace listing pointing at a dead host is
 * the kind of thing nobody notices until somebody is deciding whether to buy.
 */
const EXTERNAL_URL = process.argv[2] ?? "https://quanto.fun";

/**
 * The trait columns, in the order a reader would want them.
 *
 * Fixed rather than discovered, so every row has the same shape and the two
 * partial traits do not shuffle columns around. Tower is only on the 38
 * penthouses and is blank everywhere else, which is what a marketplace expects
 * for a trait a token does not carry.
 */
const TRAITS = ["Jacket", "Collar", "Hair", "Visor", "Skin", "Accessory", "Tier", "Tower"];

const BASE =
  "A resident of Quanto, a live isometric city on Robinhood Chain where every " +
  "building's height is a real stock price. Your traits render on your character " +
  "in-game.";

/**
 * What this specific token is, beyond the collection blurb.
 *
 * 3,338 identical descriptions tell a buyer nothing about the one they are
 * looking at, and the two scarce tiers are scarce for reasons worth stating.
 * The last sentence is the same on every token on purpose: it is the line that
 * keeps this a game asset rather than an income product, and it should not be
 * possible to find a token whose description omits it.
 */
function describe(tier, tower) {
  const t = String(tier).toLowerCase();
  if (t === "penthouse") {
    return (
      `${BASE} This is the ${tower} penthouse: the top floor of that tower, and one of ` +
      `only 38 in the city. Penthouse holders carry weight in their tower's territory. ` +
      `No tier pays $BLOCK; identity, access and cosmetics only.`
    );
  }
  if (t === "landlord") {
    return (
      `${BASE} A Landlord, one of 300. Founding a crew with this charters it to 50 ` +
      `members instead of 20, and the charter stays with the crew. ` +
      `No tier pays $BLOCK; identity, access and cosmetics only.`
    );
  }
  return `${BASE} No tier pays $BLOCK; identity, access and cosmetics only.`;
}

/** RFC 4180: quote anything containing a comma, quote or newline. */
function cell(value) {
  const s = value === undefined || value === null ? "" : String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const ids = readdirSync(META)
  .filter((f) => f.endsWith(".json"))
  .map((f) => Number(f.replace(".json", "")))
  .sort((a, b) => a - b);

const header = ["token_id", "name", "description", "image", "external_url", ...TRAITS];
const rows = [header.join(",")];

let penthouses = 0;
let landlords = 0;

for (const id of ids) {
  const m = JSON.parse(readFileSync(join(META, `${id}.json`), "utf8"));
  const attrs = Object.fromEntries(
    (m.attributes ?? []).map((a) => [String(a.trait_type), String(a.value)])
  );

  const tier = attrs.Tier ?? "Resident";
  if (tier.toLowerCase() === "penthouse") penthouses++;
  if (tier.toLowerCase() === "landlord") landlords++;

  rows.push(
    [
      id,
      m.name,
      describe(tier, attrs.Tower ?? ""),
      m.image,
      EXTERNAL_URL,
      ...TRAITS.map((t) => attrs[t] ?? ""),
    ]
      .map(cell)
      .join(",")
  );
}

writeFileSync(OUT, rows.join("\n") + "\n", "utf8");

console.log(`${OUT}`);
console.log(`  ${ids.length} tokens, ids ${ids[0]} to ${ids[ids.length - 1]}`);
console.log(`  ${penthouses} penthouses, ${landlords} landlords`);
console.log(`  columns: ${header.join(", ")}`);
console.log(`  external_url: ${EXTERNAL_URL}`);
