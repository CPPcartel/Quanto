/**
 * Wallets, and the line between identity and holdings.
 *
 * These two are different questions and used to share one column, which
 * produced a bug with the worst possible shape: a holder connected their real
 * wallet, saw their tier, and lost it silently on their *next* login, because
 * the login path rewrote the address with the empty wallet Privy had generated.
 * A single session never showed it.
 *
 * So the assertions here are mostly about the second session, and about the
 * things a database has to enforce now that Privy no longer does:
 *
 *   - a wallet belongs to exactly one account
 *   - connecting a wallet must never move someone's save
 *   - holdings are read from every proved wallet, not just one
 *   - a login must not disturb any of the above
 */
import { openMemoryDb } from "../dist/db/db.js";
import { migrate } from "../dist/db/migrations.js";
import { Store } from "../dist/game/store.js";
import { linkPrivyAccount } from "../dist/game/privy.js";

let fails = 0;
const check = (l, c, d = "") => {
  if (!c) fails++;
  console.log(`  ${c ? "PASS" : "FAIL"}  ${l}${d ? `  — ${d}` : ""}`);
};

const db = await openMemoryDb();
await migrate(db);
const store = new Store(db);

const ALICE = "device-alice";
const BOB = "device-bob";
const HOT = "0x1111111111111111111111111111111111111111";
const COLD = "0x2222222222222222222222222222222222222222";

/** Players are created by the room; these stand in for that. */
async function seed(deviceId, name, block = 500) {
  await db.query(
    `INSERT INTO players (device_id, name, color, block, charge, shards, x, z)
     VALUES ($1,$2,'#4F4DC4',$3,100,0,0,0)
     ON CONFLICT (device_id) DO NOTHING`,
    [deviceId, name, block],
  );
}
await seed(ALICE, "Alice");
await seed(BOB, "Bob");

console.log("\n[1] a wallet attaches to an account");
const first = await store.linkWallet(HOT, ALICE);
check("the link is accepted", first.ok === true, JSON.stringify(first));
check("it comes back on the account", (await store.walletsFor(ALICE)).includes(HOT));

console.log("\n[2] a second wallet attaches alongside the first");
await store.linkWallet(COLD, ALICE);
const both = await store.walletsFor(ALICE);
check("both wallets are held", both.length === 2, both.join(", "));
/**
 * The reason multi-wallet exists at all: people keep tokens in a cold wallet and
 * play from a hot one. Reading only the first would refuse a genuine holder.
 */
check("order is stable (link order)", both[0] === HOT && both[1] === COLD, both.join(", "));

console.log("\n[3] one wallet, one account");
const stolen = await store.linkWallet(HOT, BOB);
check("a wallet already on another account is refused", stolen.ok === false, JSON.stringify(stolen));
check(
  "the refusal says why",
  stolen.ok === false && /already connected/i.test(stolen.reason),
  stolen.ok === false ? stolen.reason : "",
);
check("it did not move", (await store.walletsFor(BOB)).length === 0);
check("the original account kept it", (await store.walletsFor(ALICE)).includes(HOT));

console.log("\n[4] re-linking your own wallet is not an error");
const again = await store.linkWallet(HOT, ALICE);
check("idempotent", again.ok === true, JSON.stringify(again));
check("not duplicated", (await store.walletsFor(ALICE)).length === 2);

console.log("\n[5] connecting a wallet does not move anyone's save");
/**
 * The old behaviour: linking a wallet adopted whichever save that wallet had
 * played on, because the wallet was the identity. With accounts that becomes a
 * second identity system, and someone else's balance lands on your account.
 */
await seed("device-carol", "Carol", 9999);
const CAROL_WALLET = "0x3333333333333333333333333333333333333333";
await store.linkWallet(CAROL_WALLET, "device-carol");
const beforeBob = await store.loadPlayer(BOB);
await store.linkWallet("0x4444444444444444444444444444444444444444", BOB);
const afterBob = await store.loadPlayer(BOB);
check("balance untouched by linking", beforeBob.block === afterBob.block, `${beforeBob.block} -> ${afterBob.block}`);
check("Bob did not inherit Carol's 9999", afterBob.block !== 9999, String(afterBob.block));

console.log("\n[6] a login does not disturb linked wallets");
/**
 * The regression this file exists for. linkPrivyAccount used to write
 * `wallet = embeddedWallet ?? wallets[0]` on every login, so the address a
 * holder had proved was replaced by an empty generated one and their tier
 * disappeared on the second session.
 */
const identity = {
  did: "did:privy:alice",
  email: "alice@example.com",
  embeddedWallet: "0x9999999999999999999999999999999999999999",
  wallets: ["0x9999999999999999999999999999999999999999"],
  loginMethod: "email",
};
await linkPrivyAccount(db, identity, ALICE);
const afterLogin = await store.walletsFor(ALICE);
check("proved wallets survive a login", afterLogin.includes(HOT) && afterLogin.includes(COLD), afterLogin.join(", "));
check(
  "the embedded wallet was NOT adopted as a holdings wallet",
  !afterLogin.includes(identity.embeddedWallet),
  afterLogin.join(", "),
);

// Twice, because the original bug only appeared on the second login.
await linkPrivyAccount(db, identity, ALICE);
const afterSecond = await store.walletsFor(ALICE);
check("still intact after a second login", afterSecond.length === 2, afterSecond.join(", "));

const row = await db.query("SELECT wallet, embedded_wallet FROM players WHERE device_id = $1", [ALICE]);
check("players.wallet still points at the proved wallet", row[0].wallet === HOT, String(row[0].wallet));
check("the embedded wallet is recorded separately", row[0].embedded_wallet === identity.embeddedWallet);

console.log("\n[7] holdings come from wallets, not from the account row");
const { NftService } = await import("../dist/game/nft.js");
const nft = new NftService(db);
/**
 * COLLECTION_ADDRESS is unset in tests, so the service is disabled and every
 * read is NO_HOLDING. That is the assertion: a disabled collection must resolve
 * to "holds nothing" rather than throwing into the join path.
 */
const none = await nft.holdingsFor([HOT, COLD]);
check("a disabled collection yields no tier", none.tier === "none", none.tier);
check("an empty wallet list is safe", (await nft.holdingsFor([])).tier === "none");

console.log(fails === 0 ? "\nALL WALLET CHECKS PASSED\n" : `\n${fails} FAILED\n`);
process.exit(fails === 0 ? 0 : 1);
