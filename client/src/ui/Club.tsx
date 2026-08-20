import { useEffect, useState, useSyncExternalStore } from "react";
import { world, subscribeUi, getUiVersion } from "../net/world";
import { clubAudio } from "../pixi/audio";
import { CLUB_FALLOFF } from "../pixi/clubZone";

/**
 * The Vault's HUD: the event banner, the door message and the mute toggle.
 *
 * The banner is shown to EVERYONE, holder or not. That is the entire mechanism
 * of a gated venue — a guest reading "Closing Bell at The Vault, 18 inside" is
 * the reason the club is worth building. Hiding it from non-holders would make
 * the club invisible and therefore pointless.
 */

const EVENT_LABEL: Record<string, string> = {
  closing_bell: "Closing Bell",
  storm_rave: "Storm Rave",
  season_party: "Season Party",
};

const EVENT_BLURB: Record<string, string> = {
  closing_bell: "the market just shut",
  storm_rave: "volatility is spiking",
  season_party: "a new season begins",
};

export function ClubBanner() {
  useSyncExternalStore(subscribeUi, getUiVersion);
  const [left, setLeft] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setLeft(Math.max(0, world.clubEndsAt - Date.now())), 500);
    return () => clearInterval(id);
  }, []);

  if (!world.clubEvent || left <= 0) return null;

  const mins = Math.floor(left / 60000);
  const secs = Math.floor((left % 60000) / 1000);
  const holder = world.localTier && world.localTier !== "none";

  return (
    <div className="hud club-banner">
      <div className="panel club-panel">
        <div className="row space">
          <span className="wallet-label club-live">◆ LIVE AT THE VAULT</span>
          <span className="mono tiny dim">
            {mins}:{String(secs).padStart(2, "0")}
          </span>
        </div>
        <p className="club-event">{EVENT_LABEL[world.clubEvent] ?? "Event"}</p>
        <p className="dim tiny club-blurb">
          {EVENT_BLURB[world.clubEvent] ?? ""} · {world.clubInside}{" "}
          {world.clubInside === 1 ? "person" : "people"} inside
        </p>
        {!holder && (
          <p className="dim tiny club-locked">
            Holders only — a coin or a Residents NFT gets you past the rope.
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * Shown when a non-holder walks into the rope.
 *
 * Appears on proximity rather than on a failed step: the movement code refuses
 * the move silently, so without this the player would just feel stuck and have
 * no idea why. Saying it plainly is the difference between a door and a bug.
 */
export function ClubDoor() {
  useSyncExternalStore(subscribeUi, getUiVersion);
  const [near, setNear] = useState(false);

  useEffect(() => {
    const id = setInterval(() => {
      const club = world.parks.find((p) => p.kind === "club");
      if (!club) {
        setNear(false);
        return;
      }
      const d = Math.max(
        Math.abs(world.local.x - club.x) - club.half,
        Math.abs(world.local.z - club.z) - club.half
      );
      setNear(d < 6);
    }, 200);
    return () => clearInterval(id);
  }, []);

  const holder = world.localTier && world.localTier !== "none";
  if (!near || holder) return null;

  return (
    <div className="hud club-door">
      <div className="panel compact">
        <p className="club-door-title">The Vault · holders only</p>
        <p className="dim tiny">
          Hold the coin or a Quanto Residents NFT, connect that wallet, and the rope
          comes down. Everything else in the city stays open to you either way.
        </p>
      </div>
    </div>
  );
}

/**
 * Mute toggle, shown only when the music could actually be heard.
 *
 * A permanent audio control for a game that is silent almost everywhere would
 * be clutter; near the venue it is the first thing someone reaches for.
 */
export function ClubAudioToggle() {
  const [, force] = useState(0);
  const [near, setNear] = useState(false);

  useEffect(() => {
    const id = setInterval(() => {
      const club = world.parks.find((p) => p.kind === "club");
      if (!club) {
        setNear(false);
        return;
      }
      const d = Math.hypot(world.local.x - club.x, world.local.z - club.z);
      setNear(d - club.half < CLUB_FALLOFF);
    }, 400);
    return () => clearInterval(id);
  }, []);

  if (!near) return null;

  return (
    <div className="hud club-audio">
      <button
        className="crew-chip"
        onClick={() => {
          clubAudio.toggle();
          force((n) => n + 1);
        }}
        title={clubAudio.isEnabled ? "Mute the club" : "Unmute the club"}
      >
        <span className="mono">{clubAudio.isEnabled ? "♪ ON" : "♪ OFF"}</span>
      </button>
    </div>
  );
}
