import { Room, Client } from "@colyseus/core";
import {
  CityState,
  Player,
  Ticker,
  District,
  Park,
  Sign,
  BoardEntry,
  Listing,
} from "./schema/CityState.js";
import { DISTRICTS, TICKERS, layoutFor } from "../config/tickers.js";
import { parkLots, parkAt } from "../config/parks.js";
import type { ChainlinkPoller } from "../oracle/ChainlinkPoller.js";
import { accrue, buyFloor, initPlayerEconomy, refreshTickerEconomics } from "../game/floors.js";
import { ShiftService } from "../game/shifts.js";
import { StormService } from "../game/storms.js";
import { SignService, SIGN_BLOCK_COST } from "../game/signs.js";
import { Store } from "../game/store.js";
import { Ledger } from "../game/ledger.js";
import { Leaderboards, BOARDS } from "../game/leaderboards.js";
import { AuthService } from "../game/auth.js";
import { PrivyAuth, linkPrivyAccount } from "../game/privy.js";
import { ChatService, isEmote, EMOTE_MS } from "../game/chat.js";
import { TerritoryService } from "../game/territory.js";
import { CrewService } from "../game/crews.js";
import { MarketService } from "../game/market.js";
import { NftService, type Tier } from "../game/nft.js";
import type { Db } from "../db/db.js";
import { CHARGE_MAX, STARTING_BLOCK } from "../game/economy.js";

/**
 * Authoritative simulation for one district instance of Candlestick City.
 *
 * Movement rule (unchanged from the 2D prototype, now in 3D): clients send
 * *inputs*, never positions. The server integrates them on a fixed tick and
 * echoes back the sequence number it last consumed so clients can reconcile.
 */

export const WALK_SPEED = 6.5; // world units/sec
export const RUN_SPEED = 12.0;
const TICK_MS = 50; // 20Hz network tick
/**
 * Fixed simulation step. Every input command represents exactly one step of
 * this length on BOTH sides — if the client sent inputs per render frame and
 * the server integrated them with its own tick delta, a 120fps client would
 * move twice as fast as a 60fps one. Client and server must agree here.
 */
export const SIM_DT = 1 / 60;
/**
 * Ceiling on commands consumed per tick. At 20Hz tick and 60Hz input we expect
 * 3; the slack absorbs jitter while capping how far a client can fast-forward
 * itself by flooding inputs.
 */
const MAX_CMDS_PER_TICK = 6;
const WORLD_LIMIT = 190;
const PALETTE = ["#4F4DC4", "#2E7A52", "#A6402F", "#A8641F", "#5B54C9", "#DB7264", "#5B8DEF", "#E5A85C"];

export interface InputCommand {
  seq: number;
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
  run: boolean;
  /** Camera yaw at the time of input; movement is camera-relative. */
  yaw: number;
}

export class CityRoom extends Room<CityState> {
  /**
   * Everyone should share one city, so this is set well above the expected
   * player count rather than at a comfortable per-room number.
   *
   * The trade-off is real: Colyseus opens a *second* room once this fills, and
   * players in different rooms cannot see each other — the world silently
   * splits in two. Raising the cap keeps one shared city; the ceiling is
   * bandwidth, since every client receives deltas for every other player at
   * 20Hz. Past a few hundred concurrent players this needs interest
   * management (only replicate nearby players) rather than a bigger number.
   */
  maxClients = Number(process.env.MAX_PLAYERS ?? 150);

  /** Pending inputs per client, drained each tick in order. */
  private queues = new Map<string, InputCommand[]>();
  private poller!: ChainlinkPoller;
  /** Wall-clock stamp of the last yield/CHARGE payout. */
  private lastAccrual = Date.now();

  private shifts = new ShiftService();
  private storms = new StormService();
  private signs = new SignService();
  private auth = new AuthService();
  private store!: Store;
  private ledger!: Ledger;
  private boards!: Leaderboards;
  private privy!: PrivyAuth;
  private db!: Db;
  private chat!: ChatService;
  private territory!: TerritoryService;
  private crews!: CrewService;
  private market!: MarketService;
  private nft!: NftService;
  /** sessionId -> persistent device id, for saving progress. */
  private devices = new Map<string, string>();

  onCreate(options: {
    poller: ChainlinkPoller;
    store: Store;
    ledger: Ledger;
    boards: Leaderboards;
    privy: PrivyAuth;
    db: Db;
  }) {
    this.poller = options.poller;
    this.store = options.store;
    this.ledger = options.ledger;
    this.boards = options.boards;
    this.privy = options.privy;
    this.db = options.db;
    this.chat = new ChatService(options.db);
    this.territory = new TerritoryService(options.db);
    this.crews = new CrewService(options.db);
    this.market = new MarketService(options.db);
    this.nft = new NftService(options.db);
    this.setState(new CityState());
    this.seedCity();
    // Async, and deliberately not awaited: the room must accept connections
    // immediately. Until it resolves the city simply shows zero occupancy.
    this.publishMarket().catch((err) =>
      console.error("[room] publishMarket failed:", err?.message ?? err)
    );
    this.restoreWorld().catch((err) =>
      console.error("[room] restoreWorld failed:", err?.message ?? err)
    );

    this.onMessage("input", (client, cmd: InputCommand) => {
      if (!cmd || typeof cmd.seq !== "number") return;
      const queue = this.queues.get(client.sessionId);
      if (!queue) return;
      // Bound the queue so a malicious client can't make us do unbounded work.
      if (queue.length < 120) queue.push(cmd);
    });

    this.onMessage("setName", (client, name: string) => {
      const player = this.state.players.get(client.sessionId);
      if (player && typeof name === "string") {
        player.name = name.slice(0, 16).replace(/[^\w \-]/g, "") || player.name;
      }
    });

    /**
     * Buy one floor. Every check lives server-side: the client only asks, and
     * is told what happened. Each owned floor becomes a lit window visible to
     * the whole city.
     */
    this.onMessage("buyFloor", (client, symbol: string) => {
      const player = this.state.players.get(client.sessionId);
      if (!player || typeof symbol !== "string") return;

      const result = buyFloor(this.state, player, symbol);
      client.send("buyFloorResult", result);

      if (result.ok) {
        const deviceId = this.devices.get(client.sessionId);
        if (deviceId) {
          this.ledger.post(deviceId, player, "floor_purchase", -result.spent, {
            ref: this.ledger.ref("floor"),
            meta: { symbol: result.symbol, owned: result.owned },
          });
        }
        this.persist(client.sessionId);
      }
    });

    // ---- chat -------------------------------------------------------------
    /**
     * Proximity and district chat. Validation, rate limiting and sanitising all
     * happen in ChatService before anything reaches another player's screen.
     */
    this.onMessage("chat", (client, raw: unknown) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;

      const accepted = this.chat.accept(client.sessionId, raw);
      if (!accepted) return; // rate limited, empty, or a repeat

      const message = {
        from: client.sessionId,
        name: player.name,
        color: player.color,
        crewTag: player.crewTag,
        text: accepted.text,
        channel: accepted.channel,
        at: Date.now(),
      };

      // Sent only to the audience, not broadcast — a local message that reached
      // the whole city would defeat the point of proximity chat.
      for (const sessionId of this.chat.audience(this.state, client.sessionId, accepted.channel)) {
        const target = this.clients.find((c) => c.sessionId === sessionId);
        target?.send("chat", message);
      }

      const deviceId = this.devices.get(client.sessionId);
      if (deviceId) this.chat.log(deviceId, message, player.x, player.z);
    });

    // ---- crews -------------------------------------------------------------
    this.onMessage(
      "crewCreate",
      async (client, msg: { name?: string; tag?: string; color?: string }) => {
        const deviceId = this.devices.get(client.sessionId);
        if (!deviceId || !msg) return;
        // Flush first so a brand-new player has a row for the crew to reference.
        await this.ledger.flush().catch(() => {});
        // The charter comes from the founder's verified tier. A client cannot
        // ask for one — there is no field for it in the message.
        const founder = this.state.players.get(client.sessionId);
        const chartered = founder?.tier === "landlord" || founder?.tier === "penthouse";
        const result = await this.crews.create(
          deviceId,
          msg.name ?? "",
          msg.tag ?? "",
          msg.color ?? "",
          chartered
        );
        client.send("crewResult", result);
        if (result.ok) {
          this.applyCrew(client.sessionId, result.crew.tag, result.crew.color);
          this.sendCrew(client, deviceId);
        }
      }
    );

    this.onMessage("crewJoin", async (client, tag: string) => {
      const deviceId = this.devices.get(client.sessionId);
      if (!deviceId || typeof tag !== "string") return;
      await this.ledger.flush().catch(() => {});
      const result = await this.crews.join(deviceId, tag);
      client.send("crewResult", result);
      if (result.ok) {
        this.applyCrew(client.sessionId, result.crew.tag, result.crew.color);
        this.sendCrew(client, deviceId);
      }
    });

    this.onMessage("crewLeave", async (client) => {
      const deviceId = this.devices.get(client.sessionId);
      if (!deviceId) return;
      const result = await this.crews.leave(deviceId);
      client.send("crewLeft", result);
      if (result.ok) {
        this.applyCrew(client.sessionId, "", "");
        client.send("crewState", null);
      }
    });

    // ---- floor market ------------------------------------------------------
    this.onMessage("listFloor", async (client, msg: { symbol?: string; price?: number }) => {
      const deviceId = this.devices.get(client.sessionId);
      if (!deviceId || !msg) return;
      // The seller's current floors must be on disk before we check ownership.
      await this.ledger.flush().catch(() => {});
      const result = await this.market.list(deviceId, msg.symbol ?? "", Number(msg.price));
      client.send("listFloorResult", result);
      if (result.ok) await this.publishMarket();
    });

    this.onMessage("cancelListing", async (client, id: number) => {
      const deviceId = this.devices.get(client.sessionId);
      if (!deviceId || typeof id !== "number") return;
      const result = await this.market.cancel(deviceId, id);
      client.send("cancelListingResult", result);
      if (result.ok) await this.publishMarket();
    });

    this.onMessage("buyListing", async (client, id: number) => {
      const deviceId = this.devices.get(client.sessionId);
      const player = this.state.players.get(client.sessionId);
      if (!deviceId || !player || typeof id !== "number") return;

      /**
       * Both sides settle in SQL, so the in-memory balance must be on disk
       * first or the next flush would overwrite the trade with a stale value.
       */
      await this.ledger.flush().catch(() => {});
      const result = await this.market.buy(deviceId, id);
      client.send("buyListingResult", result);

      if (result.ok) {
        /**
         * Re-read what the trade actually produced, for BOTH sides.
         *
         * Refreshing only the buyer is a live data-loss bug when the seller is
         * online: their in-memory balance and floors still show the pre-trade
         * values, and the next flush writes those back with an absolute upsert
         * — cancelling the payment and handing the floor back, so the buyer has
         * paid for a floor that now exists twice.
         */
        await this.reloadPlayer(deviceId);
        if (result.sellerDevice) await this.reloadPlayer(result.sellerDevice);

        await this.refreshOwnedFloors();
        await this.publishMarket();
      }
    });

    this.onMessage("emote", (client, name: unknown) => {
      const player = this.state.players.get(client.sessionId);
      if (!player || !isEmote(name)) return;
      player.emote = name;
      player.emoteAt = Date.now();
    });

    // ---- wallet sign-in ---------------------------------------------------
    /** Hand out a single-use nonce for the wallet to sign. */
    this.onMessage("walletChallenge", (client) => {
      client.send("walletChallengeResult", { nonce: this.auth.challenge(client.sessionId) });
    });

    /**
     * Verify a wallet signature and adopt that wallet's save.
     *
     * Signing proves ownership only — it authorises no transaction and costs
     * no gas. On success, guest progress is carried over (or the wallet's
     * existing save is restored if it has played from another browser before).
     */
    this.onMessage(
      "walletVerify",
      async (client, msg: { address: string; message: string; signature: string }) => {
        const player = this.state.players.get(client.sessionId);
        if (!player || !msg) return;

        const address = await this.auth.verify(
          client.sessionId,
          msg.address,
          msg.message,
          msg.signature
        );

        if (!address) {
          client.send("walletVerifyResult", { ok: false, reason: "Signature rejected." });
          return;
        }

        const guestDevice = this.devices.get(client.sessionId) ?? address;
        const canonicalDevice = await this.store.linkWallet(address, guestDevice);

        // The wallet already had a save elsewhere — load it over the guest one.
        if (canonicalDevice !== guestDevice) {
          const saved = await this.store.loadPlayer(canonicalDevice);
          if (saved) {
            player.block = saved.block;
            player.charge = Math.min(CHARGE_MAX, saved.charge);
            player.shards = saved.shards;
            player.floors.clear();
            for (const [symbol, count] of Object.entries(saved.floors)) {
              if (count > 0) player.floors.set(symbol, count);
            }
          }
          this.devices.set(client.sessionId, canonicalDevice);
        }

        player.wallet = address;
        this.persist(client.sessionId);
        client.send("walletVerifyResult", { ok: true, address });

        // The wallet is only now proved, so this is the earliest point a tier
        // can honestly be granted. Deliberately after the signature check, and
        // never from anything the client sent.
        this.nft.forget(address);
        this.applyTier(client.sessionId, address);
      }
    );

    // ---- shift work -------------------------------------------------------
    this.onMessage("shiftStart", (client, symbol: string) => {
      const player = this.state.players.get(client.sessionId);
      const deviceId = this.devices.get(client.sessionId);
      if (!player || !deviceId || typeof symbol !== "string") return;
      client.send(
        "shiftStartResult",
        this.shifts.start(this.state, player, client.sessionId, deviceId, symbol)
      );
    });

    this.onMessage(
      "shiftFinish",
      (client, msg: { shiftId: string; presses: number[] }) => {
        const player = this.state.players.get(client.sessionId);
        if (!player || !msg) return;
        const result = this.shifts.finish(
          this.state,
          player,
          client.sessionId,
          msg.shiftId,
          msg.presses
        );
        client.send("shiftFinishResult", result);

        if (result.ok) {
          const deviceId = this.devices.get(client.sessionId);
          if (deviceId) {
            this.ledger.post(deviceId, player, "shift_payout", result.paid, {
              ref: this.ledger.ref("shift"),
              meta: { symbol: result.symbol, tier: result.tier, accuracy: result.accuracy },
            });
          }
          this.persist(client.sessionId);
        }
      }
    );

    // ---- neon signs -------------------------------------------------------
    this.onMessage(
      "placeSign",
      (client, msg: { symbol: string; text: string; color: string }) => {
        const player = this.state.players.get(client.sessionId);
        if (!player || !msg) return;
        const result = this.signs.place(
          this.state,
          player,
          client.sessionId,
          msg.symbol,
          msg.text,
          msg.color
        );
        client.send("placeSignResult", result);

        if (result.ok) {
          const sign = this.state.signs.get(result.id);
          const deviceId = this.devices.get(client.sessionId);
          if (sign && deviceId) {
            this.ledger.post(deviceId, player, "sign_craft", -SIGN_BLOCK_COST, {
              ref: this.ledger.ref("sign"),
              meta: { symbol: sign.symbol, text: sign.text },
            });
            // Persist the player row first so the sign has a row to reference.
            this.persist(client.sessionId);
            this.ledger
              .flush()
              .then(() =>
                this.store.saveSign({
                  id: sign.id,
                  deviceId,
                  symbol: sign.symbol,
                  ownerName: sign.ownerName,
                  text: sign.text,
                  color: sign.color,
                  floor: sign.floor,
                })
              )
              .catch((err) => console.error("[room] saveSign failed:", err?.message ?? err));
          }
        }
      }
    );

    // Publish once up front so the first client to join sees populated boards
    // rather than waiting up to a full refresh interval for them to appear.
    this.publishLeaderboards();

    this.setSimulationInterval(() => this.tick(), TICK_MS);
    // The oracle polls far slower than we tick; republish on its own cadence.
    this.clock.setInterval(() => this.publishOracle(), 2_000);

    // Yield and CHARGE run on real elapsed time so the rate is independent of
    // tick jitter or a stalled event loop.
    this.lastAccrual = Date.now();
    this.clock.setInterval(() => {
      const now = Date.now();
      const elapsed = now - this.lastAccrual;
      this.lastAccrual = now;

      // Both of these now report what is owed rather than crediting it, so
      // every payout lands in the ledger.
      for (const { sessionId, player, earned, bySymbol } of accrue(this.state, elapsed)) {
        const deviceId = this.devices.get(sessionId);
        if (!deviceId) continue;

        /**
         * Yield is split per tower, because the landlord differs per tower.
         * Both legs are posted separately so the ledger still sums exactly to
         * the balance — that invariant is tested and must not drift.
         */
        let royaltiesOwed = 0;
        for (const [symbol, amount] of bySymbol) {
          const { toEarner, royalty, landlord } = this.territory.split(symbol, deviceId, amount);
          if (royalty > 0 && landlord) {
            royaltiesOwed += royalty;
            this.payRoyalty(landlord.deviceId, symbol, royalty);
          }
          void toEarner;
        }

        this.ledger.post(deviceId, player, "floor_yield", earned - royaltiesOwed);
      }

      for (const { sessionId, player, amount } of this.signs.payTraffic(this.state)) {
        const deviceId = this.devices.get(sessionId);
        if (deviceId) this.ledger.post(deviceId, player, "sign_traffic", amount);
      }
    }, 5_000);

    /**
     * Queue every player for the next batched write.
     *
     * This only marks rows dirty — the Ledger's flusher does the I/O on its own
     * timer. The previous implementation wrote each player synchronously here,
     * which stalled the simulation once a minute.
     */
    this.clock.setInterval(() => {
      this.state.players.forEach((_p, sessionId) => this.persist(sessionId));
      this.publishLeaderboards();

      // Control is resolved from the database so it survives the landlord
      // logging off — room state only knows about connected players.
      this.territory
        .refresh(this.state)
        .catch((err) => console.error("[territory] refresh failed:", err?.message ?? err));
    }, 30_000);

    /**
     * Housekeeping for the maps that outlive a connection.
     *
     * `AuthService.sweep` and `ShiftService.sweep` both existed and neither
     * was ever called — the auth one was even documented as the guard against
     * unbounded growth. Expired nonces and lapsed cooldowns are cheap to drop
     * and the alternative is a map that only ever grows.
     */
    this.clock.setInterval(() => {
      this.auth.sweep();
      this.shifts.sweep();
      this.nft.sweep();
    }, 60_000);

    // Emotes are cleared server-side so a disconnect can't leave one stuck
    // above a head forever.
    this.clock.setInterval(() => {
      const now = Date.now();
      this.state.players.forEach((player) => {
        if (player.emote && now - player.emoteAt > EMOTE_MS) player.emote = "";
      });
    }, 1_000);
  }

  /** Exposed for the debug route: fire a storm without waiting for the market. */
  forceStorm(symbol: string) {
    return this.storms.force(this.state, symbol);
  }

  /** Build the static city: districts and one building per ticker. */
  private seedCity() {
    DISTRICTS.forEach((d) => {
      const district = new District();
      district.id = d.id;
      district.name = d.name;
      district.accent = d.accent;
      district.blurb = d.blurb;
      district.cx = d.cx;
      district.cz = d.cz;
      this.state.districts.push(district);
    });

    // Parks are static geometry like districts: pushed once, never updated.
    parkLots().forEach((lot) => {
      const park = new Park();
      park.id = lot.id;
      park.x = lot.x;
      park.z = lot.z;
      park.half = lot.half;
      park.kind = lot.kind;
      park.seed = lot.seed;
      park.district = lot.district;
      this.state.parks.push(park);
    });

    TICKERS.forEach((t) => {
      const { x, z } = layoutFor(t);
      const ticker = new Ticker();
      ticker.symbol = t.symbol;
      ticker.label = t.label;
      ticker.district = t.district;
      ticker.alwaysOn = t.alwaysOn;
      ticker.x = x;
      ticker.z = z;
      this.state.tickers.set(t.symbol, ticker);
    });
  }

  /**
   * Rebuild persistent world state at boot: how many floors are leased in each
   * tower (including by players who are offline) and every sign ever placed.
   */
  private async restoreWorld() {
    const totals = await this.store.floorTotals();
    for (const [symbol, count] of Object.entries(totals)) {
      const ticker = this.state.tickers.get(symbol);
      if (ticker) ticker.ownedFloors = count;
    }

    for (const saved of await this.store.allSigns()) {
      const sign = new Sign();
      sign.id = saved.id;
      sign.symbol = saved.symbol;
      sign.ownerName = saved.ownerName;
      sign.text = saved.text;
      sign.color = saved.color;
      sign.floor = saved.floor;
      this.state.signs.set(sign.id, sign);
    }
  }

  /**
   * Resolve and apply the player's NFT tier.
   *
   * Fire-and-forget on purpose: joining must never wait on an RPC round trip or
   * a metadata gateway. Until it resolves the player is an ordinary resident,
   * which is exactly what they were a moment earlier.
   *
   * Nothing here trusts the client. The wallet has already been proved by
   * signature, and the tier comes from a chain read against that address.
   */
  private applyTier(sessionId: string, wallet: string) {
    const deviceId = this.devices.get(sessionId);
    this.nft
      .holdingFor(wallet)
      .then(async (holding) => {
        const player = this.state.players.get(sessionId);
        if (player) {
          player.tier = holding.tier;
          player.traits = holding.traits;
          player.penthouse = holding.tower ?? "";
        }
        // Persist even if they left mid-flight: the penthouse timestamp is what
        // territory reads, and it should reflect the check we actually did.
        if (deviceId) await this.nft.persist(deviceId, holding);
      })
      .catch((err) => console.warn("[nft] tier resolution failed:", err?.message ?? err));
  }

  /** Reflect a crew change on the player so others see the tag immediately. */
  private applyCrew(sessionId: string, tag: string, color: string) {
    const player = this.state.players.get(sessionId);
    if (!player) return;
    player.crewTag = tag;
    player.crewColor = color;
  }

  /**
   * Push the player's own crew details to them.
   *
   * The tag and colour are replicated on the Player schema because everyone
   * needs to see them; membership counts and pooled holdings are only ever
   * shown to the member, so they travel as a message instead of bloating state
   * that every client in the room receives.
   */
  private sendCrew(client: Client, deviceId: string) {
    this.crews
      .forDevice(deviceId)
      .then((crew) => {
        if (!client) return;
        client.send(
          "crewState",
          crew
            ? {
                name: crew.name,
                tag: crew.tag,
                color: crew.color,
                members: crew.members,
                floors: crew.floors,
                isLeader: crew.leaderDevice === deviceId,
              }
            : null
        );
      })
      .catch((err) => console.error("[room] crewState failed:", err?.message ?? err));
  }

  /**
   * Pull a player's balance and floors back out of the database into live room
   * state, by device rather than session.
   *
   * Needed wherever money or floors move in SQL instead of through the Ledger —
   * the market is the only such path today. Doing nothing when the device isn't
   * in this room is the correct outcome, not a failure: an offline player has
   * no memory state to correct, and will load the settled values on next join.
   */
  private async reloadPlayer(deviceId: string) {
    let sessionId = "";
    this.devices.forEach((device, session) => {
      if (device === deviceId) sessionId = session;
    });
    if (!sessionId) return;

    const player = this.state.players.get(sessionId);
    if (!player) return;

    const saved = await this.store.loadPlayer(deviceId);
    if (!saved) return;

    player.block = saved.block;
    player.floors.clear();
    for (const [symbol, count] of Object.entries(saved.floors)) {
      if (count > 0) player.floors.set(symbol, count);
    }
  }

  /** Mirror open listings into replicated state. */
  private async publishMarket() {
    const open = await this.market.open();
    const seen = new Set<string>();

    for (const item of open) {
      const key = String(item.id);
      seen.add(key);
      let row = this.state.listings.get(key);
      if (!row) {
        const created = new Listing();
        this.state.listings.set(key, created);
        row = created;
      }
      row.id = item.id;
      row.symbol = item.symbol;
      row.price = item.price;
      row.sellerName = item.sellerName;
      row.sellerDevice = item.sellerDevice;
    }

    this.state.listings.forEach((_row, key) => {
      if (!seen.has(key)) this.state.listings.delete(key);
    });
  }

  /**
   * Recompute per-tower occupancy from the database.
   *
   * A trade moves a floor between two players, one of whom may be offline, so
   * the aggregate cannot be derived from room state alone.
   */
  private async refreshOwnedFloors() {
    const totals = await this.store.floorTotals();
    this.state.tickers.forEach((ticker, symbol) => {
      ticker.ownedFloors = totals[symbol] ?? 0;
    });
  }

  /**
   * Pay a landlord their cut.
   *
   * If they're online their in-memory balance is updated so they see it
   * immediately; if not, it goes through the detached path and lands as an SQL
   * increment. Either way exactly one ledger row is written, so the
   * balance-equals-ledger invariant holds regardless of who is connected.
   */
  private payRoyalty(landlordDeviceId: string, symbol: string, amount: number) {
    if (amount <= 0 || !landlordDeviceId) return;

    for (const [sessionId, deviceId] of this.devices) {
      if (deviceId !== landlordDeviceId) continue;
      const player = this.state.players.get(sessionId);
      if (player) {
        this.ledger.post(landlordDeviceId, player, "landlord_royalty", amount, {
          meta: { symbol },
        });
        return;
      }
    }

    this.ledger.postDetached(landlordDeviceId, "landlord_royalty", amount, { symbol });
  }

  /**
   * Queue a player's current state for the next batched write.
   *
   * Nothing touches the database here — this is called from message handlers on
   * the game loop, and the previous synchronous implementation stalled the
   * simulation. The Ledger's flusher drains everything a few seconds later in
   * one transaction.
   */
  private persist(sessionId: string) {
    const player = this.state.players.get(sessionId);
    const deviceId = this.devices.get(sessionId);
    if (!player || !deviceId) return;

    this.ledger.markPlayer({
      deviceId,
      wallet: player.wallet || null,
      name: player.name,
      color: player.color,
      block: player.block,
      charge: player.charge,
      shards: player.shards,
      x: player.x,
      z: player.z,
    });

    const floors = new Map<string, number>();
    player.floors.forEach((count: number, symbol: string) => floors.set(symbol, count));
    this.ledger.markFloors(deviceId, floors);
  }

  /**
   * Copy the cached leaderboards into replicated state.
   *
   * Reads the in-memory snapshot the Leaderboards service refreshes on its own
   * timer — no query happens here, so this is safe on the game loop.
   */
  private publishLeaderboards() {
    const season = this.boards.currentSeason;
    this.state.seasonLabel = season.label;

    const next: BoardEntry[] = [];
    for (const board of BOARDS) {
      for (const row of this.boards.top(board.id, 10)) {
        const entry = new BoardEntry();
        entry.board = board.id;
        entry.rank = row.rank;
        entry.name = row.name;
        entry.wallet = row.wallet ?? "";
        entry.score = Math.round(row.score * 100) / 100;
        entry.detail = row.detail;
        next.push(entry);
      }
    }

    // Replace wholesale: patching in place would leave stale ranks behind when
    // somebody drops off a board entirely.
    this.state.boards.clear();
    for (const entry of next) this.state.boards.push(entry);
  }

  /** Copy the latest oracle snapshot into replicated state. */
  private publishOracle() {
    const snap = this.poller.current;
    this.state.phase = snap.phase;
    this.state.marketMood = round(snap.marketMood, 4);
    this.state.peakVolatility = round(snap.peakVolatility, 6);
    this.state.peakSymbol = snap.peakSymbol;
    this.state.oracleOk = snap.lastPollOk;
    this.state.oracleAt = snap.lastPollAt;

    snap.readings.forEach((reading, symbol) => {
      const ticker = this.state.tickers.get(symbol);
      if (!ticker) return;
      ticker.price = round(reading.price, 4);
      ticker.changePct = round(reading.changePct, 4);
      ticker.volatility = round(reading.volatility, 6);
      ticker.height = round(reading.height, 3);
      ticker.frozen = reading.frozen;
      ticker.updatedAt = reading.updatedAt;
    });

    // Floor price and yield tier move with the market, so recompute alongside.
    refreshTickerEconomics(this.state);

    // A real volatility spike is what summons a storm.
    this.storms.maybeTrigger(this.state, snap.peakSymbol, snap.peakVolatility);
  }

  private tick() {
    this.state.serverTime = Date.now();

    this.state.players.forEach((player, sessionId) => {
      const queue = this.queues.get(sessionId);
      if (!queue || queue.length === 0) {
        player.anim = "idle";
        return;
      }

      // Consume up to the per-tick cap, each command advancing exactly one
      // fixed step — identical to what the client predicted locally.
      const budget = Math.min(queue.length, MAX_CMDS_PER_TICK);
      let moved = false;
      let running = false;
      for (let i = 0; i < budget; i++) {
        const cmd = queue[i];
        const didMove = applyInput(player, cmd, SIM_DT);
        moved = moved || didMove;
        running = running || (didMove && cmd.run);
        player.lastSeq = cmd.seq;
      }
      // Drop anything above the cap rather than letting it bank up as speed.
      queue.length = 0;

      player.anim = moved ? (running ? "run" : "walk") : "idle";
    });

    // Shard pickup runs on the movement tick so it feels immediate, and is
    // resolved server-side so two runners can never claim the same shard.
    const claims = this.storms.collect(this.state);
    for (const claim of claims) {
      const client = this.clients.find((c) => c.sessionId === claim.sessionId);
      client?.send("shardsCollected", claim.count);

      // storms.collect() already credited the in-memory shard count; record it
      // against the season so the runners board can rank it.
      const deviceId = this.devices.get(claim.sessionId);
      const player = this.state.players.get(claim.sessionId);
      if (deviceId && player) {
        this.ledger.postShards(deviceId, { block: player.block, shards: 0 }, claim.count);
      }
      this.persist(claim.sessionId);
    }
  }

  async onJoin(client: Client, options?: { deviceId?: string; privyToken?: string }) {
    const player = new Player();
    const angle = Math.random() * Math.PI * 2;
    const radius = 6 + Math.random() * 10;
    player.x = Math.cos(angle) * radius;
    player.z = Math.sin(angle) * radius;
    player.y = 0;
    player.yaw = -angle;
    player.color = PALETTE[this.state.players.size % PALETTE.length];
    player.name = `Trader${Math.floor(1000 + Math.random() * 9000)}`;

    // Put them in the world before any awaiting, so a slow database never
    // delays a join. Saved values are applied over the defaults below.
    this.state.players.set(client.sessionId, player);
    this.queues.set(client.sessionId, []);

    const guestId = typeof options?.deviceId === "string" ? options.deviceId.slice(0, 64) : "";

    /**
     * A verified Privy account outranks the guest id.
     *
     * The token is checked server-side — a client simply claiming a DID proves
     * nothing. On success the account's existing save wins if it has one,
     * otherwise the current guest row is adopted so nothing earned before
     * logging in is lost.
     */
    let deviceId = guestId;
    if (options?.privyToken && this.privy.enabled) {
      const identity = await this.privy.verify(options.privyToken);
      if (identity) {
        deviceId = await linkPrivyAccount(this.db, identity, guestId || `privy:${identity.did}`);
        player.wallet = identity.embeddedWallet ?? identity.wallets[0] ?? "";
        if (identity.email) player.name = identity.email.split("@")[0].slice(0, 16);
      }
    }

    if (!deviceId) {
      initPlayerEconomy(player);
      return;
    }

    this.devices.set(client.sessionId, deviceId);
    const saved = await this.store.loadPlayer(deviceId);

    // They may have disconnected while we were loading.
    if (!this.state.players.has(client.sessionId)) return;

    if (saved) {
      player.wallet = saved.wallet ?? "";
      // A wallet restored from a save was proved by signature when it was first
      // linked, so re-resolving its tier here is honest. It also re-stamps the
      // penthouse timestamp, which is how an absent holder eventually loses it.
      if (player.wallet) this.applyTier(client.sessionId, player.wallet);
      player.name = saved.name || player.name;
      player.color = saved.color || player.color;
      player.block = saved.block;
      player.charge = Math.min(CHARGE_MAX, saved.charge);
      player.shards = saved.shards;
      player.x = saved.x;
      player.z = saved.z;
      for (const [symbol, count] of Object.entries(saved.floors)) {
        if (count > 0) player.floors.set(symbol, count);
      }

      // Restore crew identity so the tag shows immediately on join.
      const crew = await this.crews.forDevice(deviceId);
      if (crew) {
        player.crewTag = crew.tag;
        player.crewColor = crew.color;
      }
      this.sendCrew(client, deviceId);

      // Re-link any signs this device owns so traffic pays the right person.
      for (const sign of await this.store.allSigns()) {
        if (sign.deviceId === deviceId) this.signs.adopt(sign.id, client.sessionId);
      }
    } else {
      // A genuinely new player. The opening grant is recorded like any other
      // movement of currency rather than being conjured onto the balance.
      initPlayerEconomy(player);
      player.block = 0;
      this.ledger.post(deviceId, player, "signup_grant", STARTING_BLOCK, {
        ref: `signup:${deviceId}`,
      });
    }

    this.persist(client.sessionId);
  }

  onLeave(client: Client) {
    // Save before dropping them from state, or there is nothing left to save.
    this.persist(client.sessionId);
    this.shifts.abandon(client.sessionId);
    this.signs.release(client.sessionId);
    this.auth.release(client.sessionId);
    this.chat.release(client.sessionId);
    this.state.players.delete(client.sessionId);
    this.queues.delete(client.sessionId);
    this.devices.delete(client.sessionId);
  }
}

/**
 * Integrate one input command. Shared in spirit with the client's predictor —
 * both must apply identical maths or reconciliation will fight the player.
 */
export function applyInput(
  target: { x: number; z: number; yaw: number },
  cmd: InputCommand,
  dt: number
): boolean {
  let dx = 0;
  let dz = 0;
  if (cmd.up) dz -= 1;
  if (cmd.down) dz += 1;
  if (cmd.left) dx -= 1;
  if (cmd.right) dx += 1;

  if (dx === 0 && dz === 0) return false;

  const len = Math.hypot(dx, dz);
  dx /= len;
  dz /= len;

  // Movement is relative to where the camera is pointing.
  const sin = Math.sin(cmd.yaw);
  const cos = Math.cos(cmd.yaw);
  const worldX = dx * cos - dz * sin;
  const worldZ = dx * sin + dz * cos;

  const speed = cmd.run ? RUN_SPEED : WALK_SPEED;
  target.x = clamp(target.x + worldX * speed * dt, -WORLD_LIMIT, WORLD_LIMIT);
  target.z = clamp(target.z + worldZ * speed * dt, -WORLD_LIMIT, WORLD_LIMIT);
  target.yaw = Math.atan2(worldX, worldZ);
  return true;
}

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

function round(v: number, dp: number) {
  const f = 10 ** dp;
  return Math.round(v * f) / f;
}
