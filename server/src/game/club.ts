import type { CityState, Player } from "../rooms/schema/CityState.js";
import { insideClub } from "../config/parks.js";

/**
 * The Vault — featured events and occupancy.
 *
 * Events fire from real market moments rather than a calendar. That is not a
 * shortcut: it means the reason to show up is the same thing the whole game is
 * about, and it needs no scheduling infrastructure because the triggers are
 * already in replicated state.
 *
 * Modelled on StormService: a duration, an end timestamp the client can count
 * down against, and a check on a slow tick. Nothing here pays anything out —
 * the club writes no ledger rows at all, which is what keeps a holders-only
 * space cosmetic rather than an earnings advantage.
 */

export type ClubEvent = "closing_bell" | "storm_rave" | "season_party" | "";

const DURATION_MS: Record<Exclude<ClubEvent, "">, number> = {
  closing_bell: 20 * 60 * 1000,
  storm_rave: 3 * 60 * 1000,
  season_party: 30 * 60 * 1000,
};

/** Shown on the banner. Deliberately short — it sits over the city. */
export const EVENT_LABEL: Record<Exclude<ClubEvent, "">, string> = {
  closing_bell: "Closing Bell",
  storm_rave: "Storm Rave",
  season_party: "Season Party",
};

export class ClubService {
  /** Previous market phase, so the closing bell fires on the transition only. */
  private lastPhase = "";
  /** Previous storm symbol, for the same reason. */
  private lastStorm = "";
  private lastSeasonLabel = "";
  /** Set on the first tick so a server restart mid-session is not a "close". */
  private primed = false;

  /**
   * Advance the club. Called on the same slow interval as the emote sweep.
   *
   * Returns the event that just started, if any, so the room can announce it.
   */
  tick(state: CityState, seasonLabel: string): ClubEvent {
    const now = Date.now();

    if (state.clubEvent && now >= state.clubEndsAt) {
      state.clubEvent = "";
      state.clubEndsAt = 0;
    }

    state.clubInside = this.occupancy(state);

    /**
     * Prime on the first tick rather than firing.
     *
     * Without this, every server restart outside market hours would read as a
     * fresh open-to-closed transition and throw a Closing Bell party nobody
     * arrived for — and a restart loop would throw one every few seconds.
     */
    if (!this.primed) {
      this.primed = true;
      this.lastPhase = state.phase;
      this.lastStorm = state.stormSymbol;
      this.lastSeasonLabel = seasonLabel;
      state.clubIntensity = this.intensity(state);
      return "";
    }

    const phase = state.phase;
    const storm = state.stormSymbol;

    let started: ClubEvent = "";

    // A storm outranks the bell: it is rarer and it is already happening.
    if (storm && storm !== this.lastStorm) {
      started = "storm_rave";
    } else if (seasonLabel && seasonLabel !== this.lastSeasonLabel) {
      started = "season_party";
    } else if (phase === "closed" && this.lastPhase === "open") {
      started = "closing_bell";
    }

    this.lastPhase = phase;
    this.lastStorm = storm;
    this.lastSeasonLabel = seasonLabel;

    if (started) {
      state.clubEvent = started;
      state.clubEndsAt = now + DURATION_MS[started];
    }

    /**
     * Intensity last, after the event is assigned.
     *
     * Computing it earlier read the PREVIOUS event, so the room stayed at its
     * old level for a full second after a rave began — the music and the floor
     * lagged the announcement by a beat, which is exactly the moment they
     * should be loudest.
     */
    state.clubIntensity = this.intensity(state);

    return started;
  }

  /** How many players are in the venue right now. */
  private occupancy(state: CityState): number {
    let n = 0;
    state.players.forEach((p: Player) => {
      if (insideClub(p.x, p.z)) n++;
    });
    return n;
  }

  /**
   * How hard the room is running, 0..1.
   *
   * Drives the dance floor and the music tempo on the client. Built from state
   * that already exists — the mean tape and the peak volatility — so the club
   * reacts to the real market without computing anything new.
   */
  private intensity(state: CityState): number {
    if (state.clubEvent === "storm_rave") return 1;

    // Volatility is the main driver; the tape's absolute move adds a little.
    const vol = Math.min(1, state.peakVolatility / 0.004);
    const mood = Math.min(1, Math.abs(state.marketMood) / 0.6);
    const base = 0.28 + vol * 0.55 + mood * 0.17;

    // Any event lifts the floor, so an empty market still feels like a night out.
    return Math.min(1, state.clubEvent ? Math.max(base, 0.7) : base);
  }
}
