require("@nomicfoundation/hardhat-toolbox-viem");
const { existsSync, readFileSync } = require("node:fs");
const { resolve } = require("node:path");

/**
 * Minimal .env loader.
 *
 * Deliberately hand-rolled rather than pulling in dotenv: this needs to read
 * three keys from one file, and the fewer packages that can see a deployment
 * private key, the better.
 */
function loadEnv() {
  const path = resolve(__dirname, ".env");
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    const [, key, value] = match;
    if (!process.env[key]) process.env[key] = value.trim();
  }
}
loadEnv();

/**
 * Foundry is the usual choice for this stack but needs a shell-script
 * bootstrap that isn't available here, so this project uses Hardhat — same
 * contracts, npm-installable on Windows, with a built-in local chain.
 *
 * The config is CommonJS JavaScript rather than TypeScript on purpose:
 * Hardhat 2 loads a TS config through ts-node, which crashes on Node 25.
 * A .cjs config avoids that dependency entirely.
 *
 * @type {import('hardhat/config').HardhatUserConfig}
 */
module.exports = {
  solidity: {
    version: "0.8.28",
    settings: {
      optimizer: { enabled: true, runs: 200 },
      // OpenZeppelin 5.4 emits MCOPY, which needs Cancun. Robinhood Chain runs
      // Arbitrum Nitro (ArbOS 32+), which supports the Cancun opcode set.
      evmVersion: "cancun",
    },
  },
  networks: {
    hardhat: {},
    robinhoodTestnet: {
      url: "https://rpc.testnet.chain.robinhood.com",
      chainId: 46630,
      // Deployment needs a funded key. Never commit one.
      accounts: process.env.DEPLOYER_KEY ? [process.env.DEPLOYER_KEY] : [],
    },
    robinhoodMainnet: {
      url: "https://rpc.mainnet.chain.robinhood.com",
      chainId: 4663,
      accounts: process.env.DEPLOYER_KEY ? [process.env.DEPLOYER_KEY] : [],
    },
  },
};
