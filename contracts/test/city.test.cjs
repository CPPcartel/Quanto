const { expect } = require("chai");
const hre = require("hardhat");
const { parseEther, stringToHex } = require("viem");

/** bytes32 ticker symbol, matching how the server keys feeds. */
const sym = (s) => stringToHex(s, { size: 32 });

const NVDA = sym("NVDA");
const ETH = sym("ETH");
const DAY = 24 * 60 * 60;

async function deployCity() {
  const [owner, alice, bob, settler] = await hre.viem.getWalletClients();

  // NVDA at $218.00, ETH at $1891.04 — the real prices read from mainnet.
  const nvdaFeed = await hre.viem.deployContract("MockAggregator", [21800000000n, 8]);
  const ethFeed = await hre.viem.deployContract("MockAggregator", [189104000000n, 8]);

  const oracle = await hre.viem.deployContract("OracleRouter", [
    "0x0000000000000000000000000000000000000000",
  ]);
  // Equity feeds are 24/5 and legitimately freeze overnight; crypto is 24/7.
  await oracle.write.setFeed([NVDA, nvdaFeed.address, 86400, false]);
  await oracle.write.setFeed([ETH, ethFeed.address, 3600, true]);

  const token = await hre.viem.deployContract("BlockToken", [parseEther("100000")]);
  const deed = await hre.viem.deployContract("FloorDeed", []);
  const controller = await hre.viem.deployContract("CityController", [
    token.address,
    deed.address,
    oracle.address,
  ]);

  await token.write.setMinter([controller.address, true]);
  await token.write.setMinter([owner.account.address, true]);
  await deed.write.setController([controller.address, true]);
  await controller.write.setSettler([settler.account.address, true]);

  return { owner, alice, bob, settler, oracle, token, deed, controller, nvdaFeed, ethFeed };
}

describe("OracleRouter", () => {
  it("reads a live price", async () => {
    const { oracle } = await deployCity();
    const [price, decimals] = await oracle.read.readPrice([NVDA]);
    expect(price).to.equal(21800000000n);
    expect(decimals).to.equal(8);
  });

  it("rejects a price that has gone stale past its bound", async () => {
    const { oracle, ethFeed } = await deployCity();
    // ETH is a 24/7 feed with a 1h bound; 2h without an update is a fault.
    await ethFeed.write.setStale([7200n]);
    await expect(oracle.read.readPrice([ETH])).to.be.rejected;
  });

  it("treats a frozen equity feed as frozen, not failed", async () => {
    const { oracle, nvdaFeed } = await deployCity();
    // 11 hours stale is exactly what a real overnight close looks like, and
    // is well inside the 24h bound — the city must keep running.
    await nvdaFeed.write.setStale([11n * 3600n]);
    const [ok, price, , frozen] = await oracle.read.tryReadPrice([NVDA]);
    expect(ok).to.equal(true);
    expect(price).to.equal(21800000000n);
    expect(frozen).to.equal(false);
  });

  it("flags a 24/7 feed that stops publishing as unusable", async () => {
    const { oracle, ethFeed } = await deployCity();
    await ethFeed.write.setStale([7200n]);
    const [ok, , , frozen] = await oracle.read.tryReadPrice([ETH]);
    expect(ok).to.equal(false);
    expect(frozen).to.equal(true);
  });

  it("rejects a non-positive answer", async () => {
    const { oracle, nvdaFeed } = await deployCity();
    await nvdaFeed.write.setAnswer([0n]);
    await expect(oracle.read.readPrice([NVDA])).to.be.rejected;
  });

  it("refuses to price an unknown ticker", async () => {
    const { oracle } = await deployCity();
    await expect(oracle.read.readPrice([sym("NOPE")])).to.be.rejected;
  });

  it("blocks reads while the L2 sequencer is down", async () => {
    const { oracle } = await deployCity();
    const down = await hre.viem.deployContract("MockSequencerFeed", [1n, 0n]);
    await oracle.write.setSequencerFeed([down.address]);
    await expect(oracle.read.readPrice([NVDA])).to.be.rejected;
  });

  it("blocks reads inside the sequencer grace period", async () => {
    const { oracle } = await deployCity();
    const justBack = await hre.viem.deployContract("MockSequencerFeed", [
      0n,
      BigInt(Math.floor(Date.now() / 1000)),
    ]);
    await oracle.write.setSequencerFeed([justBack.address]);
    await expect(oracle.read.readPrice([NVDA])).to.be.rejected;
  });
});

describe("BlockToken", () => {
  it("enforces the daily emission cap", async () => {
    const { token, owner } = await deployCity();
    await token.write.mint([owner.account.address, parseEther("100000")]);
    expect(await token.read.remainingToday()).to.equal(0n);
    await expect(token.write.mint([owner.account.address, 1n])).to.be.rejected;
  });

  it("resets the cap on the next day", async () => {
    const { token, owner } = await deployCity();
    await token.write.mint([owner.account.address, parseEther("100000")]);

    const client = await hre.viem.getTestClient();
    await client.increaseTime({ seconds: DAY });
    await client.mine({ blocks: 1 });

    expect(await token.read.remainingToday()).to.equal(parseEther("100000"));
  });

  it("refuses minting from a non-minter", async () => {
    const { token, alice } = await deployCity();
    const asAlice = await hre.viem.getContractAt("BlockToken", token.address, {
      client: { wallet: alice },
    });
    await expect(asAlice.write.mint([alice.account.address, 1n])).to.be.rejected;
  });
});

describe("FloorDeed", () => {
  it("encodes symbol and floor into the token id", async () => {
    const { deed } = await deployCity();
    const id = await deed.read.tokenIdFor([NVDA, 7n]);
    expect(await deed.read.floorOf([id])).to.equal(7n);
    expect(await deed.read.symbolOf([id])).to.equal(NVDA);
  });

  it("cannot mint the same floor twice", async () => {
    const { deed, controller, owner } = await deployCity();
    await deed.write.setController([owner.account.address, true]);
    await deed.write.mintFloor([owner.account.address, NVDA, 3n]);
    await expect(deed.write.mintFloor([owner.account.address, NVDA, 3n])).to.be.rejected;
    expect(controller.address).to.be.a("string");
  });

  it("refuses minting from a non-controller", async () => {
    const { deed, alice } = await deployCity();
    const asAlice = await hre.viem.getContractAt("FloorDeed", deed.address, {
      client: { wallet: alice },
    });
    await expect(asAlice.write.mintFloor([alice.account.address, NVDA, 0n])).to.be.rejected;
  });
});

describe("CityController", () => {
  it("prices higher tiers above lower ones", async () => {
    const { controller } = await deployCity();
    const calm = await controller.read.floorPrice([NVDA, 0]);
    const extreme = await controller.read.floorPrice([NVDA, 3]);
    expect(extreme > calm).to.equal(true);
  });

  it("prices an expensive tower above a cheap one", async () => {
    const { controller } = await deployCity();
    const nvda = await controller.read.floorPrice([NVDA, 0]);
    const eth = await controller.read.floorPrice([ETH, 0]);
    expect(eth > nvda).to.equal(true);
  });

  it("rejects an out-of-range tier", async () => {
    const { controller } = await deployCity();
    await expect(controller.read.floorPrice([NVDA, 9])).to.be.rejected;
  });

  it("buys a floor, burning the payment", async () => {
    const { controller, token, deed, owner, alice } = await deployCity();

    await token.write.mint([alice.account.address, parseEther("5000")]);
    const price = await controller.read.floorPrice([NVDA, 1]);
    const supplyBefore = await token.read.totalSupply();

    const tokenAsAlice = await hre.viem.getContractAt("BlockToken", token.address, {
      client: { wallet: alice },
    });
    await tokenAsAlice.write.approve([controller.address, price]);

    const asAlice = await hre.viem.getContractAt("CityController", controller.address, {
      client: { wallet: alice },
    });
    await asAlice.write.buyFloor([NVDA, 1]);

    expect(await deed.read.balanceOf([alice.account.address])).to.equal(1n);
    expect(await deed.read.mintedFloors([NVDA])).to.equal(1n);
    // Floors are a sink: the payment is burned, not pooled.
    expect(await token.read.totalSupply()).to.equal(supplyBefore - price);
    expect(owner.account.address).to.be.a("string");
  });

  it("assigns consecutive floors", async () => {
    const { controller, token, deed, alice } = await deployCity();
    await token.write.mint([alice.account.address, parseEther("50000")]);

    const tokenAsAlice = await hre.viem.getContractAt("BlockToken", token.address, {
      client: { wallet: alice },
    });
    const asAlice = await hre.viem.getContractAt("CityController", controller.address, {
      client: { wallet: alice },
    });

    for (let i = 0; i < 3; i++) {
      const price = await controller.read.floorPrice([NVDA, 0]);
      await tokenAsAlice.write.approve([controller.address, price]);
      await asAlice.write.buyFloor([NVDA, 0]);
    }

    expect(await deed.read.mintedFloors([NVDA])).to.equal(3n);
    expect(await deed.read.exists([NVDA, 2n])).to.equal(true);
  });

  it("settles a wage batch", async () => {
    const { controller, token, settler, alice, bob } = await deployCity();
    const asSettler = await hre.viem.getContractAt("CityController", controller.address, {
      client: { wallet: settler },
    });

    await asSettler.write.settleWages([
      sym("batch-1"),
      [alice.account.address, bob.account.address],
      [parseEther("10"), parseEther("25")],
    ]);

    expect(await token.read.balanceOf([alice.account.address])).to.equal(parseEther("10"));
    expect(await token.read.balanceOf([bob.account.address])).to.equal(parseEther("25"));
  });

  it("cannot replay a settled batch", async () => {
    const { controller, settler, alice } = await deployCity();
    const asSettler = await hre.viem.getContractAt("CityController", controller.address, {
      client: { wallet: settler },
    });

    const batch = sym("batch-1");
    await asSettler.write.settleWages([batch, [alice.account.address], [parseEther("10")]]);
    await expect(
      asSettler.write.settleWages([batch, [alice.account.address], [parseEther("10")]])
    ).to.be.rejected;
  });

  it("refuses settlement from a non-settler", async () => {
    const { controller, alice } = await deployCity();
    const asAlice = await hre.viem.getContractAt("CityController", controller.address, {
      client: { wallet: alice },
    });
    await expect(
      asAlice.write.settleWages([sym("x"), [alice.account.address], [parseEther("1")]])
    ).to.be.rejected;
  });

  it("rejects a mismatched batch", async () => {
    const { controller, settler, alice } = await deployCity();
    const asSettler = await hre.viem.getContractAt("CityController", controller.address, {
      client: { wallet: settler },
    });
    await expect(
      asSettler.write.settleWages([sym("y"), [alice.account.address], []])
    ).to.be.rejected;
  });

  it("cannot settle beyond the token's daily cap", async () => {
    const { controller, settler, alice } = await deployCity();
    const asSettler = await hre.viem.getContractAt("CityController", controller.address, {
      client: { wallet: settler },
    });
    // The cap bounds the blast radius if the settler key is ever compromised.
    await expect(
      asSettler.write.settleWages([sym("huge"), [alice.account.address], [parseEther("999999")]])
    ).to.be.rejected;
  });

  it("cannot buy into a tower whose price is unavailable", async () => {
    const { controller, nvdaFeed } = await deployCity();
    await nvdaFeed.write.setAnswer([0n]);
    await expect(controller.read.floorPrice([NVDA, 0])).to.be.rejected;
  });
});
