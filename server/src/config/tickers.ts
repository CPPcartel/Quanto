/**
 * Ticker + district configuration for Quanto.
 *
 * Every address here is a real Chainlink price-feed proxy deployed on
 * Robinhood Chain mainnet (chain 4663). Verified against Chainlink's
 * reference-data-directory at build time. All feeds are 8 decimals.
 *
 * The server is the single source of truth for this config: clients never
 * see feed addresses, they just render the ticker state broadcast to them.
 */

export type DistrictId = "tech" | "crypto" | "moonshot" | "index";

export interface DistrictDef {
  id: DistrictId;
  name: string;
  /** Center of the district plot in world units. */
  cx: number;
  cz: number;
  /** Buildings per row when laying out the plot. */
  cols: number;
  /** Accent colour used by the client for signage/UI. */
  accent: string;
  blurb: string;
}

export interface TickerDef {
  symbol: string;
  /** Chainlink AggregatorV3 proxy on Robinhood Chain mainnet. */
  feed: `0x${string}`;
  district: DistrictId;
  /** Crypto feeds update 24/7; equity feeds freeze outside market hours. */
  alwaysOn: boolean;
  label: string;
}

export const DISTRICTS: DistrictDef[] = [
  {
    id: "tech",
    name: "Tech Row",
    cx: 90,
    cz: -90,
    cols: 5,
    accent: "#5B8DEF",
    blurb: "Tall, glassy, volatile. The skyline that moves most.",
  },
  {
    id: "crypto",
    name: "Crypto Alley",
    cx: -90,
    cz: -90,
    cols: 4,
    accent: "#E5A85C",
    blurb: "Never sleeps. The only district lit through the weekend.",
  },
  {
    id: "moonshot",
    name: "Moonshot Mile",
    cx: 90,
    cz: 90,
    cols: 4,
    accent: "#DB7264",
    blurb: "Meme stocks, quantum, and rockets. Wildest swings in the city.",
  },
  {
    id: "index",
    name: "Index Plaza",
    cx: -90,
    cz: 90,
    cols: 4,
    accent: "#5FB37E",
    blurb: "Broad funds and metals. Low, stately, dependable.",
  },
];

export const TICKERS: TickerDef[] = [
  // ---- Tech Row : mega-cap technology -------------------------------------
  { symbol: "NVDA", feed: "0x379EC4f7C378F34a1B47E4F3cbeBCbAC3E8E9F15", district: "tech", alwaysOn: false, label: "NVIDIA" },
  { symbol: "AAPL", feed: "0x6B22A786bAa607d76728168703a39Ea9C99f2cD0", district: "tech", alwaysOn: false, label: "Apple" },
  { symbol: "MSFT", feed: "0x45C3C877C15E6BA2EBB19eA114Ea508d14C1Af2E", district: "tech", alwaysOn: false, label: "Microsoft" },
  { symbol: "GOOGL", feed: "0xF6f373a037c30F0e5010d854385cA89185AE638b", district: "tech", alwaysOn: false, label: "Alphabet" },
  { symbol: "META", feed: "0x7C38C00C30BEe9378381E7B6135d7283356D71b1", district: "tech", alwaysOn: false, label: "Meta" },
  { symbol: "AMZN", feed: "0xD5a1508ceD74c084eBf3cBe853e2C968fB2a651C", district: "tech", alwaysOn: false, label: "Amazon" },
  { symbol: "AMD", feed: "0x943A29E7ae51A4798823ca9eEd2ed533B2A22C72", district: "tech", alwaysOn: false, label: "AMD" },
  { symbol: "ORCL", feed: "0x0e6a64a2B58A6693a531E6c555f3A5d042eEA844", district: "tech", alwaysOn: false, label: "Oracle" },
  { symbol: "INTC", feed: "0x3f390C5C24628Ac7C489515402235FeAD71D1913", district: "tech", alwaysOn: false, label: "Intel" },
  { symbol: "MU", feed: "0x425EEFdCf05ed6526C3cE61Af99429A228a6d596", district: "tech", alwaysOn: false, label: "Micron" },
  { symbol: "ASML", feed: "0xB4106147E8cce40b7d46124090d373A71b70f87D", district: "tech", alwaysOn: false, label: "ASML" },
  { symbol: "TSM", feed: "0x874cF94aa8eC88Fd9560094dD065f2fB3E41Fc2F", district: "tech", alwaysOn: false, label: "TSMC" },
  { symbol: "DELL", feed: "0x1C6c8cADBe02E19129c39dDB92281cE4c0bf206b", district: "tech", alwaysOn: false, label: "Dell" },
  { symbol: "SNDK", feed: "0xfb133Fa4B7b385802B693a293606682Df47109A3", district: "tech", alwaysOn: false, label: "SanDisk" },
  { symbol: "BABA", feed: "0x62Cc8F9b5f56a33c9C8A60c8B92779f523c4E984", district: "tech", alwaysOn: false, label: "Alibaba" },

  // ---- Crypto Alley : 24/7 feeds + crypto-proxy equities -------------------
  { symbol: "ETH", feed: "0x78F3556b67E17Df817D51Ef5a990cDaF09E8d3A9", district: "crypto", alwaysOn: true, label: "Ethereum" },
  { symbol: "BTC", feed: "0xa2c5184bF03d373Dc9dE4876eb4Bce595B460251", district: "crypto", alwaysOn: true, label: "Bitcoin" },
  { symbol: "LINK", feed: "0xe86e3422Aa9B5e8ee9f3E41a63975bC387A8bce9", district: "crypto", alwaysOn: true, label: "Chainlink" },
  { symbol: "COIN", feed: "0xA3a468A452940B7D6b69991207B508c609a98Ef2", district: "crypto", alwaysOn: false, label: "Coinbase" },
  { symbol: "MSTR", feed: "0x396118bdFB181e6240E74D243F266B061c0edc3D", district: "crypto", alwaysOn: false, label: "Strategy" },
  { symbol: "CLSK", feed: "0x810c12D3a554Bc47fd39597Fe3b3AAC4941F50eF", district: "crypto", alwaysOn: false, label: "CleanSpark" },
  { symbol: "CRCL", feed: "0x6652eDf64bA3731C4F2D3ce821A0Fb1f1f6b482a", district: "crypto", alwaysOn: false, label: "Circle" },

  // ---- Moonshot Mile : speculative / high beta -----------------------------
  { symbol: "TSLA", feed: "0x4A1166a659A55625345e9515b32adECea5547C38", district: "moonshot", alwaysOn: false, label: "Tesla" },
  { symbol: "GME", feed: "0x27C71df6A64fB476468EdF256CF72c038baB5B67", district: "moonshot", alwaysOn: false, label: "GameStop" },
  { symbol: "PLTR", feed: "0x820ABedFF239034956B7A9d2F0a331f9F075eB4c", district: "moonshot", alwaysOn: false, label: "Palantir" },
  { symbol: "IONQ", feed: "0x22EfeC4919baf55F360E0EDee4AbEB26DE4971eb", district: "moonshot", alwaysOn: false, label: "IonQ" },
  { symbol: "RGTI", feed: "0x2A045cF1C49c61c166C036d2f06FA2D2d984f765", district: "moonshot", alwaysOn: false, label: "Rigetti" },
  { symbol: "RKLB", feed: "0x045477BF65Aef6f4F2386ad0164579e48381CC74", district: "moonshot", alwaysOn: false, label: "Rocket Lab" },
  { symbol: "NBIS", feed: "0xE1D87B116Ba0fe898998f1D140339D1fA1E09705", district: "moonshot", alwaysOn: false, label: "Nebius" },
  { symbol: "CRWV", feed: "0xe1b3aABCAFAd1c94708dc1367dcfF8Aa4407487C", district: "moonshot", alwaysOn: false, label: "CoreWeave" },
  { symbol: "SPCX", feed: "0xB265810950ba6c5C0Ff821c9963014a56fD8Bffb", district: "moonshot", alwaysOn: false, label: "SPCX" },
  { symbol: "USAR", feed: "0xA994d3684e8400A6c8078226925779FdeE682DD9", district: "moonshot", alwaysOn: false, label: "USA Rare Earth" },

  // ---- Index Plaza : funds, metals, treasuries -----------------------------
  { symbol: "SPY", feed: "0x319724394D3A0e3669269846abE664Cd621f9f6A", district: "index", alwaysOn: false, label: "S&P 500 ETF" },
  { symbol: "QQQ", feed: "0x80901d846d5D7B030F26B480776EE3b29374C2ae", district: "index", alwaysOn: false, label: "Nasdaq 100 ETF" },
  { symbol: "SGOV", feed: "0xa0DF4ee0fFf975306345875E3548Fcc519577A11", district: "index", alwaysOn: false, label: "0-3mo Treasury" },
  { symbol: "SLV", feed: "0x209b73908e92Ae021826eD79609845451Ecba2ce", district: "index", alwaysOn: false, label: "Silver Trust" },
  { symbol: "USO", feed: "0x75a9c76Ef439e2C7c2E5a34Ab105EcFe3766431c", district: "index", alwaysOn: false, label: "Oil Fund" },
  { symbol: "EWY", feed: "0xEFdf54610B62A7753Ec30bDc380847c12D32e1D1", district: "index", alwaysOn: false, label: "South Korea ETF" },
];

/** Spacing between building centers, in world units. */
export const PLOT_SPACING = 26;

/**
 * Deterministic city layout. Buildings are laid out in a grid per district,
 * centered on the district's plot center. Computed once at startup so the
 * client and server agree on where every building stands.
 */
export function layoutFor(ticker: TickerDef): { x: number; z: number } {
  const district = DISTRICTS.find((d) => d.id === ticker.district)!;
  const members = TICKERS.filter((t) => t.district === ticker.district);
  const index = members.indexOf(ticker);
  const cols = district.cols;
  const rows = Math.ceil(members.length / cols);

  const col = index % cols;
  const row = Math.floor(index / cols);

  // Center the grid on the district plot center.
  const offsetX = (col - (cols - 1) / 2) * PLOT_SPACING;
  const offsetZ = (row - (rows - 1) / 2) * PLOT_SPACING;

  return { x: district.cx + offsetX, z: district.cz + offsetZ };
}

/**
 * Base building height derived from absolute price on a log scale.
 *
 * Raw price would be unusable as height: BTC (~$100k) would be a thousand
 * times taller than GME (~$25). Log scale compresses that into a readable
 * skyline while still making expensive names genuinely taller. Live price
 * *movement* is applied on top of this by the poller.
 */
export function baseHeightFor(price: number): number {
  if (!isFinite(price) || price <= 0) return 14;
  const tier = Math.log10(price); // $10 -> 1, $1k -> 3, $100k -> 5
  return 12 + Math.max(0, Math.min(5.5, tier)) * 9;
}
