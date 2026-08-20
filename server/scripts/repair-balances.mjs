/**
 * Reconcile any balance that has drifted from its ledger.
 *
 *   npm run repair:balances          # report only
 *   npm run repair:balances -- --fix # write the correction
 *
 * The ledger is append-only and is the source of truth: every entry records
 * what happened and the balance it produced. A `players.block` that disagrees
 * with the sum of its entries is the balance being wrong, never the ledger.
 *
 * Run this ONLY with the server stopped. It writes absolute balances, and a
 * running server would overwrite them from memory on its next flush.
 */
import { openDb, closeDb } from "../dist/db/db.js";

const FIX = process.argv.includes("--fix");
const db = await openDb();

const drift = await db.query(`
  SELECT p.id, p.device_id, p.block::float8 AS block,
         COALESCE(SUM(l.amount),0)::float8 AS ledger
  FROM players p LEFT JOIN ledger l ON l.player_id = p.id
  GROUP BY p.id, p.device_id, p.block
  HAVING ABS(COALESCE(SUM(l.amount),0) - p.block) > 0.0001
  ORDER BY ABS(COALESCE(SUM(l.amount),0) - p.block) DESC`);

if (drift.length === 0) {
  console.log("No drift — every balance matches its ledger.");
} else {
  console.log(`${drift.length} player(s) drifting:\n`);
  for (const r of drift) {
    const d = Number(r.ledger) - Number(r.block);
    console.log(
      `  ${r.device_id}  block ${Number(r.block).toFixed(4)}` +
        `  ledger ${Number(r.ledger).toFixed(4)}  ${d > 0 ? "+" : ""}${d.toFixed(4)}`
    );
  }
  if (FIX) {
    for (const r of drift) {
      await db.query("UPDATE players SET block = $1 WHERE id = $2", [
        Math.round(Number(r.ledger) * 10000) / 10000,
        r.id,
      ]);
    }
    console.log(`\nCorrected ${drift.length} balance(s) to match the ledger.`);
  } else {
    console.log("\nRe-run with --fix to correct them. Server must be stopped.");
  }
}

await closeDb();
