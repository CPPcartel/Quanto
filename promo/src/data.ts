/**
 * Real prices, read from real Chainlink feeds on Robinhood Chain (chain 4663)
 * on 2026-08-18.
 *
 * Nothing here is invented. `height` is produced by the game's own curve —
 * `baseHeightFor()` in server/src/config/tickers.ts, log-scaled so BTC does not
 * dwarf GME by a factor of a thousand — with live movement applied on top
 * exactly as ChainlinkPoller does it. The skyline in this video therefore has
 * the same proportions as the skyline a player actually sees.
 *
 * Regenerate with: node scripts/pull-prices.mjs
 */

export interface Tower {
  symbol: string;
  label: string;
  district: "tech" | "crypto" | "moonshot" | "index";
  price: number;
  changePct: number;
  /** World units, the game's scale. 8..140. */
  height: number;
}

export const TOWERS: Tower[] = [
  {
    "symbol": "NVDA",
    "label": "NVIDIA",
    "district": "tech",
    "price": 219.53,
    "changePct": 0.87,
    "height": 44.12
  },
  {
    "symbol": "AAPL",
    "label": "Apple",
    "district": "tech",
    "price": 310.6,
    "changePct": -1.29,
    "height": 37.93
  },
  {
    "symbol": "MSFT",
    "label": "Microsoft",
    "district": "tech",
    "price": 481.7,
    "changePct": 2.42,
    "height": 44.09
  },
  {
    "symbol": "GOOGL",
    "label": "Alphabet",
    "district": "tech",
    "price": 342.72,
    "changePct": -1.99,
    "height": 36.71
  },
  {
    "symbol": "META",
    "label": "Meta",
    "district": "tech",
    "price": 552.21,
    "changePct": -2.77,
    "height": 46.2
  },
  {
    "symbol": "AMZN",
    "label": "Amazon",
    "district": "tech",
    "price": 261.58,
    "changePct": -2.06,
    "height": 40.86
  },
  {
    "symbol": "AMD",
    "label": "AMD",
    "district": "tech",
    "price": 476.24,
    "changePct": -0.41,
    "height": 38.22
  },
  {
    "symbol": "ORCL",
    "label": "Oracle",
    "district": "tech",
    "price": 143.96,
    "changePct": 2.81,
    "height": 45.5
  },
  {
    "symbol": "INTC",
    "label": "Intel",
    "district": "tech",
    "price": 95.65,
    "changePct": -0.23,
    "height": 40.25
  },
  {
    "symbol": "MU",
    "label": "Micron",
    "district": "tech",
    "price": 940.3,
    "changePct": -2.37,
    "height": 40.81
  },
  {
    "symbol": "ASML",
    "label": "ASML",
    "district": "tech",
    "price": 1779.59,
    "changePct": 2.07,
    "height": 50.26
  },
  {
    "symbol": "TSM",
    "label": "TSMC",
    "district": "tech",
    "price": 411.99,
    "changePct": -2.15,
    "height": 46.33
  },
  {
    "symbol": "DELL",
    "label": "Dell",
    "district": "tech",
    "price": 460.48,
    "changePct": -0.21,
    "height": 39.16
  },
  {
    "symbol": "SNDK",
    "label": "SanDisk",
    "district": "tech",
    "price": 1628.32,
    "changePct": -0.34,
    "height": 54.53
  },
  {
    "symbol": "BABA",
    "label": "Alibaba",
    "district": "tech",
    "price": 126.53,
    "changePct": 3.45,
    "height": 37.42
  },
  {
    "symbol": "ETH",
    "label": "Ethereum",
    "district": "crypto",
    "price": 1907.12,
    "changePct": -3.96,
    "height": 53.11
  },
  {
    "symbol": "BTC",
    "label": "Bitcoin",
    "district": "crypto",
    "price": 64673.68,
    "changePct": 0.67,
    "height": 63.65
  },
  {
    "symbol": "LINK",
    "label": "Chainlink",
    "district": "crypto",
    "price": 9.48,
    "changePct": -3.83,
    "height": 26.61
  },
  {
    "symbol": "COIN",
    "label": "Coinbase",
    "district": "crypto",
    "price": 147.53,
    "changePct": 2.61,
    "height": 33.28
  },
  {
    "symbol": "MSTR",
    "label": "Strategy",
    "district": "crypto",
    "price": 95.19,
    "changePct": 1.03,
    "height": 42.06
  },
  {
    "symbol": "CLSK",
    "label": "CleanSpark",
    "district": "crypto",
    "price": 11.8,
    "changePct": -0.22,
    "height": 28.9
  },
  {
    "symbol": "CRCL",
    "label": "Circle",
    "district": "crypto",
    "price": 72.34,
    "changePct": 0.79,
    "height": 40.68
  },
  {
    "symbol": "TSLA",
    "label": "Tesla",
    "district": "moonshot",
    "price": 336.69,
    "changePct": -4.06,
    "height": 36.64
  },
  {
    "symbol": "GME",
    "label": "GameStop",
    "district": "moonshot",
    "price": 18.26,
    "changePct": 2.82,
    "height": 24.21
  },
  {
    "symbol": "PLTR",
    "label": "Palantir",
    "district": "moonshot",
    "price": 171.38,
    "changePct": -0.54,
    "height": 32.61
  },
  {
    "symbol": "IONQ",
    "label": "IonQ",
    "district": "moonshot",
    "price": 44.69,
    "changePct": 2.76,
    "height": 40.65
  },
  {
    "symbol": "RGTI",
    "label": "Rigetti",
    "district": "moonshot",
    "price": 17.78,
    "changePct": 1.6,
    "height": 30.38
  },
  {
    "symbol": "RKLB",
    "label": "Rocket Lab",
    "district": "moonshot",
    "price": 78.94,
    "changePct": 3.96,
    "height": 43.46
  },
  {
    "symbol": "NBIS",
    "label": "Nebius",
    "district": "moonshot",
    "price": 254.85,
    "changePct": 3.21,
    "height": 48.59
  },
  {
    "symbol": "CRWV",
    "label": "CoreWeave",
    "district": "moonshot",
    "price": 97.22,
    "changePct": 0.08,
    "height": 34.74
  },
  {
    "symbol": "SPCX",
    "label": "SPCX",
    "district": "moonshot",
    "price": 141.66,
    "changePct": -1.15,
    "height": 33.41
  },
  {
    "symbol": "USAR",
    "label": "USA Rare Earth",
    "district": "moonshot",
    "price": 18.58,
    "changePct": -0.86,
    "height": 27.12
  },
  {
    "symbol": "SPY",
    "label": "S&P 500 ETF",
    "district": "index",
    "price": 769.27,
    "changePct": -1.31,
    "height": 40.92
  },
  {
    "symbol": "QQQ",
    "label": "Nasdaq 100 ETF",
    "district": "index",
    "price": 718.48,
    "changePct": -2.47,
    "height": 37.93
  },
  {
    "symbol": "SGOV",
    "label": "0-3mo Treasury",
    "district": "index",
    "price": 100.86,
    "changePct": 0.17,
    "height": 40.71
  },
  {
    "symbol": "SLV",
    "label": "Silver Trust",
    "district": "index",
    "price": 57.52,
    "changePct": -1.28,
    "height": 34.2
  },
  {
    "symbol": "USO",
    "label": "Oil Fund",
    "district": "index",
    "price": 131.03,
    "changePct": 0.67,
    "height": 37.92
  },
  {
    "symbol": "EWY",
    "label": "South Korea ETF",
    "district": "index",
    "price": 171.97,
    "changePct": 3.95,
    "height": 35.54
  }
];

/** The hero of the opening shot. */
export const HERO = TOWERS.find((t) => t.symbol === "NVDA")!;
