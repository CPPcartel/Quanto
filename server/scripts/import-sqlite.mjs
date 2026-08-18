/**
 * One-shot migration of the old SQLite save into Postgres.
 *
 *   node scripts/import-sqlite.mjs [path/to/city.db]
 *
 * Reads the legacy `city.db` written by the previous `node:sqlite` store and
 * inserts it into whichever database DATABASE_URL points at (or the local
 * PGlite one if unset). Safe to re-run: players are matched on device_id and
 * updated rather than duplicated.
 *
 * Balances arrive as a single opening ledger entry per player, so the audit
 * invariant — sum(ledger) == players.block — holds immediately after import
 * rather than being broken from the start.
 */
import { DatabaseSync } from "node:sqlite";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { openDb, closeDb } from "../dist/db/db.js";
import { migrate } from "../dist/db/migrations.js";

const path = resolve(process.argv[2] ?? "./data/city.db");

if (!existsSync(path)) {
  console.log(`No legacy database at ${path} — nothing to import.`);
  process.exit(0);
}

const sqlite = new DatabaseSync(path);
const db = await openDb();
await migrate(db);

// ---------------------------------------------------------------------------

const legacyPlayers = sqlite.prepare("SELECT * FROM players").all();
console.log(`Found ${legacyPlayers.length} player(s) in ${path}`);

let imported = 0;
let floorsImported = 0;
let skipped = 0;

for (const row of legacyPlayers) {
  const deviceId = String(row.device_id);
  const block = Number(row.block) || 0;
  const charge = Number(row.charge) || 0;
  const shards = Number(row.shards) || 0;
  const wallet = row.wallet ? String(row.wallet) : null;

  let floors = {};
  try {
    floors = JSON.parse(String(row.floors ?? "{}")) ?? {};
  } catch {
    floors = {};
  }

  await db.begin(async (tx) => {
    await tx.query(
      `INSERT INTO players (device_id, wallet, name, color, block, charge, shards, x, z)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (device_id) DO UPDATE SET
         wallet = COALESCE(EXCLUDED.wallet, players.wallet),
         name   = EXCLUDED.name,
         color  = EXCLUDED.color,
         block  = EXCLUDED.block,
         charge = EXCLUDED.charge,
         shards = EXCLUDED.shards`,
      [
        deviceId,
        wallet,
        String(row.name ?? ""),
        String(row.color ?? "#4F4DC4"),
        block,
        charge,
        shards,
        Number(row.x) || 0,
        Number(row.z) || 0,
      ]
    );

    const ids = await tx.query("SELECT id FROM players WHERE device_id = $1", [deviceId]);
    const playerId = Number(ids[0].id);

    for (const [symbol, count] of Object.entries(floors)) {
      const n = Number(count) || 0;
      if (n <= 0) continue;
      await tx.query(
        `INSERT INTO floors (player_id, symbol, count) VALUES ($1,$2,$3)
         ON CONFLICT (player_id, symbol) DO UPDATE SET count = EXCLUDED.count`,
        [playerId, symbol, Math.round(n)]
      );
      floorsImported += Math.round(n);
    }

    // A single opening entry, keyed so a re-run doesn't double-credit.
    await tx.query(
      `INSERT INTO ledger (player_id, kind, amount, balance_after, ref, meta)
       VALUES ($1, 'signup_grant', $2, $2, $3, $4)
       ON CONFLICT (ref) DO NOTHING`,
      [playerId, block, `import:${deviceId}`, JSON.stringify({ importedFrom: "sqlite" })]
    );
  });

  imported++;
}

// ---------------------------------------------------------------------------

let signsImported = 0;
try {
  const legacySigns = sqlite.prepare("SELECT * FROM signs").all();
  for (const s of legacySigns) {
    const ids = await db.query("SELECT id FROM players WHERE device_id = $1", [
      String(s.device_id),
    ]);
    if (!ids[0]) {
      skipped++;
      continue;
    }
    await db.query(
      `INSERT INTO signs (id, player_id, symbol, text, color, floor)
       VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO NOTHING`,
      [
        String(s.id),
        Number(ids[0].id),
        String(s.symbol),
        String(s.text),
        String(s.color),
        Number(s.floor) || 0,
      ]
    );
    signsImported++;
  }
} catch {
  console.log("(no signs table in the legacy database)");
}

console.log(`\nImported ${imported} player(s), ${floorsImported} floor(s), ${signsImported} sign(s).`);
if (skipped) console.log(`Skipped ${skipped} sign(s) with no matching player.`);

// Prove the invariant holds before anyone plays on this data.
const drift = await db.query(`
  SELECT COUNT(*)::int AS n FROM (
    SELECT p.id
    FROM players p LEFT JOIN ledger l ON l.player_id = p.id
    GROUP BY p.id, p.block
    HAVING ABS(p.block - COALESCE(SUM(l.amount), 0)) > 0.01
  ) q
`);
console.log(`Ledger integrity: ${Number(drift[0].n) === 0 ? "OK" : `${drift[0].n} player(s) drifting`}`);

sqlite.close();
await closeDb();
