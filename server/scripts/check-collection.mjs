/**
 * Can this contract answer the questions the game asks it?
 *
 * The game resolves a player's tier by reading balanceOf, then walking
 * tokenOfOwnerByIndex to find which tokens they hold, then reading tokenURI for
 * each. The middle one is the risk: tokenOfOwnerByIndex belongs to
 * ERC721Enumerable, and the drop contracts marketplaces generate are frequently
 * built on ERC721A, which does not include it.
 *
 * If it is missing, every ownership read reverts, the catch in nft.ts swallows
 * it, and every holder in the world silently resolves to tier none. The
 * collection mints fine, buyers arrive, and nobody can get through the door.
 * That failure is invisible from the outside, which is exactly why this runs
 * before the address is configured rather than after.
 *
 *   node scripts/check-collection.mjs 0x...
 */
const RPC = process.env.RPC_URL ?? "https://rpc.mainnet.chain.robinhood.com";
const ADDRESS = process.argv[2];
if (!ADDRESS) {
  console.error("usage: node scripts/check-collection.mjs <contract address>");
  process.exit(1);
}

let id = 0;
async function rpc(method, params) {
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error.message);
  return json.result;
}

const call = (data) => rpc("eth_call", [{ to: ADDRESS, data }, "latest"]);

/** Decode a returned ABI string. */
function decodeString(hex) {
  if (!hex || hex === "0x") return null;
  const body = hex.slice(2);
  if (body.length < 128) return null;
  const len = parseInt(body.slice(64, 128), 16);
  const chars = body.slice(128, 128 + len * 2);
  return Buffer.from(chars, "hex").toString("utf8");
}

const num = (hex) => (hex && hex !== "0x" ? BigInt(hex) : null);
const pad = (v) => v.toString(16).padStart(64, "0");

console.log(`\n=== ${ADDRESS} ===\n`);

const code = await rpc("eth_getCode", [ADDRESS, "latest"]);
console.log(`  bytecode      ${code === "0x" ? "NONE — nothing deployed here" : `${(code.length - 2) / 2} bytes`}`);
if (code === "0x") process.exit(1);

// ---- identity --------------------------------------------------------------
for (const [label, selector] of [
  ["name()", "0x06fdde03"],
  ["symbol()", "0x95d89b41"],
]) {
  try {
    console.log(`  ${label.padEnd(13)} ${decodeString(await call(selector)) ?? "(no answer)"}`);
  } catch (err) {
    console.log(`  ${label.padEnd(13)} reverted: ${err.message}`);
  }
}

try {
  console.log(`  totalSupply   ${num(await call("0x18160ddd")) ?? "(no answer)"}`);
} catch {
  console.log("  totalSupply   not implemented");
}

// ---- declared interfaces ---------------------------------------------------
console.log("\n  supportsInterface");
const INTERFACES = {
  "ERC721            ": "80ac58cd",
  "ERC721Metadata    ": "5b5e139f",
  "ERC721Enumerable  ": "780e9d63",
};
const declared = {};
for (const [label, iface] of Object.entries(INTERFACES)) {
  try {
    const out = await call("0x01ffc9a7" + iface.padEnd(64, "0"));
    const yes = num(out) === 1n;
    declared[label.trim()] = yes;
    console.log(`    ${label} ${yes ? "yes" : "NO"}`);
  } catch {
    declared[label.trim()] = false;
    console.log(`    ${label} could not be asked`);
  }
}

// ---- the call the game actually depends on ---------------------------------
console.log("\n  the call tier resolution depends on");
let enumerableWorks = false;
try {
  /**
   * Index 0 of the zero address. A conforming enumerable contract reverts with
   * "owner index out of bounds", which is a DIFFERENT failure from the function
   * not existing at all, and both come back as a revert over JSON-RPC. So the
   * declared interface above is the reliable signal and this is corroboration.
   */
  await call("0x2f745c59" + pad(0n) + pad(0n));
  enumerableWorks = true;
  console.log("    tokenOfOwnerByIndex  answered");
} catch (err) {
  const msg = String(err.message);
  const missing = /execution reverted$|invalid opcode|function selector was not recognized/i.test(msg);
  console.log(`    tokenOfOwnerByIndex  ${missing ? "reverted (may simply be out of bounds)" : msg}`);
}

// ---- verdict ---------------------------------------------------------------
console.log("\n  verdict");
if (declared["ERC721Enumerable"]) {
  console.log("    Enumerable is declared. nft.ts works as written.");
  console.log("    Set COLLECTION_ADDRESS and holdings resolve.");
} else {
  console.log("    Enumerable is NOT declared.");
  console.log("    tokenOfOwnerByIndex is how the game finds which tokens a wallet");
  console.log("    holds, so every ownership read will revert and every holder will");
  console.log("    silently resolve to tier none. Do not set COLLECTION_ADDRESS yet;");
  console.log("    the token lookup has to move to an indexer or Transfer logs.");
}
console.log("");
