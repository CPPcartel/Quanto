import type { CityState, Player } from "../rooms/schema/CityState.js";
import type { Db } from "../db/db.js";
import { SpatialGrid } from "./spatial.js";

/**
 * Chat and emotes.
 *
 * Proximity-first: you hear people standing near you, plus a channel for the
 * district you're in. There is deliberately no global channel — it is the one
 * that needs moderation on day one, and a city where every message reaches
 * everyone stops feeling like a place.
 *
 * Everything here treats the sender as hostile until proven otherwise: length
 * is capped, rate is limited, repeats are dropped, and the text is sanitised
 * before it can reach another player's screen.
 */

/** How far a proximity message carries, in world units. */
export const CHAT_RANGE = 45;

const MAX_LEN = 200;
/** A player may not send the same text twice within this window. */
const REPEAT_MS = 20_000;

export type Channel = "local" | "district";

export interface ChatMessage {
  from: string;
  name: string;
  color: string;
  crewTag: string;
  text: string;
  channel: Channel;
  at: number;
}

export const EMOTES = ["wave", "point", "laugh", "shrug", "dance", "think"] as const;
export type Emote = (typeof EMOTES)[number];

/** How long an emote shows above a head before the server clears it. */
export const EMOTE_MS = 4000;

/**
 * Character classes are built with `new RegExp` from ASCII-only source rather
 * than written as regex literals.
 *
 * A literal range like /[<control chars>]/ requires putting real control bytes
 * in this file, which makes it a binary blob to git and to every editor, and
 * one careless save silently corrupts the filter. These stay readable.
 */
/*
 * Whitespace-like controls (tab, newline, carriage return) become a space
 * rather than being deleted. Deleting them merges the words either side —
 * "a<tab>b" would arrive as "ab" — which both mangles the message and offers a
 * way to smuggle a different string past a human reading the logs.
 */
const WHITESPACE_CONTROLS = new RegExp("[\\u0009-\\u000D]", "g");
// Everything else in C0/C1 is simply removed.
const CONTROL_CHARS = new RegExp("[\\u0000-\\u001F\\u007F-\\u009F]", "g");
// Zero-width characters and bidirectional overrides: invisible, and the bidi
// ones can visually reverse text to impersonate another player's name.
const INVISIBLE_CHARS = new RegExp(
  "[\\u200B-\\u200F\\u202A-\\u202E\\u2066-\\u2069\\uFEFF]",
  "g"
);
const WHITESPACE_RUN = /\s+/g;

/**
 * Rate limiting is a token bucket, not an escalating penalty.
 *
 * An escalating scheme punishes exactly the wrong person: a burst raises the
 * penalty, which makes the next attempt more likely to be blocked, which raises
 * it again — one fumbled double-send could throttle somebody for a minute,
 * while a determined flooder just waits it out anyway.
 *
 * A bucket instead allows natural conversation, including short bursts, and
 * puts a hard ceiling on sustained throughput. Recovery is always predictable:
 * one more message per REFILL_MS, no memory of past behaviour.
 */
interface Recent {
  lastText: string;
  lastTextAt: number;
  /** Fractional messages available right now. */
  tokens: number;
  refilledAt: number;
}

/** Messages that may be sent back-to-back. */
const BURST = 4;
/** One token returns per this long. */
const REFILL_MS = 900;

export class ChatService {
  private recent = new Map<string, Recent>();

  constructor(private db: Db) {}

  /**
   * Validate and normalise an incoming message.
   * Returns null when it should be silently dropped.
   */
  accept(sessionId: string, raw: unknown): { text: string; channel: Channel } | null {
    if (typeof raw !== "object" || raw === null) return null;
    const body = raw as { text?: unknown; channel?: unknown };

    const text = sanitise(String(body.text ?? ""));
    if (!text) return null;

    const channel: Channel = body.channel === "district" ? "district" : "local";

    const now = Date.now();
    const state = this.recent.get(sessionId) ?? {
      lastText: "",
      lastTextAt: 0,
      tokens: BURST,
      refilledAt: now,
    };

    // Refill for the time that has passed, capped at the burst size.
    state.tokens = Math.min(BURST, state.tokens + (now - state.refilledAt) / REFILL_MS);
    state.refilledAt = now;

    if (state.tokens < 1) {
      this.recent.set(sessionId, state);
      return null;
    }

    // The same line twice running is spam, and it's the shape almost all chat
    // flooding takes. It still costs a token, so repeating cannot be free.
    if (text === state.lastText && now - state.lastTextAt < REPEAT_MS) {
      state.tokens -= 1;
      this.recent.set(sessionId, state);
      return null;
    }

    state.tokens -= 1;
    state.lastText = text;
    state.lastTextAt = now;
    this.recent.set(sessionId, state);

    return { text, channel };
  }

  /**
   * Who should receive this message.
   *
   * Local messages go through the spatial grid rather than scanning every
   * player, so chat doesn't become quadratic in a busy city.
   */
  audience(state: CityState, senderId: string, channel: Channel): string[] {
    const sender = state.players.get(senderId);
    if (!sender) return [];

    if (channel === "district") {
      const district = districtAt(state, sender.x, sender.z);
      const out: string[] = [];
      state.players.forEach((p: Player, id: string) => {
        if (districtAt(state, p.x, p.z) === district) out.push(id);
      });
      return out;
    }

    const grid = new SpatialGrid<string>(CHAT_RANGE);
    state.players.forEach((p: Player, id: string) => grid.insert(id, p.x, p.z));

    const out: string[] = [];
    for (const id of grid.near(sender.x, sender.z)) {
      const p = state.players.get(id);
      if (!p) continue;
      if (Math.hypot(p.x - sender.x, p.z - sender.z) <= CHAT_RANGE) out.push(id);
    }
    return out;
  }

  /**
   * Record the message.
   *
   * Fire-and-forget: chat must never wait on the database. Kept because you
   * cannot moderate what you did not record, and a report three days later is
   * unanswerable without it.
   */
  log(deviceId: string, msg: ChatMessage, x: number, z: number) {
    this.db
      .query(
        `INSERT INTO chat_log (device_id, name, channel, text, x, z)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [deviceId, msg.name, msg.channel, msg.text, x, z]
      )
      .catch((err) => console.error("[chat] log failed:", err?.message ?? err));
  }

  release(sessionId: string) {
    this.recent.delete(sessionId);
  }
}

/** Strip anything that could break rendering or impersonate another player. */
export function sanitise(input: string): string {
  return input
    .replace(WHITESPACE_CONTROLS, " ")
    .replace(CONTROL_CHARS, "")
    .replace(INVISIBLE_CHARS, "")
    .replace(WHITESPACE_RUN, " ")
    .trim()
    .slice(0, MAX_LEN);
}

export function isEmote(value: unknown): value is Emote {
  return typeof value === "string" && (EMOTES as readonly string[]).includes(value);
}

/**
 * How close you must be to a district centre to count as being in it.
 *
 * Without this bound, "nearest district" assigns everyone to *something* —
 * including people standing together in the central plaza, who are roughly
 * equidistant from all four. Two players a few paces apart were landing in
 * different district channels and silently not hearing each other.
 */
const DISTRICT_RADIUS = 105;

/** Everywhere that isn't a district: the plaza and the streets between. */
const DOWNTOWN = "downtown";

/** Which district channel a position belongs to. */
function districtAt(state: CityState, x: number, z: number): string {
  let best = DOWNTOWN;
  let bestDist = DISTRICT_RADIUS;
  state.districts.forEach((d) => {
    const dist = Math.hypot(d.cx - x, d.cz - z);
    if (dist < bestDist) {
      bestDist = dist;
      best = d.id;
    }
  });
  return best;
}
