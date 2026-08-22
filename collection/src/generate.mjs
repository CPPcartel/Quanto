import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { encodePng, Grid } from "./png.mjs";
import { drawPortrait, mulberry } from "./art.mjs";
import { resolve, TRAIT_SLOTS, TRAIT_NAMES } from "./traits.mjs";
import { TICKERS } from "../../server/dist/config/tickers.js";

/**
 * Generate the Quanto Residents collection.
 *
 *   npm run preview   50 tokens, for eyeballing
 *   npm run build     the full 3,338
 *
 * Everything is derived from one seed, so the collection is reproducible: run
 * it twice and get byte-identical output. That matters more than it sounds —
 * it means the art can be regenerated after a bug fix without reshuffling who
 * owns what, right up until the moment it is minted.
 */

const SUPPLY = { resident: 3000, landlord: 300, penthouse: 38 };
const TOTAL = SUPPLY.resident + SUPPLY.landlord + SUPPLY.penthouse;

/** Change this and you get a completely different collection. Do not, after mint. */
const SEED = 0x0ca11ed;

/** Output resolution. 32x32 logical, scaled 32x for marketplace thumbnails. */
const SCALE = 32;

const COLLECTION = "Quanto Residents";
const DESCRIPTION =
  "A resident of Quanto — a live isometric city on Robinhood Chain where " +
  "every building's height is a real stock price. Your traits render on your character " +
  "in-game. No tier pays $BLOCK; identity, access and cosmetics only.";

const EXTERNAL = "https://quanto.fun";

// ---------------------------------------------------------------------------

const preview = process.argv.includes("--preview");
const count = preview ? 50 : TOTAL;
const outDir = preview ? "preview/out" : "out";

rmSync(outDir, { recursive: true, force: true });
mkdirSync(`${outDir}/images`, { recursive: true });
mkdirSync(`${outDir}/metadata`, { recursive: true });

const rand = mulberry(SEED);

/**
 * Assign tiers across the whole id range, not in blocks.
 *
 * Putting the 38 Penthouses at ids 1-38 would make them trivially snipeable at
 * mint — anyone watching could buy the rare tier by index. Shuffling means the
 * only way to know what you minted is to look at it.
 */
const allTiers = [
  ...Array(SUPPLY.penthouse).fill("penthouse"),
  ...Array(SUPPLY.landlord).fill("landlord"),
  ...Array(SUPPLY.resident).fill("resident"),
];

// Fisher-Yates with the seeded generator, so the shuffle is reproducible.
for (let i = allTiers.length - 1; i > 0; i--) {
  const j = Math.floor(rand() * (i + 1));
  [allTiers[i], allTiers[j]] = [allTiers[j], allTiers[i]];
}

/**
 * Shuffle first, THEN take the preview slice.
 *
 * Slicing before shuffling handed the preview the first 50 of an ordered array
 * — 38 Penthouses and 12 Landlords, not one Resident. A preview that contains
 * none of the common tier is not a preview of this collection.
 */
const tiers = allTiers.slice(0, count);

/**
 * One tower per Penthouse, no repeats.
 *
 * 38 feeds and 38 Penthouses is not a coincidence — it is the collection's
 * scarcity story, and it only holds if the mapping is exactly one to one.
 */
const towers = TICKERS.map((t) => t.symbol);
const towerPool = [...towers];
for (let i = towerPool.length - 1; i > 0; i--) {
  const j = Math.floor(rand() * (i + 1));
  [towerPool[i], towerPool[j]] = [towerPool[j], towerPool[i]];
}

// ---------------------------------------------------------------------------

const seen = new Set();
/** Every token as generated, so the contact sheet shows real output. */
const manifest = [];
const rarity = Object.fromEntries(TRAIT_SLOTS.map((s) => [s, {}]));
const tierCounts = { resident: 0, landlord: 0, penthouse: 0 };
const assignedTowers = [];
const started = Date.now();

for (let id = 1; id <= count; id++) {
  const tier = tiers[id - 1];

  /**
   * Draw a trait combination nobody else has.
   *
   * 45,000 combinations against 3,338 tokens, so collisions are rare and a
   * retry loop is cheap. The cap exists so a schema shrunk in future fails
   * loudly rather than hanging here forever.
   */
  let indices;
  let code;
  let attempts = 0;
  do {
    indices = {};
    for (const slot of TRAIT_SLOTS) {
      indices[slot] = Math.floor(rand() * TRAIT_NAMES[slot].length);
    }
    code = TRAIT_SLOTS.map((s) => indices[s]).join("-");
    attempts++;
  } while (seen.has(code) && attempts < 500);

  if (seen.has(code)) {
    throw new Error(
      `Could not find a unique trait combination for token ${id} after 500 tries.\n` +
        `  The schema allows fewer combinations than the supply requires.`
    );
  }
  seen.add(code);

  const traits = resolve(indices);
  const tower = tier === "penthouse" ? towerPool[tierCounts.penthouse] : null;
  if (tower) assignedTowers.push(tower);
  tierCounts[tier]++;
  if (manifest.length < 100) manifest.push({ id, tier, tower, indices: { ...indices } });

  // ---- image ----
  const grid = drawPortrait(traits, tier, tower, (SEED + id) >>> 0);
  writeFileSync(`${outDir}/images/${id}.png`, encodePng(grid, SCALE));

  // ---- metadata ----
  const attributes = TRAIT_SLOTS.map((slot) => ({
    trait_type: capitalise(slot),
    value: traits.names[slot],
  }));
  attributes.push({ trait_type: "Tier", value: capitalise(tier) });
  if (tower) attributes.push({ trait_type: "Tower", value: tower });

  writeFileSync(
    `${outDir}/metadata/${id}.json`,
    JSON.stringify(
      {
        name: `${COLLECTION} #${id}`,
        description: DESCRIPTION,
        // Replaced with the real IPFS or HTTPS base at upload time. OpenSea
        // Studio rewrites this; it is here so the files are valid standalone.
        image: `${id}.png`,
        external_url: EXTERNAL,
        attributes,
      },
      null,
      2
    )
  );

  for (const slot of TRAIT_SLOTS) {
    const name = traits.names[slot];
    rarity[slot][name] = (rarity[slot][name] ?? 0) + 1;
  }

  if (id % 250 === 0) {
    const rate = id / ((Date.now() - started) / 1000);
    process.stdout.write(`  ${id}/${count}  (${rate.toFixed(0)}/s)\n`);
  }
}

// ---------------------------------------------------------------------------

const report = {
  collection: COLLECTION,
  generatedAt: new Date().toISOString(),
  seed: `0x${SEED.toString(16)}`,
  total: count,
  tiers: tierCounts,
  towers: assignedTowers.sort(),
  uniqueCombinations: seen.size,
  traits: Object.fromEntries(
    TRAIT_SLOTS.map((slot) => [
      slot,
      Object.fromEntries(
        Object.entries(rarity[slot])
          .sort((a, b) => b[1] - a[1])
          .map(([name, n]) => [name, { count: n, percent: +((n / count) * 100).toFixed(2) }])
      ),
    ])
  ),
};
writeFileSync(`${outDir}/rarity.json`, JSON.stringify(report, null, 2));

/**
 * A contact sheet of the first 100 ACTUAL tokens.
 *
 * An earlier version re-rolled its own traits from a different seed, so the
 * sheet showed a hundred portraits that existed nowhere in the collection —
 * useful for judging the art, useless for checking the output.
 */
const cols = 10;
const sheet = new Grid(cols * 32);
manifest.forEach((token, i) => {
  const g = drawPortrait(
    resolve(token.indices),
    token.tier,
    token.tower,
    (SEED + token.id) >>> 0
  );
  const cx = (i % cols) * 32;
  const cy = Math.floor(i / cols) * 32;
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 32; x++) {
      const [r, gg, b] = g.get(x, y);
      const k = ((cy + y) * sheet.size + (cx + x)) * 3;
      sheet.data[k] = r;
      sheet.data[k + 1] = gg;
      sheet.data[k + 2] = b;
    }
  }
});
writeFileSync(`${outDir}/contact-sheet.png`, encodePng(sheet, 4));

const secs = ((Date.now() - started) / 1000).toFixed(1);
console.log(`\n${count} tokens in ${secs}s -> ${outDir}/`);
console.log(`  tiers      ${JSON.stringify(tierCounts)}`);
console.log(`  towers     ${assignedTowers.length} assigned, ${new Set(assignedTowers).size} distinct`);
console.log(`  unique     ${seen.size}/${count} trait combinations`);

function capitalise(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
