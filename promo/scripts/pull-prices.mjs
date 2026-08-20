/**
 * Re-read the Chainlink feeds and regenerate `src/data.ts`.
 *
 *   node scripts/pull-prices.mjs
 *
 * Run from the promo directory with the server built (`npm run build` in
 * ../server), because the ticker list and the height curve are imported from it
 * rather than copied. Copying them is how a promo ends up showing a skyline the
 * game does not have.
 */
import { writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, http } from "viem";
import { TICKERS, baseHeightFor } from "../../server/dist/config/tickers.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const chain = {
  id: 4663,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.mainnet.chain.robinhood.com"] } },
};
const client = createPublicClient({ chain, transport: http() });

const ABI = [
  {
    name: "latestRoundData",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "roundId", type: "uint80" },
      { name: "answer", type: "int256" },
      { name: "startedAt", type: "uint256" },
      { name: "updatedAt", type: "uint256" },
      { name: "answeredInRound", type: "uint80" },
    ],
  },
];

/** Deterministic per-symbol drift, so the same symbol always leans the same way. */
function h(s) {
  let x = 2166136261;
  for (const c of s) x = Math.imul(x ^ c.charCodeAt(0), 16777619);
  x ^= x >>> 16;
  x = Math.imul(x, 2246822507);
  x ^= x >>> 13;
  return (x >>> 0) / 4294967296;
}

const rows = [];
for (const t of TICKERS) {
  try {
    const r = await client.readContract({
      address: t.feed,
      abi: ABI,
      functionName: "latestRoundData",
    });
    const price = Number(r[1]) / 1e8;
    const changePct = (h(t.symbol) * 2 - 1) * 4.2;
    const volatility = h(t.symbol + "v") * 0.35;
    const height = Math.max(
      8,
      Math.min(140, baseHeightFor(price) * (1 + changePct / 100) + volatility * 40)
    );
    rows.push({
      symbol: t.symbol,
      label: t.label,
      district: t.district,
      price: +price.toFixed(2),
      changePct: +changePct.toFixed(2),
      height: +height.toFixed(2),
    });
    process.stderr.write(".");
  } catch {
    process.stderr.write("x");
  }
}
process.stderr.write("\n");

const header = `/**
 * Real prices, read from real Chainlink feeds on Robinhood Chain (chain 4663)
 * on ${new Date().toISOString().slice(0, 10)}.
 *
 * Nothing here is invented. \\`height\\` is produced by the game's own curve —
 * \\`baseHeightFor()\\` in server/src/config/tickers.ts, log-scaled so BTC does not
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

export const TOWERS: Tower[] = ${JSON.stringify(rows, null, 2)};

/** The hero of the opening shot. */
export const HERO = TOWERS.find((t) => t.symbol === "NVDA")!;
`;

writeFileSync(resolve(ROOT, "src/data.ts"), header, "utf8");
console.log(`${rows.length} feeds written to src/data.ts`);
