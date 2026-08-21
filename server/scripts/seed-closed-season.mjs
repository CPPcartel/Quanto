/**
 * Seed a database with a season that is ready to close.
 *
 * Used to test the prize surface without waiting a week. Creates two players
 * with season earnings and expires the season, so the next server boot rolls it
 * and freezes the standings on the way past.
 *
 *   DATA_DIR=./data/prizetest node scripts/seed-closed-season.mjs
 */
import { openDb, closeDb } from "../dist/db/db.js";
import { migrate, ensureSeason } from "../dist/db/migrations.js";

const db = await openDb();
await migrate(db);
const season = await ensureSeason(db);

async function player(deviceId, name, earned) {
  await db.query(
    `INSERT INTO players (device_id, name, color, block, charge, shards, x, z)
     VALUES ($1,$2,'#4F4DC4',500,100,0,0,0) ON CONFLICT (device_id) DO NOTHING`,
    [deviceId, name],
  );
  const rows = await db.query("SELECT id FROM players WHERE device_id = $1", [deviceId]);
  const id = Number(rows[0].id);
  await db.query(
    `INSERT INTO season_stats (season_id, player_id, shards_collected, block_earned, floors_bought)
     VALUES ($1,$2,0,$3,0)
     ON CONFLICT (season_id, player_id) DO UPDATE SET block_earned = EXCLUDED.block_earned`,
    [season.id, id, earned],
  );
  return id;
}

await player("prize-winner", "Winner", 900);
await player("prize-second", "Runner Up", 400);

// End it, so the next boot rolls the season and freezes these standings.
await db.query("UPDATE seasons SET ends_at = now() - interval '1 minute' WHERE id = $1", [season.id]);

console.log(`seeded season #${season.id} with 2 entrants, expired and ready to close`);
await closeDb();
