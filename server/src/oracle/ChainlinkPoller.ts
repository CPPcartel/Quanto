import { createPublicClient, http, defineChain, parseAbi } from "viem";
import { TICKERS, baseHeightFor, type TickerDef } from "../config/tickers.js";

/**
 * Reads live Chainlink price feeds from Robinhood Chain and turns them into
 * the city's physical state.
 *
 * This is read-only: no wallet, no gas, no transactions. Displaying a living
 * city costs nothing onchain.
 */

export const robinhoodChain = defineChain({
  id: 4663,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.mainnet.chain.robinhood.com"] } },
  blockExplorers: {
    default: { name: "Blockscout", url: "https://robinhoodchain.blockscout.com" },
  },
  contracts: {
    // Canonical Multicall3, verified deployed on Robinhood Chain. Lets us read
    // all ~38 feeds in a single RPC round trip instead of 38 separate calls.
    multicall3: { address: "0xcA11bde05977b3631167028862bE2a173976CA11" },
  },
});

const AGGREGATOR_ABI = parseAbi([
  "function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
]);

/** Equity feeds are considered "live" if they updated within this window. */
const EQUITY_FRESH_MS = 20 * 60 * 1000;
/** How many samples of rolling history we keep per ticker for volatility. */
const HISTORY_LEN = 60;

export type SessionPhase = "open" | "closed";

export interface TickerReading {
  symbol: string;
  price: number;
  /** Unix seconds from the feed itself, not our clock. */
  updatedAt: number;
  /** % change vs the reference price captured when this session began. */
  changePct: number;
  /** Annualised-ish realized volatility from our rolling window, 0 when cold. */
  volatility: number;
  /** Final building height in world units. */
  height: number;
  /** True when this feed has gone stale (market closed for equities). */
  frozen: boolean;
}

export interface CitySnapshot {
  readings: Map<string, TickerReading>;
  phase: SessionPhase;
  /** Mean change across all non-frozen tickers — drives weather. */
  marketMood: number;
  /** Highest single-ticker volatility right now — drives storm events. */
  peakVolatility: number;
  peakSymbol: string;
  lastPollOk: boolean;
  lastPollAt: number;
}

interface History {
  prices: number[];
  reference: number;
}

export class ChainlinkPoller {
  private client = createPublicClient({
    chain: robinhoodChain,
    transport: http(undefined, { batch: true, timeout: 20_000, retryCount: 2 }),
  });

  private history = new Map<string, History>();
  private snapshot: CitySnapshot = {
    readings: new Map(),
    phase: "closed",
    marketMood: 0,
    peakVolatility: 0,
    peakSymbol: "",
    lastPollOk: false,
    lastPollAt: 0,
  };

  private timer?: NodeJS.Timeout;

  get current(): CitySnapshot {
    return this.snapshot;
  }

  /**
   * Begin polling.
   *
   * The recurring timer is armed in `finally`, so it exists whether or not the
   * first poll succeeded. Previously the timer was created only after a
   * successful `await this.poll()` — so one bad RPC response at boot meant the
   * oracle never polled again and the city stayed frozen until someone
   * restarted the process. The caller logs "serving cold city" and carries on,
   * which was true of the first twenty seconds and then quietly wrong forever.
   *
   * The initial failure is still rethrown, so the caller can report it.
   */
  async start(intervalMs = 20_000) {
    // Guard against a double start leaking the previous timer.
    this.stop();
    try {
      await this.poll();
    } finally {
      this.timer = setInterval(() => {
        this.poll().catch((err) => console.error("[oracle] poll failed:", err?.message ?? err));
      }, intervalMs);
    }
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  private async poll() {
    let results: Array<{ status: string; result?: unknown }>;
    try {
      results = await this.client.multicall({
        contracts: TICKERS.map((t) => ({
          address: t.feed,
          abi: AGGREGATOR_ABI,
          functionName: "latestRoundData" as const,
        })),
        allowFailure: true,
      });
    } catch (err) {
      // Keep serving the last good snapshot; never let RPC trouble stall the game.
      this.snapshot = { ...this.snapshot, lastPollOk: false, lastPollAt: Date.now() };
      throw err;
    }

    const readings = new Map<string, TickerReading>();
    const now = Date.now();

    TICKERS.forEach((ticker, i) => {
      const entry = results[i];
      if (!entry || entry.status !== "success" || !entry.result) {
        const prev = this.snapshot.readings.get(ticker.symbol);
        if (prev) readings.set(ticker.symbol, prev);
        return;
      }

      const tuple = entry.result as readonly [bigint, bigint, bigint, bigint, bigint];
      const price = Number(tuple[1]) / 1e8;
      const updatedAt = Number(tuple[3]);
      if (!isFinite(price) || price <= 0) return;

      readings.set(ticker.symbol, this.buildReading(ticker, price, updatedAt, now));
    });

    this.snapshot = this.summarise(readings, now);
  }

  private buildReading(
    ticker: TickerDef,
    price: number,
    updatedAt: number,
    now: number
  ): TickerReading {
    let hist = this.history.get(ticker.symbol);
    if (!hist) {
      hist = { prices: [], reference: price };
      this.history.set(ticker.symbol, hist);
    }
    hist.prices.push(price);
    if (hist.prices.length > HISTORY_LEN) hist.prices.shift();

    const ageMs = now - updatedAt * 1000;
    const frozen = !ticker.alwaysOn && ageMs > EQUITY_FRESH_MS;

    const changePct = hist.reference > 0 ? ((price - hist.reference) / hist.reference) * 100 : 0;
    const volatility = realizedVolatility(hist.prices);

    // Live movement pushes the roof up or down around the log-scale base.
    const base = baseHeightFor(price);
    const height = clamp(base * (1 + changePct / 100) + volatility * 40, 8, 140);

    return { symbol: ticker.symbol, price, updatedAt, changePct, volatility, height, frozen };
  }

  private summarise(readings: Map<string, TickerReading>, now: number): CitySnapshot {
    const equities = TICKERS.filter((t) => !t.alwaysOn)
      .map((t) => readings.get(t.symbol))
      .filter((r): r is TickerReading => Boolean(r));

    // Session detection straight from feed behaviour: if the equity feeds have
    // gone stale, the underlying market is closed. Cross-checked with the ET
    // trading calendar so a quiet tape doesn't get mistaken for a closed one.
    const anyEquityFresh = equities.some((r) => !r.frozen);
    const phase: SessionPhase = anyEquityFresh && isMarketHoursET(new Date(now)) ? "open" : "closed";

    const live = [...readings.values()].filter((r) => !r.frozen);
    const marketMood = live.length
      ? live.reduce((sum, r) => sum + r.changePct, 0) / live.length
      : 0;

    let peakVolatility = 0;
    let peakSymbol = "";
    readings.forEach((r) => {
      if (!r.frozen && r.volatility > peakVolatility) {
        peakVolatility = r.volatility;
        peakSymbol = r.symbol;
      }
    });

    return {
      readings,
      phase,
      marketMood,
      peakVolatility,
      peakSymbol,
      lastPollOk: true,
      lastPollAt: now,
    };
  }
}

/** Standard deviation of log returns across the rolling window. */
function realizedVolatility(prices: number[]): number {
  if (prices.length < 3) return 0;
  const returns: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    if (prices[i - 1] > 0) returns.push(Math.log(prices[i] / prices[i - 1]));
  }
  if (returns.length < 2) return 0;
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((acc, r) => acc + (r - mean) ** 2, 0) / (returns.length - 1);
  return Math.sqrt(variance);
}

/**
 * US equity regular session: Mon-Fri, 09:30-16:00 America/New_York.
 * Uses Intl so DST is handled without pulling in a date library.
 */
export function isMarketHoursET(date: Date): boolean {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const weekday = get("weekday");
  if (weekday === "Sat" || weekday === "Sun") return false;

  const minutes = Number(get("hour")) * 60 + Number(get("minute"));
  return minutes >= 9 * 60 + 30 && minutes < 16 * 60;
}

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}
