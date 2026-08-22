import { Schema, MapSchema, ArraySchema, type } from "@colyseus/schema";

export class Player extends Schema {
  @type("number") x = 0;
  @type("number") y = 0;
  @type("number") z = 0;
  /** Facing, radians. */
  @type("number") yaw = 0;
  /** "idle" | "walk" | "run" — drives the client animation state machine. */
  @type("string") anim = "idle";
  @type("string") name = "";
  /**
   * False until the player has picked their own name.
   *
   * Replicated because the client gates entry on it: a fresh account is shown
   * the claim screen rather than dropped into the city as Trader4821. Everyone
   * can see everyone's flag, which is harmless — it says nothing but "this
   * person has not chosen a name yet".
   */
  @type("boolean") nameClaimed = false;
  @type("string") color = "#4F4DC4";
  /** Last input sequence this player had processed; clients reconcile against it. */
  @type("number") lastSeq = 0;

  // ---- economy ----------------------------------------------------------
  @type("number") block = 0;
  @type("number") charge = 0;
  @type("number") shards = 0;
  /** Verified wallet address, or "" while playing as a guest. */
  @type("string") wallet = "";
  /** True while standing in a park, so the HUD can show the CHARGE bonus. */
  @type("boolean") resting = false;

  // ---- NFT identity -----------------------------------------------------
  /**
   * "none" | "resident" | "landlord" | "penthouse".
   *
   * Resolved server-side from a chain read after the wallet is proved, and
   * never from anything the client says. Replicated because other players need
   * to see the badge — it is the whole point of the collection.
   */
  @type("string") tier = "none";
  /** Six base36 digits driving the avatar; see config/traits.ts. */
  /**
   * The look this player has chosen or been granted, or "" for none.
   *
   * Empty is meaningful rather than missing. It tells the renderer to fall back
   * to the player's colour, which is how everybody without a customised
   * appearance is told apart from everybody else. Defaulting this to a real
   * trait code would draw every uncustomised player identically.
   */
  @type("string") traits = "";
  /** Penthouse only: the tower whose top floor this player holds. */
  @type("string") penthouse = "";

  // ---- social -----------------------------------------------------------
  /** Current emote, cleared by the server after EMOTE_MS. */
  @type("string") emote = "";
  @type("number") emoteAt = 0;
  /** Crew tag shown beside the name in-world, e.g. "BULL". */
  @type("string") crewTag = "";
  @type("string") crewColor = "";
  /**
   * Floors owned per ticker symbol. Public on purpose: seeing who owns the
   * bright tower is half the point of the mechanic.
   */
  @type({ map: "number" }) floors = new MapSchema<number>();
}

/** One building. Mirrors a TickerReading from the oracle. */
export class Ticker extends Schema {
  @type("string") symbol = "";
  @type("string") label = "";
  @type("string") district = "";
  @type("number") price = 0;
  @type("number") changePct = 0;
  @type("number") volatility = 0;
  @type("number") height = 20;
  @type("number") x = 0;
  @type("number") z = 0;
  @type("boolean") frozen = false;
  @type("boolean") alwaysOn = false;
  @type("number") updatedAt = 0;

  /** Total floors bought by all players — one lit window each. */
  @type("number") ownedFloors = 0;
  /** Total floors that exist in this tower, derived from its height. */
  @type("number") totalFloors = 0;
  /** Cost of the next floor, recomputed as price and volatility move. */
  @type("number") floorPrice = 0;
  /** Volatility bucket driving yield: calm | normal | hot | extreme. */
  @type("string") tier = "calm";

  /**
   * Whoever holds the most floors here, provided they clear the threshold.
   * Empty when the tower is uncontrolled.
   */
  @type("string") landlordName = "";
  @type("number") landlordHeld = 0;
  @type("boolean") landlordIsCrew = false;
  @type("string") landlordColor = "";
}

/** A Data Runner pickup, live only during a volatility storm. */
export class Shard extends Schema {
  @type("string") id = "";
  @type("number") x = 0;
  @type("number") z = 0;
  /** Tower whose volatility spawned this storm. */
  @type("string") symbol = "";
}

/** A floor offered for sale by another player. */
export class Listing extends Schema {
  @type("number") id = 0;
  @type("string") symbol = "";
  @type("number") price = 0;
  @type("string") sellerName = "";
  /** True for the client viewing it, so it can offer Cancel instead of Buy. */
  @type("string") sellerDevice = "";
}

/** A player-crafted neon sign mounted on a tower facade. */
export class Sign extends Schema {
  @type("string") id = "";
  @type("string") symbol = "";
  @type("string") ownerName = "";
  @type("string") text = "";
  @type("string") color = "";
  /** Which floor it hangs from, so two signs don't overlap. */
  @type("number") floor = 0;
}

/** One ranked row, replicated so the in-game panel needs no extra request. */
export class BoardEntry extends Schema {
  @type("string") board = "";
  @type("number") rank = 0;
  @type("string") name = "";
  @type("string") wallet = "";
  @type("number") score = 0;
  @type("string") detail = "";
}

/**
 * A park, pond or the central plaza.
 *
 * Replicated rather than recomputed on the client, because standing in one
 * changes CHARGE regeneration — a park the player can see must be a park the
 * server agrees exists, and the only way to guarantee that is one source.
 */
export class Park extends Schema {
  @type("string") id = "";
  @type("number") x = 0;
  @type("number") z = 0;
  /** Half-extent for squares; radius for the plaza. */
  @type("number") half = 0;
  /** "green" | "water" | "plaza" */
  @type("string") kind = "green";
  @type("number") seed = 0;
  @type("string") district = "";
}

export class District extends Schema {
  @type("string") id = "";
  @type("string") name = "";
  @type("string") accent = "";
  @type("string") blurb = "";
  @type("number") cx = 0;
  @type("number") cz = 0;
}

export class CityState extends Schema {
  @type({ map: Player }) players = new MapSchema<Player>();
  @type({ map: Ticker }) tickers = new MapSchema<Ticker>();
  @type([District]) districts = new ArraySchema<District>();
  @type([Park]) parks = new ArraySchema<Park>();
  @type({ map: Shard }) shards = new MapSchema<Shard>();
  @type({ map: Sign }) signs = new MapSchema<Sign>();
  @type({ map: Listing }) listings = new MapSchema<Listing>();

  /** Top rows across every board, refreshed on a timer. */
  @type([BoardEntry]) boards = new ArraySchema<BoardEntry>();
  /** Label of the active weekly season, e.g. "Week of 2026-08-10". */
  @type("string") seasonLabel = "";

  // ---- The Vault --------------------------------------------------------
  /**
   * Active club event, or "" between them.
   *
   * Replicated to EVERYONE, holder or not. A guest seeing "Closing Bell at The
   * Vault — 18 inside" is the entire mechanism of a gated venue; hiding it from
   * non-holders would make the club invisible and therefore pointless.
   */
  @type("string") clubEvent = "";
  @type("number") clubEndsAt = 0;
  /** 0..1, drives the dance floor and the music tempo. */
  @type("number") clubIntensity = 0;
  /** How many players are in the venue, for the banner. */
  @type("number") clubInside = 0;

  /** Ticker currently under a volatility storm, or "" when calm. */
  @type("string") stormSymbol = "";
  /** Epoch ms when the active storm ends. */
  @type("number") stormEndsAt = 0;

  /** "open" | "closed" — derived from real feed staleness. */
  @type("string") phase = "closed";
  /** Mean % change across live feeds; drives weather. */
  @type("number") marketMood = 0;
  @type("number") peakVolatility = 0;
  @type("string") peakSymbol = "";
  @type("boolean") oracleOk = false;
  @type("number") oracleAt = 0;
  /** Server clock, so clients can render a synced day/night cycle. */
  @type("number") serverTime = 0;
}
