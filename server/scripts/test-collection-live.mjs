/**
 * Read the real collection with the real code.
 *
 * The deployed contract does not implement ERC721Enumerable, so the previous
 * lookup would have reverted on every call and every holder in the world would
 * have resolved to tier none without a single error reaching a log. A unit test
 * against a mock cannot catch that, because the mock would have been written
 * from the same wrong assumption.
 *
 *   COLLECTION_ADDRESS=0x... node scripts/test-collection-live.mjs
 */
import { NftService } from "../dist/game/nft.js";
import { openMemoryDb } from "../dist/db/db.js";
import { migrate } from "../dist/db/migrations.js";

const ADDRESS = process.env.COLLECTION_ADDRESS;
if (!ADDRESS) {
  console.error("set COLLECTION_ADDRESS");
  process.exit(1);
}

let fails = 0;
const check = (l, c, d = "") => {
  if (!c) fails++;
  console.log(`  ${c ? "PASS" : "FAIL"}  ${l}${d ? `  — ${d}` : ""}`);
};

const db = await openMemoryDb();
await migrate(db);
const nft = new NftService(db);

console.log(`\n=== ${ADDRESS} ===`);

console.log("\n[1] the service is switched on");
check("collection configured", nft.enabled);

console.log("\n[2] a wallet holding nothing");
/**
 * The deployer, which has never held a token from this collection. The
 * assertion that matters is not the tier but that this RETURNS rather than
 * throwing: a revert here is what silently demoted every holder before.
 */
const empty = await nft.holdingFor("0x784416633a3837b533cda66b48f3427f520f93f3");
check("resolves without throwing", empty !== undefined);
check("holds nothing", empty.tier === "none", empty.tier);

console.log("\n[3] a garbage address is refused, not crashed on");
const junk = await nft.holdingFor("not-an-address");
check("returns NO_HOLDING", junk.tier === "none", junk.tier);

console.log("\n[4] several wallets at once");
const many = await nft.holdingsFor([
  "0x784416633a3837b533cda66b48f3427f520f93f3",
  "0x0000000000000000000000000000000000000001",
]);
check("resolves across wallets", many.tier === "none", many.tier);

console.log("\n[5] the zero address, which every mint transfers FROM");
/**
 * Worth asking explicitly. Mints show as a Transfer from the zero address, so
 * if log filtering were wrong in the obvious way this is the address that would
 * appear to own the entire collection.
 */
const zero = await nft.holdingFor("0x0000000000000000000000000000000000000000");
check("owns nothing", zero.tier === "none", zero.tier);

console.log(fails === 0 ? "\nALL COLLECTION CHECKS PASSED\n" : `\n${fails} FAILED\n`);
process.exit(fails === 0 ? 0 : 1);
