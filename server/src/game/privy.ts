import { PrivyClient } from "@privy-io/server-auth";
import type { Db } from "../db/db.js";

/**
 * Privy account authentication.
 *
 * The client logs in with Privy (email, social, passkey or an external wallet)
 * and receives a short-lived access token. This verifies that token's signature
 * server-side and resolves it to a Privy DID, which becomes the player's
 * durable identity — it survives browsers, devices and wallet changes in a way
 * the previous device id never could.
 *
 * Verification is non-negotiable: a client claiming "I am did:privy:abc" proves
 * nothing. Only a signature check does.
 */

export interface PrivyIdentity {
  did: string;
  email: string | null;
  /** The wallet Privy created for this user, if any. */
  embeddedWallet: string | null;
  /** Every wallet on the account, embedded or externally linked. */
  wallets: string[];
  loginMethod: string | null;
}

interface CacheEntry {
  identity: PrivyIdentity;
  fetchedAt: number;
}

/** Profile lookups hit Privy's API, so they're cached per DID. */
const PROFILE_TTL_MS = 10 * 60 * 1000;

export class PrivyAuth {
  private client: PrivyClient | null = null;
  private cache = new Map<string, CacheEntry>();

  constructor(
    appId = process.env.PRIVY_APP_ID,
    appSecret = process.env.PRIVY_APP_SECRET
  ) {
    if (appId && appSecret) {
      this.client = new PrivyClient(appId, appSecret);
      console.log("[privy] account login enabled");
    } else {
      // Not a failure: the game is fully playable as a guest, and local
      // development shouldn't require Privy credentials.
      console.log("[privy] PRIVY_APP_ID / PRIVY_APP_SECRET unset — guest play only");
    }
  }

  get enabled() {
    return this.client !== null;
  }

  /**
   * Verify an access token and resolve the account behind it.
   * Returns null for anything invalid, expired, or unverifiable.
   */
  async verify(token: string): Promise<PrivyIdentity | null> {
    if (!this.client || !token || typeof token !== "string") return null;

    let did: string;
    try {
      const claims = await this.client.verifyAuthToken(token);
      did = claims.userId;
    } catch {
      // Bad signature, expired, or wrong app — all equally unauthenticated.
      return null;
    }

    const cached = this.cache.get(did);
    if (cached && Date.now() - cached.fetchedAt < PROFILE_TTL_MS) return cached.identity;

    // The token proves who they are; this call fills in the profile details.
    // If it fails we still trust the DID — the signature already verified.
    let identity: PrivyIdentity = {
      did,
      email: null,
      embeddedWallet: null,
      wallets: [],
      loginMethod: null,
    };

    try {
      const user = await this.client.getUser(did);
      identity = extractIdentity(did, user);
    } catch (err) {
      console.warn("[privy] profile lookup failed, using DID only:", (err as Error)?.message);
    }

    this.cache.set(did, { identity, fetchedAt: Date.now() });
    return identity;
  }

  forget(did: string) {
    this.cache.delete(did);
  }
}

/** Pull the useful bits out of Privy's linked-account list. */
function extractIdentity(did: string, user: unknown): PrivyIdentity {
  const accounts = ((user as { linkedAccounts?: unknown[] })?.linkedAccounts ?? []) as Array<
    Record<string, unknown>
  >;

  let email: string | null = null;
  let embeddedWallet: string | null = null;
  let loginMethod: string | null = null;
  const wallets: string[] = [];

  for (const account of accounts) {
    const type = String(account.type ?? "");

    if (type === "email" && typeof account.address === "string") {
      email ??= account.address;
      loginMethod ??= "email";
    }

    if (type === "wallet" && typeof account.address === "string") {
      wallets.push(account.address);
      // walletClientType 'privy' marks the wallet Privy generated for them.
      if (account.walletClientType === "privy") embeddedWallet ??= account.address;
      loginMethod ??= "wallet";
    }

    if (["google_oauth", "twitter_oauth", "discord_oauth", "apple_oauth"].includes(type)) {
      loginMethod ??= type.replace("_oauth", "");
    }
  }

  return { did, email, embeddedWallet, wallets, loginMethod };
}

/**
 * Attach a verified Privy account to a save.
 *
 * Mirrors wallet linking: if the DID has played before, that save wins — it may
 * hold progress from another device. Otherwise the current guest row is adopted
 * so nothing earned before logging in is lost.
 *
 * @returns the device_id of the row that is now canonical for this account.
 */
export async function linkPrivyAccount(
  db: Db,
  identity: PrivyIdentity,
  guestDeviceId: string
): Promise<string> {
  const existing = await db.query<{ device_id: string }>(
    "SELECT device_id FROM players WHERE privy_did = $1",
    [identity.did]
  );

  const canonical = existing[0]?.device_id ?? guestDeviceId;

  /**
   * `wallet` is deliberately absent from this statement.
   *
   * It used to be set to `embeddedWallet ?? wallets[0]`, which ran on every
   * login and overwrote whatever was there. A holder who proved their real
   * wallet by signature kept their tier for one session; the next login replaced
   * that address with the empty wallet Privy had generated for them, and the
   * tier silently vanished. The bug was invisible in a single session and only
   * appeared on the second, which is the worst shape a bug can have.
   *
   * embedded_wallet is still recorded — it is genuinely useful to know Privy made
   * one — but it is a fact about the account, not a claim about holdings.
   */
  await db.query(
    `INSERT INTO players (device_id, privy_did, email, embedded_wallet, login_method, is_guest)
     VALUES ($1,$2,$3,$4,$5,false)
     ON CONFLICT (device_id) DO UPDATE SET
       privy_did       = EXCLUDED.privy_did,
       email           = COALESCE(EXCLUDED.email, players.email),
       embedded_wallet = COALESCE(EXCLUDED.embedded_wallet, players.embedded_wallet),
       login_method    = COALESCE(EXCLUDED.login_method, players.login_method),
       is_guest        = false`,
    [canonical, identity.did, identity.email, identity.embeddedWallet, identity.loginMethod]
  );

  const ids = await db.query<{ id: string | number }>(
    "SELECT id FROM players WHERE device_id = $1",
    [canonical]
  );
  if (ids[0]) {
    await db.query(
      "INSERT INTO logins (player_id, privy_did, method) VALUES ($1,$2,$3)",
      [Number(ids[0].id), identity.did, identity.loginMethod]
    );
  }

  return canonical;
}
