import { Client, getStateCallbacks, type Room } from "colyseus.js";
import {
  world,
  markUiDirty,
  resetWorld,
  type RemotePlayer,
  type TickerView,
  type ListingView,
  type CrewView,
  type ThreadView,
  type DirectLine,
} from "./world";
import { accountToken } from "../auth/useAccount";
import { worldToScreen } from "../pixi/iso";

/**
 * Where the game server lives.
 *
 * Set VITE_SERVER_URL at build time to the deployed server, e.g.
 * `wss://quanto-server.up.railway.app`. Note the scheme: a page served
 * over https cannot open an insecure `ws://` socket — browsers block it as
 * mixed content — so production must be `wss://`. The fallback below picks the
 * matching scheme automatically if the variable is missing.
 */
const SERVER_URL =
  import.meta.env.VITE_SERVER_URL ??
  (location.protocol === "https:" ? `wss://${location.host}` : "ws://localhost:2567");
/** How much history each remote keeps for interpolation. */
const BUFFER_LEN = 20;

export let room: Room | null = null;

/**
 * A stable per-browser id so progress survives a reload. This is identity, not
 * authentication — anyone can forge one — and it is replaced by wallet auth
 * when the chain layer lands.
 */
export function deviceId(): string {
  const KEY = "quanto.deviceId";
  /**
   * The key this used to be, before the project was renamed.
   *
   * A device id IS the identity the server trusts, so changing the key would
   * have silently handed every existing player a brand new account and left
   * their floors, balance and crew behind an id nobody looks up any more. The
   * old value is adopted once and then written under the new key.
   */
  const LEGACY_KEY = "candlestick.deviceId";

  let id = localStorage.getItem(KEY);
  if (!id) {
    id = localStorage.getItem(LEGACY_KEY) ?? crypto.randomUUID();
    localStorage.setItem(KEY, id);
  }
  return id;
}

export async function connect() {
  world.conn = "connecting";
  markUiDirty();

  try {
    const client = new Client(SERVER_URL);
    // The token is sent, never the identity itself — the server verifies the
    // signature and decides who this is. A client claiming a DID proves nothing.
    const privyToken = await accountToken();
    const joined = await client.joinOrCreate("city", {
      deviceId: deviceId(),
      ...(privyToken ? { privyToken } : {}),
    });
    room = joined;
    resetWorld();

    world.sessionId = joined.sessionId;
    world.conn = "connected";

    const $ = getStateCallbacks(joined);
    const state = joined.state as any;

    // ---- districts (static, arrive once) ---------------------------------
    $(state).districts.onAdd((d: any) => {
      world.districts.push({
        id: d.id,
        name: d.name,
        accent: d.accent,
        blurb: d.blurb,
        cx: d.cx,
        cz: d.cz,
      });
      markUiDirty();
    });

    // ---- parks (static, arrive once) --------------------------------------
    $(state).parks.onAdd((p: any) => {
      world.parks.push({
        id: p.id,
        x: p.x,
        z: p.z,
        half: p.half,
        kind: p.kind,
        seed: p.seed,
        district: p.district,
      });
      markUiDirty();
    });

    // ---- buildings --------------------------------------------------------
    $(state).tickers.onAdd((t: any, symbol: string) => {
      const view: TickerView = {
        symbol: t.symbol || symbol,
        label: t.label,
        district: t.district,
        price: t.price,
        changePct: t.changePct,
        volatility: t.volatility,
        height: t.height,
        x: t.x,
        z: t.z,
        frozen: t.frozen,
        alwaysOn: t.alwaysOn,
        updatedAt: t.updatedAt,
        // Start at target so the city doesn't grow from zero on every join.
        renderHeight: t.height,
        ownedFloors: t.ownedFloors ?? 0,
        myFloors: 0,
        totalFloors: t.totalFloors ?? 0,
        floorPrice: t.floorPrice ?? 0,
        tier: t.tier ?? "calm",
        landlordName: t.landlordName ?? "",
        landlordHeld: t.landlordHeld ?? 0,
        landlordIsCrew: t.landlordIsCrew ?? false,
        landlordColor: t.landlordColor ?? "",
      };
      world.tickers.set(view.symbol, view);
      markUiDirty();

      $(t).onChange(() => {
        view.price = t.price;
        view.changePct = t.changePct;
        view.volatility = t.volatility;
        view.height = t.height;
        view.frozen = t.frozen;
        view.updatedAt = t.updatedAt;
        view.ownedFloors = t.ownedFloors ?? 0;
        view.totalFloors = t.totalFloors ?? 0;
        view.floorPrice = t.floorPrice ?? 0;
        view.tier = t.tier ?? "calm";
        view.landlordName = t.landlordName ?? "";
        view.landlordHeld = t.landlordHeld ?? 0;
        view.landlordIsCrew = t.landlordIsCrew ?? false;
        view.landlordColor = t.landlordColor ?? "";
        markUiDirty();
      });
    });

    // ---- players ----------------------------------------------------------
    $(state).players.onAdd((p: any, sessionId: string) => {
      if (sessionId === joined.sessionId) {
        world.localName = p.name;
        world.localColor = p.color;
        // Seed prediction from the spawn the server picked.
        world.local.x = p.x;
        world.local.z = p.z;
        world.local.yaw = p.yaw;
        world.authoritative.x = p.x;
        world.authoritative.z = p.z;
        world.authoritative.yaw = p.yaw;
        world.authoritative.lastSeq = p.lastSeq;
        world.authoritative.valid = true;
        syncWallet(p);
        markUiDirty();

        $(p).onChange(() => {
          world.authoritative.x = p.x;
          world.authoritative.z = p.z;
          world.authoritative.yaw = p.yaw;
          world.authoritative.lastSeq = p.lastSeq;
          world.authoritative.valid = true;
          world.localName = p.name;
          world.localColor = p.color;
          world.localEmote = p.emote ?? "";
          world.localTier = (p.tier ?? "none") as any;
          world.localTraits = p.traits || "000010";
          world.localPenthouse = p.penthouse ?? "";
          syncWallet(p);
        });
        return;
      }

      const remote: RemotePlayer = {
        sessionId,
        name: p.name,
        color: p.color,
        anim: p.anim,
        emote: p.emote ?? "",
        crewTag: p.crewTag ?? "",
        crewColor: p.crewColor ?? "",
        tier: (p.tier ?? "none") as any,
        traits: p.traits || "000010",
        buffer: [{ t: performance.now(), x: p.x, z: p.z, yaw: p.yaw }],
      };
      world.remotes.set(sessionId, remote);
      markUiDirty();

      $(p).onChange(() => {
        remote.anim = p.anim;
        remote.emote = p.emote ?? "";
        remote.crewTag = p.crewTag ?? "";
        remote.crewColor = p.crewColor ?? "";
        remote.tier = (p.tier ?? "none") as any;
        remote.traits = p.traits || "000010";
        remote.name = p.name;
        remote.color = p.color;
        remote.buffer.push({ t: performance.now(), x: p.x, z: p.z, yaw: p.yaw });
        if (remote.buffer.length > BUFFER_LEN) remote.buffer.shift();
      });
    });

    $(state).players.onRemove((_p: any, sessionId: string) => {
      world.remotes.delete(sessionId);
      // Bubbles are keyed by session and nothing else removes them, so without
      // this the map keeps one entry per player who ever spoke and left.
      world.bubbles.delete(sessionId);
      markUiDirty();
    });

    // ---- storm shards ------------------------------------------------------
    $(state).shards.onAdd((s: any, id: string) => {
      // Screen position is fixed at spawn; shards never move.
      const { sx, sy } = worldToScreen(s.x, s.z);
      world.shards.set(id, {
        id,
        x: s.x,
        z: s.z,
        sx,
        sy,
        phase: Math.random() * Math.PI * 2,
      });
      markUiDirty();
    });

    $(state).shards.onRemove((_s: any, id: string) => {
      world.shards.delete(id);
      markUiDirty();
    });

    // ---- neon signs --------------------------------------------------------
    $(state).signs.onAdd((s: any, id: string) => {
      world.signs.set(id, {
        id,
        symbol: s.symbol,
        ownerName: s.ownerName,
        text: s.text,
        color: s.color,
        floor: s.floor,
      });
      markUiDirty();
    });

    $(state).signs.onRemove((_s: any, id: string) => {
      world.signs.delete(id);
      markUiDirty();
    });

    // ---- leaderboards ------------------------------------------------------
    // Replaced wholesale on each refresh, so the simplest correct handling is
    // to re-read the array rather than track individual adds and removes.
    const syncBoards = () => {
      world.boards = [...(state.boards ?? [])].map((b: any) => ({
        board: b.board,
        rank: b.rank,
        name: b.name,
        wallet: b.wallet,
        score: b.score,
        detail: b.detail,
      }));
      markUiDirty();
    };
    $(state).boards.onAdd(syncBoards);
    $(state).boards.onRemove(syncBoards);

    // ---- city-wide scalars -------------------------------------------------
    $(state).onChange(() => {
      world.clubEvent = state.clubEvent ?? "";
      world.clubEndsAt = state.clubEndsAt ?? 0;
      world.clubIntensity = state.clubIntensity ?? 0;
      world.clubInside = state.clubInside ?? 0;
      world.stormSymbol = state.stormSymbol ?? "";
      world.stormEndsAt = state.stormEndsAt ?? 0;
      world.phase = state.phase === "open" ? "open" : "closed";
      world.marketMood = state.marketMood;
      world.peakVolatility = state.peakVolatility;
      world.peakSymbol = state.peakSymbol;
      world.oracleOk = state.oracleOk;
      world.oracleAt = state.oracleAt;
      world.seasonLabel = state.seasonLabel ?? "";
      world.serverTime = state.serverTime ?? 0;
      markUiDirty();
    });

    joined.onMessage("chat", (msg: IncomingChat) => {
      // Bubbles live on the world object so the Pixi loop can read them without
      // a React render; the HUD log subscribes separately.
      const bubble = world.bubbles.get(msg.from);
      if (bubble) {
        bubble.text = msg.text;
        bubble.at = performance.now();
      } else {
        world.bubbles.set(msg.from, { text: msg.text, at: performance.now() });
      }
      chatListeners.forEach((fn) => fn(msg));
    });

    /**
     * Crew scrollback, replayed on join.
     *
     * Delivered as one batch rather than as individual `chat` messages, so it
     * never triggers speech bubbles — a bubble for something said four hours ago
     * would pop over somebody's head as they walked in.
     */
    joined.onMessage("crewHistory", (lines: { name: string; text: string; at: number }[]) => {
      crewHistoryListeners.forEach((fn) => fn(lines));
    });

    joined.onMessage("dmInbox", (msg: { threads: ThreadView[]; unread: number }) => {
      world.dmThreads = msg.threads ?? [];
      world.dmUnread = msg.unread ?? 0;

      // Keep an open conversation's unread count from reappearing after a send.
      if (world.dmOpen) {
        const open = world.dmThreads.find((t) => t.device === world.dmOpen!.device);
        if (open) open.unread = 0;
      }
      markUiDirty();
    });

    joined.onMessage("dmThread", (msg: { device: string; lines: DirectLine[] }) => {
      const name =
        world.dmThreads.find((t) => t.device === msg.device)?.name ??
        world.dmOpen?.name ??
        "Trader";
      world.dmOpen = { device: msg.device, name, lines: msg.lines ?? [] };
      markUiDirty();
    });

    joined.onMessage("dmIncoming", (msg: IncomingDm) => {
      // Appended straight into the open thread so a live reply lands without a
      // round trip. Matched on the handle rather than the display name, because
      // two players may pick the same name and a reply must never surface in
      // somebody else's conversation.
      if (world.dmOpen && world.dmOpen.device === msg.handle) {
        world.dmOpen.lines.push({
          id: -msg.at,
          fromName: msg.fromName,
          mine: false,
          text: msg.text,
          at: msg.at,
        });
      }
      dmListeners.forEach((fn) => fn(msg));
      markUiDirty();
    });

    joined.onMessage("dmResult", (result: DmOutcome) => {
      dmResultListeners.forEach((fn) => fn(result));
      markUiDirty();
    });

    joined.onMessage("buyFloorResult", (result: BuyOutcome) => {
      emitBuyResult(result);
      markUiDirty();
    });

    joined.onMessage("shiftStartResult", (result: ShiftStartOutcome) => {
      shiftStartListeners.forEach((fn) => fn(result));
    });

    joined.onMessage("shiftFinishResult", (result: ShiftFinishOutcome) => {
      shiftFinishListeners.forEach((fn) => fn(result));
      markUiDirty();
    });

    joined.onMessage("placeSignResult", (result: BuyOutcome) => {
      signListeners.forEach((fn) => fn(result));
      markUiDirty();
    });

    // ---- crews --------------------------------------------------------------
    joined.onMessage("crewState", (crew: CrewView | null) => {
      world.crew = crew;
      markUiDirty();
    });

    joined.onMessage("crewResult", (result: CrewOutcome) => {
      crewListeners.forEach((fn) => fn(result));
      markUiDirty();
    });

    joined.onMessage("crewLeft", (result: { ok: boolean; reason?: string }) => {
      if (result.ok) {
        // No flash on success: clearing the crew flips the panel back to its
        // join/found state, which says it better than a message would. Routing
        // it through the failure path would show "You left your crew" in red.
        world.crew = null;
      } else {
        crewListeners.forEach((fn) => fn({ ok: false, reason: result.reason ?? "" }));
      }
      markUiDirty();
    });

    // ---- floor market -------------------------------------------------------
    // Listings are replaced wholesale by the server, so re-reading the map is
    // both simpler and less error-prone than tracking individual adds.
    const syncListings = () => {
      const me = deviceId();
      world.listings = [...(state.listings?.values?.() ?? [])]
        .map((l: any) => ({
          id: l.id,
          symbol: l.symbol,
          price: l.price,
          sellerName: l.sellerName,
          sellerDevice: l.sellerDevice,
          mine: l.sellerDevice === me,
        }))
        .sort((a, b) => a.symbol.localeCompare(b.symbol) || a.price - b.price);
      markUiDirty();
    };
    $(state).listings.onAdd(syncListings);
    $(state).listings.onRemove(syncListings);

    joined.onMessage("listFloorResult", (r: { ok: boolean; reason?: string }) => {
      emitMarket(r.ok ? { ok: true, message: "Listed." } : { ok: false, reason: r.reason ?? "" });
    });

    joined.onMessage("cancelListingResult", (r: { ok: boolean; reason?: string }) => {
      emitMarket(
        r.ok ? { ok: true, message: "Listing withdrawn." } : { ok: false, reason: r.reason ?? "" }
      );
    });

    joined.onMessage(
      "buyListingResult",
      (r: { ok: boolean; reason?: string; symbol?: string; price?: number; sellerName?: string }) => {
        emitMarket(
          r.ok
            ? { ok: true, message: `Bought a ${r.symbol} floor from ${r.sellerName} for ${r.price} $B.` }
            : { ok: false, reason: r.reason ?? "" }
        );
        markUiDirty();
      }
    );

    joined.onMessage("shardsCollected", (count: number) => {
      shardListeners.forEach((fn) => fn(count));
      markUiDirty();
    });

    joined.onLeave(() => {
      world.conn = "error";
      world.error = "disconnected from server";
      markUiDirty();
    });

    return joined;
  } catch (err) {
    /**
     * Tell an auth refusal apart from an unreachable server.
     *
     * The server rejects an unauthenticated join with 401 before a player
     * exists. Reporting that as "could not reach game server" would send
     * somebody hunting a network fault when the real answer is "sign in" — and
     * it is exactly what a deploy with `REQUIRE_AUTH` on but no
     * `VITE_PRIVY_APP_ID` looks like, where the client believes accounts are
     * optional and the server disagrees.
     */
    const code = (err as { code?: number })?.code;
    const message = String((err as Error)?.message ?? err);
    if (code === 401 || code === 503 || /sign in|not configured/i.test(message)) {
      world.conn = "error";
      world.authRequired = true;
      world.error = message;
    } else {
      world.conn = "error";
      world.error = `could not reach game server on ${SERVER_URL}`;
    }
    markUiDirty();
    console.error("[net] connect failed", err);
    throw err;
  }
}

/**
 * Mirror the local player's wallet and per-tower ownership into `world`.
 * Ownership is public in the schema, but only the local player's counts drive
 * the "you own N floors here" readout.
 */
function syncWallet(p: any) {
  world.block = p.block ?? 0;
  world.charge = p.charge ?? 0;
  world.resting = p.resting ?? false;
  world.shardCount = p.shards ?? 0;
  world.wallet.address = p.wallet ?? "";

  world.tickers.forEach((view) => {
    view.myFloors = 0;
  });
  p.floors?.forEach?.((count: number, symbol: string) => {
    const view = world.tickers.get(symbol);
    if (view) view.myFloors = count;
  });
}

/**
 * Rejoin with the current credentials.
 *
 * Identity is decided when the room is joined, so logging in or out mid-session
 * has to reconnect for the server to re-evaluate who this is. Without it a
 * player would appear logged in while the server still treated them as a guest.
 */
export async function reconnect() {
  try {
    await room?.leave();
  } catch {
    /* already gone */
  }
  room = null;
  resetWorld();
  await connect();
}

// ---------------------------------------------------------------------------
// Chat and emotes
// ---------------------------------------------------------------------------

export interface IncomingChat {
  from: string;
  name: string;
  color: string;
  crewTag: string;
  text: string;
  channel: "local" | "district" | "crew";
  at: number;
  /** Set by the client on replayed crew scrollback — never sent by the server. */
  history?: boolean;
}

const chatListeners = new Set<(msg: IncomingChat) => void>();

/**
 * Subscribe to chat. The renderer uses this for speech bubbles and the HUD for
 * the log, so it's a fan-out rather than a single handler.
 */
export function onChat(fn: (msg: IncomingChat) => void) {
  chatListeners.add(fn);
  return () => {
    chatListeners.delete(fn);
  };
}

export function sendChat(text: string, channel: "local" | "district" | "crew") {
  room?.send("chat", { text, channel });
}

// ---------------------------------------------------------------------------
// Crew history and direct messages
// ---------------------------------------------------------------------------

/**
 * A private message arriving live.
 *
 * Addressed by `fromSession`, never by device id — a device id is the guest
 * identity the server trusts on join, so it must never reach a client. That is
 * why replying takes a session id and reopening a thread takes the opaque
 * handle the server itself supplied.
 */
export interface IncomingDm {
  fromSession: string;
  /** The sender's conversation handle, as this client addresses them. */
  handle: string;
  fromName: string;
  text: string;
  at: number;
}

export type DmOutcome = { ok: true; at: number } | { ok: false; reason: string };

const crewHistoryListeners = new Set<(lines: { name: string; text: string; at: number }[]) => void>();
const dmListeners = new Set<(msg: IncomingDm) => void>();
const dmResultListeners = new Set<(r: DmOutcome) => void>();

export function onCrewHistory(fn: (lines: { name: string; text: string; at: number }[]) => void) {
  crewHistoryListeners.add(fn);
  return () => {
    crewHistoryListeners.delete(fn);
  };
}

export function onDirectMessage(fn: (msg: IncomingDm) => void) {
  dmListeners.add(fn);
  return () => {
    dmListeners.delete(fn);
  };
}

export function onDmResult(fn: (r: DmOutcome) => void) {
  dmResultListeners.add(fn);
  return () => {
    dmResultListeners.delete(fn);
  };
}

/** Start a conversation with somebody in the room, addressed by session. */
export function sendDm(toSession: string, text: string) {
  room?.send("dmSend", { to: toSession, text });
}

/**
 * Reply inside a conversation you already have.
 *
 * Takes the opaque handle from the inbox rather than a session, so a reply still
 * goes through after the other person has logged off — which is the whole reason
 * these are stored rather than shouted.
 */
export function replyToThread(handle: string, text: string) {
  room?.send("dmSend", { handle, text });
}

export function refreshInbox() {
  room?.send("dmThreads");
}

/** Open one conversation. `device` is the opaque handle from the inbox. */
export function openThread(device: string) {
  room?.send("dmThread", device);
}

export function setBlocked(device: string, block: boolean) {
  room?.send("dmBlock", { device, block });
}

export function sendEmote(name: string) {
  room?.send("emote", name);
}

export function setName(name: string) {
  room?.send("setName", name);
}

/** Ask the server to lease one floor. All validation happens server-side. */
export function buyFloor(symbol: string) {
  room?.send("buyFloor", symbol);
}

export type BuyOutcome = { ok: boolean; reason?: string; symbol?: string; spent?: number };

const buyListeners = new Set<(r: BuyOutcome) => void>();

export function onBuyResult(fn: (r: BuyOutcome) => void) {
  buyListeners.add(fn);
  return () => buyListeners.delete(fn);
}

export function emitBuyResult(result: BuyOutcome) {
  buyListeners.forEach((fn) => fn(result));
}

// ---------------------------------------------------------------------------
// Shift work
// ---------------------------------------------------------------------------

export interface ShiftSpec {
  shiftId: string;
  symbol: string;
  targets: number[];
  sweepSec: number;
  band: number;
  rounds: number;
}

export type ShiftStartOutcome = { ok: true; spec: ShiftSpec } | { ok: false; reason: string };
export type ShiftFinishOutcome =
  | { ok: true; symbol: string; accuracy: number; paid: number; tier: string }
  | { ok: false; reason: string };

const shiftStartListeners = new Set<(r: ShiftStartOutcome) => void>();
const shiftFinishListeners = new Set<(r: ShiftFinishOutcome) => void>();
const signListeners = new Set<(r: BuyOutcome) => void>();
const shardListeners = new Set<(count: number) => void>();

export function onShiftStart(fn: (r: ShiftStartOutcome) => void) {
  shiftStartListeners.add(fn);
  return () => {
    shiftStartListeners.delete(fn);
  };
}

export function onShiftFinish(fn: (r: ShiftFinishOutcome) => void) {
  shiftFinishListeners.add(fn);
  return () => {
    shiftFinishListeners.delete(fn);
  };
}

export function onSignResult(fn: (r: BuyOutcome) => void) {
  signListeners.add(fn);
  return () => {
    signListeners.delete(fn);
  };
}

export function onShardsCollected(fn: (count: number) => void) {
  shardListeners.add(fn);
  return () => {
    shardListeners.delete(fn);
  };
}

export function startShift(symbol: string) {
  room?.send("shiftStart", symbol);
}

/** `presses` are ms-since-shift-start; the server re-derives accuracy itself. */
export function finishShift(shiftId: string, presses: number[]) {
  room?.send("shiftFinish", { shiftId, presses });
}

export function placeSign(symbol: string, text: string, color: string) {
  room?.send("placeSign", { symbol, text, color });
}

// ---------------------------------------------------------------------------
// Crews
// ---------------------------------------------------------------------------

export type CrewOutcome =
  | { ok: true; crew: { name: string; tag: string; color: string } }
  | { ok: false; reason: string };

const crewListeners = new Set<(r: CrewOutcome) => void>();

export function onCrewResult(fn: (r: CrewOutcome) => void) {
  crewListeners.add(fn);
  return () => {
    crewListeners.delete(fn);
  };
}

export function createCrew(name: string, tag: string, color: string) {
  room?.send("crewCreate", { name, tag, color });
}

export function joinCrew(tag: string) {
  room?.send("crewJoin", tag);
}

export function leaveCrew() {
  room?.send("crewLeave");
}

// ---------------------------------------------------------------------------
// Floor market
// ---------------------------------------------------------------------------

export type MarketOutcome = { ok: true; message: string } | { ok: false; reason: string };

const marketListeners = new Set<(r: MarketOutcome) => void>();

export function onMarketResult(fn: (r: MarketOutcome) => void) {
  marketListeners.add(fn);
  return () => {
    marketListeners.delete(fn);
  };
}

function emitMarket(result: MarketOutcome) {
  marketListeners.forEach((fn) => fn(result));
}

export function listFloor(symbol: string, price: number) {
  room?.send("listFloor", { symbol, price });
}

export function cancelListing(id: number) {
  room?.send("cancelListing", id);
}

export function buyListing(id: number) {
  room?.send("buyListing", id);
}

// ---------------------------------------------------------------------------
// Wallet sign-in
// ---------------------------------------------------------------------------

export type WalletOutcome = { ok: true; address: string } | { ok: false; reason: string };

/**
 * Full sign-in round trip: ask the server for a nonce, get the wallet to sign
 * it, send the signature back for verification. Resolves with the verified
 * address or throws with a message worth showing the player.
 */
export function signInWithWallet(
  signNonce: (nonce: string) => Promise<{ address: string; message: string; signature: string }>
): Promise<string> {
  return new Promise((resolve, reject) => {
    const active = room;
    if (!active) {
      reject(new Error("Not connected to the city."));
      return;
    }

    const timeout = setTimeout(() => {
      offChallenge();
      offVerify();
      reject(new Error("Wallet sign-in timed out."));
    }, 120_000);

    const offChallenge = active.onMessage("walletChallengeResult", async (msg: { nonce: string }) => {
      try {
        const proof = await signNonce(msg.nonce);
        active.send("walletVerify", proof);
      } catch (err) {
        clearTimeout(timeout);
        offChallenge();
        offVerify();
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });

    const offVerify = active.onMessage("walletVerifyResult", (result: WalletOutcome) => {
      clearTimeout(timeout);
      offChallenge();
      offVerify();
      markUiDirty();
      if (result.ok) resolve(result.address);
      else reject(new Error(result.reason));
    });

    active.send("walletChallenge");
  });
}
