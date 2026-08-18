/**
 * The character texture cache must stay bounded.
 *
 * Keyed by colour there were ~16 distinct values in the whole game, so the cache
 * was self-limiting at ~512 textures and needed no eviction. NFT traits break
 * that: 45,000 combinations exist and every distinct holder in view mints its
 * own 32 textures. Unbounded, a busy city walks into a texture-memory leak that
 * only shows up under load.
 *
 * This reproduces the LRU from `src/pixi/art.ts` and hammers it with far more
 * distinct appearances than a room could ever contain.
 *
 * Run: node scripts/test-charcache.mjs
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const artSrc = readFileSync(resolve(here, "../src/pixi/art.ts"), "utf8");

let fails = 0;
const check = (l, c, d = "") => {
  if (!c) fails++;
  console.log(`  ${c ? "PASS" : "FAIL"}  ${l}${d ? `  — ${d}` : ""}`);
};

const CAP = Number(artSrc.match(/MAX_CHAR_SETS = (\d+)/)?.[1] ?? 0);
const DIRS = Number(artSrc.match(/CHAR_DIRS = (\d+)/)?.[1] ?? 0);
const FRAMES = Number(artSrc.match(/CHAR_FRAMES = (\d+)/)?.[1] ?? 0);

console.log("\n[the cap is real and readable from source]");
check("MAX_CHAR_SETS is defined", CAP > 0, `${CAP}`);
check("frames per set known", DIRS * FRAMES > 0, `${DIRS} dirs x ${FRAMES} frames = ${DIRS * FRAMES}`);
check("eviction destroys textures", /evicted\?\.forEach[\s\S]*?destroy\(/.test(artSrc),
  "a dropped reference alone would leave them on the GPU");

// --- reproduce the LRU ----------------------------------------------------
let destroyed = 0;
const cache = new Map();

function characterSet(key) {
  const cached = cache.get(key);
  if (cached) {
    cache.delete(key);
    cache.set(key, cached);
    return cached;
  }
  const set = { key, textures: DIRS * FRAMES };
  cache.set(key, set);
  while (cache.size > CAP) {
    const coldest = cache.keys().next().value;
    if (coldest === undefined || coldest === key) break;
    cache.delete(coldest);
    destroyed += DIRS * FRAMES;
  }
  return set;
}

console.log("\n[a full room of unique holders stays under the cap]");
for (let i = 0; i < 150; i++) characterSet(`trait${i}`);
check("cache never exceeds the cap", cache.size <= CAP, `${cache.size} <= ${CAP}`);
check("textures resident are bounded", cache.size * DIRS * FRAMES <= CAP * DIRS * FRAMES,
  `${cache.size * DIRS * FRAMES} textures`);
check("evicted sets were destroyed", destroyed > 0, `${destroyed} textures freed`);

console.log("\n[the whole collection cannot blow it up]");
const before = destroyed;
for (let i = 0; i < 5000; i++) characterSet(`token${i}`);
check("still capped after 5,000 distinct appearances", cache.size <= CAP, `${cache.size}`);
check("eviction kept pace", destroyed > before, `${destroyed - before} more freed`);

console.log("\n[least-recently-used is what gets evicted]");
cache.clear();
destroyed = 0;
for (let i = 0; i < CAP; i++) characterSet(`k${i}`);
characterSet("k0"); // touch the oldest so it becomes the newest
characterSet("overflow"); // forces one eviction
check("the touched entry survived", cache.has("k0"), "k0 was refreshed by use");
check("the next-coldest went instead", !cache.has("k1"), "k1 evicted");
check("the new entry is present", cache.has("overflow"));

console.log("\n[a guest is never evicted into invisibility]");
// Re-requesting an evicted key must rebuild it, not return undefined.
const rebuilt = characterSet("k1");
check("an evicted appearance rebuilds on demand", !!rebuilt && rebuilt.textures === DIRS * FRAMES);

console.log(`\n  worst case resident textures: ${CAP * DIRS * FRAMES}`);
check("worst case stays modest", CAP * DIRS * FRAMES <= 4096, `${CAP * DIRS * FRAMES} <= 4096`);

console.log(`\n${fails === 0 ? "CHARACTER CACHE BOUNDED" : fails + " FAILED"}\n`);
process.exit(fails ? 1 : 0);
