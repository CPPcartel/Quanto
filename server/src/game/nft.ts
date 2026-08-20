import { createPublicClient, http, defineChain, parseAbi, getAddress } from "viem";
import type { Db } from "../db/db.js";
import { encodeAttributes, DEFAULT_TRAIT_CODE, type MetadataAttribute } from "../config/traits.js";

/**
 * Quanto Residents — the NFT collection, read from Robinhood Chain.
 *
 * The collection contract is deployed by OpenSea Studio, so we do not own it and
 * cannot add hooks to it. Everything here therefore works from a plain ERC-721
 * read, which is also why every tier in the design is expressible as "how many
 * of these does this wallet hold, and which ones".
 *
 * ---------------------------------------------------------------------------
 * Two questions, two very different answers
 *
 * **Who owns what** is on-chain and authoritative. It changes whenever somebody
 * trades, so it is read live and cached briefly.
 *
 * **What a token is** — its tier and traits — lives in metadata, which is
 * immutable once the collection is revealed. Fetching that on every check would
 * put an HTTP round trip from a host we do not control into the join path, so it
 * is snapshotted once into our own table and read locally afterwards.
 *
 * Conflating the two is the mistake this file exists to avoid: cache ownership
 * for too long and a seller keeps their perks; re-fetch metadata too often and a
 * slow gateway becomes a login outage.
 */

const robinhoodChain = defineChain({
  id: 4663,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.mainnet.chain.robinhood.com"] } },
  blockExplorers: {
    default: { name: "Blockscout", url: "https://robinhoodchain.blockscout.com" },
  },
});

const ERC721_ABI = parseAbi([
  "function balanceOf(address owner) view returns (uint256)",
  "function tokenOfOwnerByIndex(address owner, uint256 index) view returns (uint256)",
  "function tokenURI(uint256 tokenId) view returns (string)",
  "function totalSupply() view returns (uint256)",
]);

export type Tier = "none" | "resident" | "landlord" | "penthouse";

/** Ranked, so "best tier wins" is a comparison rather than a lookup table. */
const TIER_RANK: Record<Tier, number> = { none: 0, resident: 1, landlord: 2, penthouse: 3 };

export interface Holding {
  tier: Tier;
  /** Six base36 digits; see config/traits.ts. */
  traits: string;
  /** Penthouse only: the ticker whose top floor this token holds. */
  tower: string | null;
  tokenId: string;
}

export const NO_HOLDING: Holding = {
  tier: "none",
  traits: DEFAULT_TRAIT_CODE,
  tower: null,
  tokenId: "",
};

/**
 * How long an ownership answer is trusted.
 *
 * Short enough that selling a token costs the perks promptly, long enough that a
 * reconnect storm does not turn into an RPC storm. Ownership changes on a human
 * timescale; this is not a hot path.
 */
const OWNERSHIP_TTL_MS = 5 * 60 * 1000;

/** Wallets holding more than this are treated as holding the first N. */
const MAX_TOKENS_SCANNED = 20;

interface CacheEntry {
  holding: Holding;
  fetchedAt: number;
}

export class NftService {
  private cache = new Map<string, CacheEntry>();
  private client = createPublicClient({
    chain: robinhoodChain,
    transport: http(process.env.RPC_URL ?? robinhoodChain.rpcUrls.default.http[0]),
  });

  /** Set COLLECTION_ADDRESS to enable. Unset means nobody holds anything. */
  private address = process.env.COLLECTION_ADDRESS ?? "";

  constructor(private db: Db) {}

  get enabled() {
    return this.address !== "";
  }

  /**
   * What this wallet holds, best tier first.
   *
   * Returns NO_HOLDING for anything that goes wrong — an unset collection, an
   * unreachable RPC, a wallet with nothing. A holder briefly seeing themselves as
   * a guest is a bad minute; a player unable to join because a metadata gateway
   * is slow is a bad launch.
   */
  async holdingFor(wallet: string): Promise<Holding> {
    if (!this.enabled || !wallet) return NO_HOLDING;

    let owner: `0x${string}`;
    try {
      owner = getAddress(wallet);
    } catch {
      return NO_HOLDING;
    }

    const cached = this.cache.get(owner);
    if (cached && Date.now() - cached.fetchedAt < OWNERSHIP_TTL_MS) return cached.holding;

    let holding = NO_HOLDING;
    try {
      holding = await this.readChain(owner);
    } catch (err) {
      console.warn("[nft] ownership read failed:", (err as Error)?.message ?? err);
      // Serve a stale answer rather than demoting a holder on a transient RPC
      // blip. Only a clean read replaces it.
      return cached?.holding ?? NO_HOLDING;
    }

    this.cache.set(owner, { holding, fetchedAt: Date.now() });
    return holding;
  }

  private async readChain(owner: `0x${string}`): Promise<Holding> {
    const collection = getAddress(this.address);

    const balance = await this.client.readContract({
      address: collection,
      abi: ERC721_ABI,
      functionName: "balanceOf",
      args: [owner],
    });

    const count = Math.min(Number(balance), MAX_TOKENS_SCANNED);
    if (count <= 0) return NO_HOLDING;

    const ids = await Promise.all(
      Array.from({ length: count }, (_, i) =>
        this.client.readContract({
          address: collection,
          abi: ERC721_ABI,
          functionName: "tokenOfOwnerByIndex",
          args: [owner, BigInt(i)],
        })
      )
    );

    // Best tier wins, and that token is the one whose traits they wear.
    let best = NO_HOLDING;
    for (const id of ids) {
      const token = await this.tokenInfo(id.toString());
      if (TIER_RANK[token.tier] > TIER_RANK[best.tier]) best = token;
    }
    return best;
  }

  /**
   * Tier and traits for one token, from the local snapshot.
   *
   * Metadata is immutable after reveal, so a token is fetched from the gateway
   * at most once ever and stored. `nft_tokens` is the cache; the network is the
   * fallback, not the norm.
   */
  private async tokenInfo(tokenId: string): Promise<Holding> {
    const rows = await this.db.query<{ tier: string; traits: string; tower: string | null }>(
      "SELECT tier, traits, tower FROM nft_tokens WHERE token_id = $1",
      [tokenId]
    );

    if (rows[0]) {
      return {
        tier: normaliseTier(rows[0].tier),
        traits: rows[0].traits || DEFAULT_TRAIT_CODE,
        tower: rows[0].tower,
        tokenId,
      };
    }

    const fetched = await this.fetchMetadata(tokenId);
    await this.db
      .query(
        `INSERT INTO nft_tokens (token_id, tier, traits, tower)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (token_id) DO UPDATE
           SET tier = EXCLUDED.tier, traits = EXCLUDED.traits, tower = EXCLUDED.tower`,
        [tokenId, fetched.tier, fetched.traits, fetched.tower]
      )
      .catch((err) => console.warn("[nft] snapshot write failed:", (err as Error)?.message));

    return fetched;
  }

  private async fetchMetadata(tokenId: string): Promise<Holding> {
    try {
      const uri = await this.client.readContract({
        address: getAddress(this.address),
        abi: ERC721_ABI,
        functionName: "tokenURI",
        args: [BigInt(tokenId)],
      });

      const res = await fetch(resolveUri(uri), { signal: AbortSignal.timeout(8000) });
      if (!res.ok) throw new Error(`metadata ${res.status}`);
      const json = (await res.json()) as { attributes?: MetadataAttribute[] };
      const attributes = json.attributes ?? [];

      return {
        tier: tierFromAttributes(attributes),
        traits: encodeAttributes(attributes),
        tower: towerFromAttributes(attributes),
        tokenId,
      };
    } catch (err) {
      console.warn(`[nft] metadata for #${tokenId} unavailable:`, (err as Error)?.message);
      // A token we own but cannot describe is still a Resident. Not stored, so
      // the next attempt retries rather than freezing the fallback in place.
      return { tier: "resident", traits: DEFAULT_TRAIT_CODE, tower: null, tokenId };
    }
  }

  /**
   * Write the resolved holding onto the player row.
   *
   * Territory resolves control from the database every 30 seconds and cannot
   * reach the chain, so the penthouse has to be cached where SQL can see it.
   * The timestamp is the important half: territory only counts a penthouse
   * verified recently, so a seller who never logs in again stops holding the
   * tower within a day instead of forever.
   */
  async persist(deviceId: string, holding: Holding): Promise<void> {
    await this.db
      .query(
        /**
         * $3 is cast explicitly.
         *
         * Its only other appearances are `IS NULL` and a branch returning bare
         * NULL, which gives Postgres nothing to infer a type from — it rejects
         * the statement with "could not determine data type of parameter $3".
         * This write is deliberately non-fatal, so the failure was invisible
         * until a test asserted the row afterwards.
         */
        `UPDATE players
            SET nft_tier     = $2,
                penthouse    = $3::text,
                penthouse_at = CASE WHEN $3::text IS NULL THEN NULL ELSE now() END
          WHERE device_id = $1`,
        [deviceId, holding.tier, holding.tower]
      )
      .catch((err) => console.warn("[nft] tier persist failed:", (err as Error)?.message));
  }

  /** Drop a wallet's cached answer — used after a fresh wallet link. */
  forget(wallet: string) {
    try {
      this.cache.delete(getAddress(wallet));
    } catch {
      /* not an address; nothing cached under it */
    }
  }

  /** Expire stale entries so the map cannot grow with every wallet ever seen. */
  sweep() {
    const now = Date.now();
    this.cache.forEach((entry, wallet) => {
      if (now - entry.fetchedAt > OWNERSHIP_TTL_MS * 2) this.cache.delete(wallet);
    });
  }
}

/** IPFS URIs are common in OpenSea metadata and are not fetchable as-is. */
function resolveUri(uri: string): string {
  if (uri.startsWith("ipfs://")) return `https://ipfs.io/ipfs/${uri.slice(7)}`;
  return uri;
}

function attr(attributes: MetadataAttribute[], type: string): string {
  const found = attributes.find(
    (a) => String(a?.trait_type ?? "").toLowerCase() === type.toLowerCase()
  );
  return String(found?.value ?? "");
}

function tierFromAttributes(attributes: MetadataAttribute[]): Tier {
  return normaliseTier(attr(attributes, "tier"));
}

/** Anything we hold but cannot classify is a Resident, never a Penthouse. */
function normaliseTier(raw: string): Tier {
  const value = String(raw ?? "").toLowerCase();
  if (value === "penthouse") return "penthouse";
  if (value === "landlord") return "landlord";
  return "resident";
}

function towerFromAttributes(attributes: MetadataAttribute[]): string | null {
  const raw = attr(attributes, "tower").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return raw || null;
}
