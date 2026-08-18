const { generatePrivateKey, privateKeyToAccount } = require("viem/accounts");
const { existsSync, writeFileSync, appendFileSync, chmodSync } = require("node:fs");
const { resolve } = require("node:path");

/**
 * Generate a deployment key.
 *
 * The private key is written to contracts/.env and NEVER printed. Only the
 * public address is shown, because that is the only part safe to share, paste
 * into a chat, or post anywhere.
 *
 * This is a hot key held in a plaintext file on a dev machine. Treat it as a
 * deployment tool, not a treasury: fund it with roughly what a deploy costs and
 * no more, and use a hardware wallet for anything holding real value.
 *
 *   node scripts/new-key.cjs
 */

const ENV_PATH = resolve(__dirname, "..", ".env");

function main() {
  if (existsSync(ENV_PATH)) {
    const { readFileSync } = require("node:fs");
    const current = readFileSync(ENV_PATH, "utf8");
    if (/^DEPLOYER_KEY=/m.test(current)) {
      // Never silently replace a key that might already hold funds.
      const match = current.match(/^DEPLOYER_ADDRESS=(.*)$/m);
      console.log("A deployer key already exists in contracts/.env — not overwriting.");
      if (match) console.log(`Address: ${match[1].trim()}`);
      console.log("\nDelete DEPLOYER_KEY from that file first if you really want a new one.");
      return;
    }
  }

  const privateKey = generatePrivateKey();
  const account = privateKeyToAccount(privateKey);

  const block = [
    "# Deployment key for Candlestick City contracts.",
    "# NEVER commit this file or paste DEPLOYER_KEY anywhere.",
    "# Fund only what a deploy costs; this is a hot key.",
    `DEPLOYER_KEY=${privateKey}`,
    `DEPLOYER_ADDRESS=${account.address}`,
    "",
  ].join("\n");

  if (existsSync(ENV_PATH)) appendFileSync(ENV_PATH, `\n${block}`);
  else writeFileSync(ENV_PATH, block);

  try {
    chmodSync(ENV_PATH, 0o600);
  } catch {
    // Best effort — Windows ACLs don't map onto POSIX modes.
  }

  console.log("Deployment key written to contracts/.env (gitignored).");
  console.log("");
  console.log("  Fund this address:");
  console.log("");
  console.log(`      ${account.address}`);
  console.log("");
  console.log("  Network: Robinhood Chain testnet (chain 46630) for a test deploy,");
  console.log("           or mainnet (chain 4663) when you are ready.");
  console.log("  Gas token: ETH.");
  console.log("");
  console.log("The private key was NOT printed. It is only in contracts/.env.");
}

main();
