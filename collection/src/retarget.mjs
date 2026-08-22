/**
 * Point already-generated metadata at a new external_url.
 *
 * Rewrites the field in place rather than regenerating the collection. A full
 * regeneration would redraw 3,338 images to produce byte-identical files, and
 * the only thing that needs to change is one string per token.
 *
 * generate.mjs carries the same value, so a future regeneration produces this
 * result too; the two cannot drift apart.
 *
 *   node src/retarget.mjs https://quanto.fun
 */
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(dirname(fileURLToPath(import.meta.url)));
const META = join(HERE, "out", "metadata");

const url = process.argv[2];
if (!url || !/^https?:\/\//.test(url)) {
  console.error("usage: node src/retarget.mjs https://example.com");
  process.exit(1);
}

const files = readdirSync(META).filter((f) => f.endsWith(".json"));
let changed = 0;
const before = new Set();

for (const f of files) {
  const path = join(META, f);
  const meta = JSON.parse(readFileSync(path, "utf8"));
  if (meta.external_url === url) continue;
  before.add(meta.external_url ?? "(none)");
  meta.external_url = url;
  // Two-space JSON, matching what generate.mjs writes.
  writeFileSync(path, JSON.stringify(meta, null, 2) + "\n", "utf8");
  changed++;
}

console.log(`  ${changed} of ${files.length} token(s) retargeted`);
console.log(`  was: ${[...before].join(", ") || "(already correct)"}`);
console.log(`  now: ${url}`);
