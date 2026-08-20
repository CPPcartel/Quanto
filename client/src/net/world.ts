/**
 * The client's mutable mirror of server state.
 *
 * Deliberately NOT React state. The 3D scene reads these objects directly
 * inside useFrame at 60fps; re-rendering React 60 times a second with dozens
 * of players and buildings would tank the frame rate. React UI instead
 * subscribes through `subscribeUi` and is notified on a slow cadence.
 */

import type { Daylight } from "../pixi/daylight";

export interface Vec2 {
  x: number;
  z: number;
}

export interface Snapshot {
  /** Client receive time (ms). Using our own clock avoids clock-skew maths. */
  t: number;
  x: number;
  z: number;
  yaw: number;
}

export type Tier = "none" | "resident" | "landlord" | "penthouse";

export interface RemotePlayer {
  sessionId: string;
  name: string;
  color: string;
  /** NFT tier, resolved server-side from a chain read. Never client-asserted. */
  tier: Tier;
  /** Six base36 digits driving the avatar; see pixi/traits.ts. */
  traits: string;
  anim: string;
  emote: string;
  crewTag: string;
  crewColor: string;
  /** Ring of recent snapshots used for entity interpolation. */
  buffer: Snapshot[];
}

export interface TickerView {
  symbol: string;
  label: string;
  district: string;
  price: number;
  changePct: number;
  volatility: number;
  height: number;
  x: number;
  z: number;
  frozen: boolean;
  alwaysOn: boolean;
  updatedAt: number;
  /** Smoothed height actually rendered, eased toward `height`. */
  renderHeight: number;
  /**
   * Floors in this tower owned by players. Every owned floor renders as a lit
   * window, so the skyline's glow is a direct readout of the player economy.
   */
  ownedFloors: number;
  /** Floors owned by the local player specifically. */
  myFloors: number;
  /** Total floors that exist in this tower, from its live height. */
  totalFloors: number;
  /** Cost of the next floor here, in $BLOCK. */
  floorPrice: number;
  /** Volatility bucket driving yield: calm | normal | hot | extreme. */
  tier: string;

  /**
   * Whoever controls this tower, or "" when nobody clears the threshold.
   * Rendered on the building itself — walking the city should tell you who
   * owns what without opening a panel.
   */
  landlordName: string;
  landlordHeld: number;
  landlordIsCrew: boolean;
  landlordColor: string;
}

/** A floor another player has offered for sale. */
export interface ListingView {
  id: number;
  symbol: string;
  price: number;
  sellerName: string;
  sellerDevice: string;
  /** True when this is the local player's own listing — offer Cancel, not Buy. */
  mine: boolean;
}

/**
 * One private conversation, as the inbox lists it.
 *
 * `device` is opaque here: the server hands back its own identifier for the
 * other party so a thread can be reopened, and the client only ever echoes it
 * straight back. It is not a session id and cannot be used to address anyone.
 */
export interface ThreadView {
  device: string;
  name: string;
  lastText: string;
  at: number;
  unread: number;
}

/** One message inside an open conversation. */
export interface DirectLine {
  id: number;
  fromName: string;
  /** True when the local player sent it — decided server-side. */
  mine: boolean;
  text: string;
  at: number;
}

/** The crew the local player belongs to, or null when unaffiliated. */
export interface CrewView {
  name: string;
  tag: string;
  color: string;
  members: number;
  floors: number;
  isLeader: boolean;
}

/**
 * A park, pond or the central plaza.
 *
 * Replicated from the server rather than derived here. Standing in one speeds
 * CHARGE regeneration, so the picture and the rule must come from the same
 * place or a player would rest in a park the server does not believe in.
 */
export interface ParkView {
  id: string;
  x: number;
  z: number;
  /** Half-extent for square parks; radius for the plaza. */
  half: number;
  kind: "green" | "water" | "plaza" | "club";
  seed: number;
  district: string;
}

export interface DistrictView {
  id: string;
  name: string;
  accent: string;
  blurb: string;
  cx: number;
  cz: number;
}

/** One ranked row on a leaderboard, replicated from the server. */
export interface BoardEntryView {
  board: string;
  rank: number;
  name: string;
  wallet: string;
  score: number;
  detail: string;
}

/** A Data Runner pickup during a volatility storm. Screen coords are
 *  precomputed by the renderer when the shard arrives. */
export interface ShardView {
  id: string;
  x: number;
  z: number;
  sx: number;
  sy: number;
  /** Random animation offset so a cluster doesn't pulse in lockstep. */
  phase: number;
}

/** A player-crafted neon sign mounted on a tower. */
export interface SignView {
  id: string;
  symbol: string;
  ownerName: string;
  text: string;
  color: string;
  floor: number;
}

export type ConnState = "connecting" | "connected" | "error";

export const world = {
  conn: "connecting" as ConnState,
  error: "",
  /**
   * The server refused the join because there is no verified account.
   *
   * Distinct from a general connection error: the fix is to sign in, not to
   * check the network. It also catches the misconfiguration where the server
   * requires accounts and the client was built without `VITE_PRIVY_APP_ID`.
   */
  authRequired: false,
  sessionId: "",

  /** Locally predicted position — what the camera follows. */
  local: { x: 0, z: 0, yaw: 0, anim: "idle" },
  /** Last authoritative position from the server. */
  authoritative: { x: 0, z: 0, yaw: 0, lastSeq: 0, valid: false },
  localName: "",
  localColor: "#4F4DC4",
  localEmote: "",
  /** The local player's NFT tier and appearance. */
  localTier: "none" as Tier,
  localTraits: "000010",
  /** Penthouse holders only: the tower whose top floor they hold. */
  localPenthouse: "",

  remotes: new Map<string, RemotePlayer>(),
  tickers: new Map<string, TickerView>(),
  districts: [] as DistrictView[],
  parks: [] as ParkView[],
  shards: new Map<string, ShardView>(),

  /** Speech bubbles above heads: sessionId -> latest line. Read by the Pixi
   *  loop each frame, so it lives here rather than in React state. */
  bubbles: new Map<string, { text: string; at: number }>(),
  signs: new Map<string, SignView>(),

  /** Open floor listings, cheapest first. Replicated from the server. */
  listings: [] as ListingView[],
  /** The local player's crew, or null. */
  crew: null as CrewView | null,

  /**
   * Private messages.
   *
   * The list of conversations comes from the server on join and after every
   * send, so scrollback survives being offline. `dmOpen` is whichever thread is
   * on screen; it is cleared on disconnect because its contents are stale the
   * moment identity is re-evaluated.
   */
  dmThreads: [] as ThreadView[],
  dmUnread: 0,
  dmOpen: null as { device: string; name: string; lines: DirectLine[] } | null,

  /** Player economy. Populated from server state; see server/src/game. */
  charge: 100,
  /** True while standing in a park, where CHARGE regenerates faster. */
  resting: false,
  block: 0,
  shardCount: 0,

  /**
   * The Vault. Replicated to everyone, holder or not — a guest seeing an event
   * running is the whole point of a visible gated venue.
   */
  clubEvent: "",
  clubEndsAt: 0,
  clubIntensity: 0,
  clubInside: 0,

  /** Active volatility storm, or "" when the city is calm. */
  stormSymbol: "",
  stormEndsAt: 0,

  /** Top rows across every leaderboard, pushed from the server. */
  boards: [] as BoardEntryView[],
  seasonLabel: "",

  /** Wallet sign-in state. Empty address means playing as a guest. */
  wallet: {
    address: "",
    connecting: false,
    error: "",
  },

  /** Building the cursor is over, and the one clicked open. */
  hovered: "",
  selected: "",

  /**
   * Server clock in epoch ms, mirrored for anything that must agree across
   * players. The sky deliberately does *not* use it — see pixi/daylight.ts.
   */
  serverTime: 0,
  /** Current sky state, written by SkyLayer each frame and read by the HUD. */
  daylight: null as Daylight | null,

  phase: "closed" as "open" | "closed",
  marketMood: 0,
  peakVolatility: 0,
  peakSymbol: "",
  oracleOk: false,
  oracleAt: 0,

  /** Ticker the player is currently closest to; drives the inspector panel. */
  nearest: null as TickerView | null,
  /** Round-trip estimate in ms, for the netgraph. */
  ping: 0,
  /** Current camera scale, mirrored out of the renderer for the HUD. */
  zoom: 1,
  /**
   * The zoom at which the whole city fits this window. Screen-dependent, so
   * any UI asking "are we zoomed right out?" must compare against this rather
   * than a constant — a fixed threshold is never reached on a large monitor.
   */
  zoomMin: 0.12,
  /**
   * True while the view has been dragged away from the player. The HUD uses it
   * to offer a way back — a panned camera with no visible route home is how
   * players end up thinking the game lost their character.
   */
  panned: false,
  /**
   * Set by the HUD to ask the renderer to ease the view back onto the player.
   * A flag rather than a callback so the HUD needs no handle on the Pixi app.
   */
  recentre: false,

  /**
   * Renderer diagnostics surfaced in the HUD. Cheap to keep, and the only way
   * to tell a network problem from a rendering one without a devtools session.
   */
  debug: {
    fps: 0,
    canvas: "—",
    built: false,
    /** Set when the renderer fails to start at all. */
    fatal: "",
  },
};

export type World = typeof world;

// ---------------------------------------------------------------------------
// UI subscription: coalesced notifications so React renders a few times a
// second instead of every network patch.
// ---------------------------------------------------------------------------

type Listener = () => void;
const listeners = new Set<Listener>();
let version = 0;
let scheduled = false;

export function subscribeUi(fn: Listener) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getUiVersion() {
  return version;
}

/** Request a UI refresh; coalesced to at most once per animation frame batch. */
export function markUiDirty() {
  if (scheduled) return;
  scheduled = true;
  setTimeout(() => {
    scheduled = false;
    version++;
    listeners.forEach((fn) => fn());
  }, 200);
}

/**
 * Wipe everything the server owns, before reconnecting.
 *
 * Anything replicated must be listed here. A field left behind is shown as
 * current when it is stale: the leaderboard kept displaying the previous
 * session's ranks until the next 60-second refresh, and a storm banner could
 * outlive the storm it described.
 */
export function resetWorld() {
  world.remotes.clear();
  world.tickers.clear();
  world.shards.clear();
  world.bubbles.clear();
  world.signs.clear();
  world.districts = [];
  world.parks = [];
  world.listings = [];
  world.boards = [];
  world.crew = null;
  world.dmThreads = [];
  world.dmUnread = 0;
  world.dmOpen = null;
  world.resting = false;
  world.localTier = "none";
  world.localTraits = "000010";
  world.localPenthouse = "";
  world.clubEvent = "";
  world.clubEndsAt = 0;
  world.clubIntensity = 0;
  world.clubInside = 0;
  world.stormSymbol = "";
  world.stormEndsAt = 0;
  world.seasonLabel = "";
  world.hovered = "";
  world.selected = "";
  world.authoritative.valid = false;
  world.nearest = null;
}
