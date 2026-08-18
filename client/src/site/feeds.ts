import { createPublicClient, http, parseAbi } from "viem";
import { useEffect, useState } from "react";
import { robinhoodChain } from "../net/wallet";

/**
 * Live price feeds, read straight from Robinhood Chain in the browser.
 *
 * The landing page must work when the game server is down — it's a marketing
 * page — so it talks to the chain directly rather than through our backend.
 * The public RPC sends `access-control-allow-origin: *`, so this is a plain
 * fetch from the page with no proxy involved.
 *
 * Reading a blockchain costs nothing and needs no wallet. That is the whole
 * reason the hero can be genuinely live rather than a recording.
 */

const AGGREGATOR_ABI = parseAbi([
  "function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
]);

export interface Feed {
  symbol: string;
  name: string;
  address: `0x${string}`;
  /** Crypto trades 24/7; equities freeze when the market closes. */
  alwaysOn: boolean;
  /** Last-known price, so the skyline renders instantly before the first fetch. */
  seed: number;
}

/**
 * Verified proxies on Robinhood Chain mainnet (chain 4663), all 8 decimals.
 * Seed values are real prices captured during development — they exist only so
 * the first paint isn't empty, and are replaced the moment live data lands.
 */
export const FEEDS: Feed[] = [
  { symbol: "NVDA", name: "NVIDIA", address: "0x379EC4f7C378F34a1B47E4F3cbeBCbAC3E8E9F15", alwaysOn: false, seed: 218 },
  { symbol: "AAPL", name: "Apple", address: "0x6B22A786bAa607d76728168703a39Ea9C99f2cD0", alwaysOn: false, seed: 304.92 },
  { symbol: "MSFT", name: "Microsoft", address: "0x45C3C877C15E6BA2EBB19eA114Ea508d14C1Af2E", alwaysOn: false, seed: 499.95 },
  { symbol: "GOOGL", name: "Alphabet", address: "0xF6f373a037c30F0e5010d854385cA89185AE638b", alwaysOn: false, seed: 345.74 },
  { symbol: "AMZN", name: "Amazon", address: "0xD5a1508ceD74c084eBf3cBe853e2C968fB2a651C", alwaysOn: false, seed: 272.28 },
  { symbol: "META", name: "Meta", address: "0x7C38C00C30BEe9378381E7B6135d7283356D71b1", alwaysOn: false, seed: 599.46 },
  { symbol: "TSLA", name: "Tesla", address: "0x4A1166a659A55625345e9515b32adECea5547C38", alwaysOn: false, seed: 332.61 },
  { symbol: "AMD", name: "AMD", address: "0x943A29E7ae51A4798823ca9eEd2ed533B2A22C72", alwaysOn: false, seed: 481.24 },
  { symbol: "ORCL", name: "Oracle", address: "0x0e6a64a2B58A6693a531E6c555f3A5d042eEA844", alwaysOn: false, seed: 147.97 },
  { symbol: "INTC", name: "Intel", address: "0x3f390C5C24628Ac7C489515402235FeAD71D1913", alwaysOn: false, seed: 99.47 },
  { symbol: "MU", name: "Micron", address: "0x425EEFdCf05ed6526C3cE61Af99429A228a6d596", alwaysOn: false, seed: 898.26 },
  { symbol: "ASML", name: "ASML", address: "0xB4106147E8cce40b7d46124090d373A71b70f87D", alwaysOn: false, seed: 1830.86 },
  { symbol: "TSM", name: "TSMC", address: "0x874cF94aa8eC88Fd9560094dD065f2fB3E41Fc2F", alwaysOn: false, seed: 320 },
  { symbol: "COIN", name: "Coinbase", address: "0xA3a468A452940B7D6b69991207B508c609a98Ef2", alwaysOn: false, seed: 290 },
  { symbol: "MSTR", name: "Strategy", address: "0x396118bdFB181e6240E74D243F266B061c0edc3D", alwaysOn: false, seed: 96.92 },
  { symbol: "PLTR", name: "Palantir", address: "0x820ABedFF239034956B7A9d2F0a331f9F075eB4c", alwaysOn: false, seed: 172.91 },
  { symbol: "GME", name: "GameStop", address: "0x27C71df6A64fB476468EdF256CF72c038baB5B67", alwaysOn: false, seed: 24 },
  { symbol: "CRCL", name: "Circle", address: "0x6652eDf64bA3731C4F2D3ce821A0Fb1f1f6b482a", alwaysOn: false, seed: 70.95 },
  { symbol: "SPY", name: "S&P 500", address: "0x319724394D3A0e3669269846abE664Cd621f9f6A", alwaysOn: false, seed: 770.98 },
  { symbol: "QQQ", name: "Nasdaq 100", address: "0x80901d846d5D7B030F26B480776EE3b29374C2ae", alwaysOn: false, seed: 718.92 },
  { symbol: "BTC", name: "Bitcoin", address: "0xa2c5184bF03d373Dc9dE4876eb4Bce595B460251", alwaysOn: true, seed: 63603 },
  { symbol: "ETH", name: "Ethereum", address: "0x78F3556b67E17Df817D51Ef5a990cDaF09E8d3A9", alwaysOn: true, seed: 1891.04 },
  { symbol: "LINK", name: "Chainlink", address: "0xe86e3422Aa9B5e8ee9f3E41a63975bC387A8bce9", alwaysOn: true, seed: 14 },
];

export interface Reading {
  symbol: string;
  name: string;
  price: number;
  updatedAt: number;
  alwaysOn: boolean;
  /** True once the feed has gone quiet — i.e. the underlying market is shut. */
  frozen: boolean;
  /** Change since this page loaded. Small by design; this is a live tape. */
  drift: number;
}

export interface ChainState {
  readings: Reading[];
  blockNumber: number | null;
  /** True once real on-chain data has replaced the seeds. */
  live: boolean;
  marketOpen: boolean;
}

const client = createPublicClient({
  chain: robinhoodChain,
  transport: http(undefined, { batch: true, timeout: 15_000, retryCount: 1 }),
});

const EQUITY_FRESH_MS = 20 * 60 * 1000;

function seedState(): ChainState {
  return {
    readings: FEEDS.map((f) => ({
      symbol: f.symbol,
      name: f.name,
      price: f.seed,
      updatedAt: 0,
      alwaysOn: f.alwaysOn,
      frozen: false,
      drift: 0,
    })),
    blockNumber: null,
    live: false,
    marketOpen: false,
  };
}

/** US equity regular session, in America/New_York, DST handled by Intl. */
export function isMarketOpen(date = new Date()): boolean {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const day = get("weekday");
  if (day === "Sat" || day === "Sun") return false;
  const minutes = Number(get("hour")) * 60 + Number(get("minute"));
  return minutes >= 570 && minutes < 960;
}

export function useChainFeeds(intervalMs = 30_000): ChainState {
  const [state, setState] = useState<ChainState>(seedState);

  useEffect(() => {
    let cancelled = false;
    const firstPrices = new Map<string, number>();

    const poll = async () => {
      try {
        const [results, blockNumber] = await Promise.all([
          client.multicall({
            contracts: FEEDS.map((f) => ({
              address: f.address,
              abi: AGGREGATOR_ABI,
              functionName: "latestRoundData" as const,
            })),
            allowFailure: true,
          }),
          client.getBlockNumber(),
        ]);

        if (cancelled) return;
        const now = Date.now();

        const readings: Reading[] = [];
        FEEDS.forEach((feed, i) => {
          const entry = results[i];
          if (!entry || entry.status !== "success" || !entry.result) return;

          const tuple = entry.result as readonly [bigint, bigint, bigint, bigint, bigint];
          const price = Number(tuple[1]) / 1e8;
          const updatedAt = Number(tuple[3]);
          if (!isFinite(price) || price <= 0) return;

          if (!firstPrices.has(feed.symbol)) firstPrices.set(feed.symbol, price);
          const base = firstPrices.get(feed.symbol) ?? price;

          readings.push({
            symbol: feed.symbol,
            name: feed.name,
            price,
            updatedAt,
            alwaysOn: feed.alwaysOn,
            frozen: !feed.alwaysOn && now - updatedAt * 1000 > EQUITY_FRESH_MS,
            drift: base > 0 ? ((price - base) / base) * 100 : 0,
          });
        });

        if (readings.length === 0) return;

        setState({
          readings,
          blockNumber: Number(blockNumber),
          live: true,
          marketOpen: isMarketOpen(),
        });
      } catch {
        // Keep whatever we have. A marketing page must never render an error.
        if (!cancelled) setState((prev) => ({ ...prev, marketOpen: isMarketOpen() }));
      }
    };

    poll();
    const id = setInterval(poll, intervalMs);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [intervalMs]);

  return state;
}

export function formatPrice(price: number) {
  if (!isFinite(price) || price <= 0) return "—";
  if (price >= 1000) return price.toLocaleString("en-US", { maximumFractionDigits: 0 });
  if (price >= 1) return price.toFixed(2);
  return price.toPrecision(3);
}
