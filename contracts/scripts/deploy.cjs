const hre = require("hardhat");
const { parseEther, stringToHex } = require("viem");

/**
 * Deploy the Quanto contracts and register the real Chainlink feeds.
 *
 *   npx hardhat run scripts/deploy.cjs --network robinhoodTestnet
 *   OWNER_ADDRESS=0x... npx hardhat run scripts/deploy.cjs --network robinhoodMainnet
 *
 * Ownership handover
 * ------------------
 * The deploying key is a hot key in a plaintext .env file. Left as owner it
 * could raise the daily emission cap, authorise arbitrary minters, or re-point
 * a ticker at a fake oracle — which would defeat the cap that is the whole
 * point of enforcing emission on-chain.
 *
 * So the last thing this script does is hand every contract to OWNER_ADDRESS
 * (a hardware wallet or multisig) and verify the handover actually took. On
 * mainnet that variable is REQUIRED and the script refuses to run without it.
 *
 * Note: deploying is not the same as launching a token. These contracts are
 * inert without distribution or liquidity. Making $BLOCK tradeable for real
 * value is a separate decision, gated on an external audit and legal review.
 */

/** Feed proxies verified live on Robinhood Chain mainnet (chain 4663). */
const MAINNET_FEEDS = [
  ["NVDA", "0x379EC4f7C378F34a1B47E4F3cbeBCbAC3E8E9F15", false],
  ["AAPL", "0x6B22A786bAa607d76728168703a39Ea9C99f2cD0", false],
  ["MSFT", "0x45C3C877C15E6BA2EBB19eA114Ea508d14C1Af2E", false],
  ["TSLA", "0x4A1166a659A55625345e9515b32adECea5547C38", false],
  ["GOOGL", "0xF6f373a037c30F0e5010d854385cA89185AE638b", false],
  ["META", "0x7C38C00C30BEe9378381E7B6135d7283356D71b1", false],
  ["AMZN", "0xD5a1508ceD74c084eBf3cBe853e2C968fB2a651C", false],
  ["AMD", "0x943A29E7ae51A4798823ca9eEd2ed533B2A22C72", false],
  ["GME", "0x27C71df6A64fB476468EdF256CF72c038baB5B67", false],
  ["COIN", "0xA3a468A452940B7D6b69991207B508c609a98Ef2", false],
  ["SPY", "0x319724394D3A0e3669269846abE664Cd621f9f6A", false],
  ["ETH", "0x78F3556b67E17Df817D51Ef5a990cDaF09E8d3A9", true],
  ["BTC", "0xa2c5184bF03d373Dc9dE4876eb4Bce595B460251", true],
  ["LINK", "0xe86e3422Aa9B5e8ee9f3E41a63975bC387A8bce9", true],
];

/** Equity feeds legitimately freeze overnight; crypto feeds must not. */
const EQUITY_STALENESS = 26 * 60 * 60;
const CRYPTO_STALENESS = 2 * 60 * 60;

const ZERO = "0x0000000000000000000000000000000000000000";

async function main() {
  const net = hre.network.name;
  const isMainnet = net === "robinhoodMainnet";
  const [wallet] = await hre.viem.getWalletClients();
  const deployer = wallet.account.address;

  const owner = process.env.OWNER_ADDRESS;

  // Fail before spending any gas rather than halfway through.
  if (isMainnet) {
    if (!owner || !/^0x[0-9a-fA-F]{40}$/.test(owner)) {
      throw new Error(
        "OWNER_ADDRESS is required for mainnet.\n\n" +
          "  Set it to a hardware wallet or multisig that will own these contracts.\n" +
          "  Leaving the hot deploy key as owner would let anyone holding that key\n" +
          "  raise the daily emission cap, which is the one protection enforced\n" +
          "  on-chain rather than in game logic.\n\n" +
          "  OWNER_ADDRESS=0x... npx hardhat run scripts/deploy.cjs --network robinhoodMainnet"
      );
    }
    if (owner.toLowerCase() === deployer.toLowerCase()) {
      throw new Error(
        "OWNER_ADDRESS is the deploy key itself, which defeats the handover.\n" +
          "  Use a separate hardware wallet or multisig address."
      );
    }
  }

  const balance = await (await hre.viem.getPublicClient()).getBalance({ address: deployer });
  console.log(`Network   : ${net}`);
  console.log(`Deployer  : ${deployer}`);
  console.log(`Balance   : ${Number(balance) / 1e18} ETH`);
  console.log(`Will own  : ${owner ?? "(deployer — dev only)"}`);
  if (balance === 0n) throw new Error("Deployer has no ETH — fund it before deploying.");
  console.log("");

  /**
   * L2 sequencer uptime feed. Chainlink publishes none for Robinhood Chain, so
   * this stays unset and OracleRouter skips that check. Deliberate, not an
   * oversight — there is nothing to point it at.
   */
  const sequencerFeed = process.env.SEQUENCER_FEED ?? ZERO;
  if (isMainnet && sequencerFeed === ZERO) {
    console.log("note: no sequencer uptime feed exists on this chain — check disabled\n");
  }

  const oracle = await hre.viem.deployContract("OracleRouter", [sequencerFeed]);
  console.log("OracleRouter    ", oracle.address);

  const token = await hre.viem.deployContract("BlockToken", [parseEther("100000")]);
  console.log("BlockToken      ", token.address);

  const deed = await hre.viem.deployContract("FloorDeed", []);
  console.log("FloorDeed       ", deed.address);

  const controller = await hre.viem.deployContract("CityController", [
    token.address,
    deed.address,
    oracle.address,
  ]);
  console.log("CityController  ", controller.address);

  await token.write.setMinter([controller.address, true]);
  await deed.write.setController([controller.address, true]);
  console.log("Wired controller as minter + deed controller");

  // Only mainnet has real feeds; on a local chain there is nothing to point at.
  if (net === "robinhoodMainnet" || net === "robinhoodTestnet") {
    for (const [symbol, address, alwaysOn] of MAINNET_FEEDS) {
      await oracle.write.setFeed([
        stringToHex(symbol, { size: 32 }),
        address,
        alwaysOn ? CRYPTO_STALENESS : EQUITY_STALENESS,
        alwaysOn,
      ]);
      console.log(`  feed ${symbol.padEnd(6)} -> ${address}`);
    }
  }

  const settler = process.env.SETTLER_ADDRESS;
  if (settler) {
    await controller.write.setSettler([settler, true]);
    console.log("Settler set to  ", settler);
  } else {
    console.log("No SETTLER_ADDRESS set — remember to authorise the game server.");
  }

  /**
   * Hand everything over.
   *
   * Done last, after all the owner-only wiring above, because once ownership
   * moves this key can no longer configure anything. Each transfer is read back
   * and verified — a silent failure here would leave the hot key in control
   * while the log claimed otherwise, which is the worst possible outcome.
   */
  if (owner) {
    console.log("\nTransferring ownership...");

    await token.write.transferOwnership([owner]);
    await deed.write.transferOwnership([owner]);
    await controller.write.transferOwnership([owner]);
    await oracle.write.transferOwnership([owner]);

    const finalOwners = {
      BlockToken: await token.read.owner(),
      FloorDeed: await deed.read.owner(),
      CityController: await controller.read.owner(),
      OracleRouter: await oracle.read.owner(),
    };

    let ok = true;
    for (const [name, actual] of Object.entries(finalOwners)) {
      const matches = String(actual).toLowerCase() === owner.toLowerCase();
      if (!matches) ok = false;
      console.log(`  ${matches ? "OK  " : "FAIL"} ${name.padEnd(15)} -> ${actual}`);
    }

    if (!ok) {
      throw new Error(
        "Ownership transfer did not take on every contract.\n" +
          "  The deploy key still controls at least one of them. Transfer the\n" +
          "  remaining ones manually before treating this deployment as safe."
      );
    }
    console.log("\nDeploy key no longer controls any contract.");
  } else {
    console.log("\nWARNING: contracts are still owned by the deploy key.");
    console.log("         Acceptable for local/testnet, never for mainnet.");
  }

  console.log("\n--- record these ---");
  console.log(`ORACLE_ROUTER=${oracle.address}`);
  console.log(`BLOCK_TOKEN=${token.address}`);
  console.log(`FLOOR_DEED=${deed.address}`);
  console.log(`CITY_CONTROLLER=${controller.address}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
