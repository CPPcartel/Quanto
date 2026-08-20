/**
 * Rebuild the local development database.
 *
 *   npm run db:reset
 *
 * PGlite is strictly single-process. Two servers opening ./data/pg at once —
 * or a force-kill while it is open — corrupts it, and it then fails to start
 * with an opaque WASM abort.
 *
 * This only ever touches the LOCAL database. With DATABASE_URL set the server
 * uses Supabase and none of this applies, so the script refuses to run there
 * rather than risk being pointed at production by accident.
 */
import { rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

if (process.env.DATABASE_URL) {
  console.error("DATABASE_URL is set — this script only resets the local PGlite database.");
  console.error("Refusing to run so a remote database can never be wiped by mistake.");
  process.exit(1);
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * The same path the server opens.
 *
 * This used to be hardcoded to `data/pg` while the server honoured `DATA_DIR`,
 * so running the script against a throwaway database deleted the *development*
 * one and then failed trying to import into the corrupt copy it was asked to
 * fix — the one script that exists to recover from a force-kill made things
 * worse. Both sides must read the same variable.
 */
const dataDir = process.env.DATA_DIR ?? "./data";
const dir = resolve(root, dataDir, "pg");

console.log(`Removing ${dir}`);
await rm(dir, { recursive: true, force: true });

console.log("Re-importing from the SQLite backup…");
const result = spawnSync(process.execPath, [resolve(root, "scripts", "import-sqlite.mjs")], {
  stdio: "inherit",
  cwd: root,
});
process.exit(result.status ?? 0);
