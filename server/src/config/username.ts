/**
 * What a username may be.
 *
 * A name used to be decoration. It now identifies somebody on a leaderboard that
 * can decide a prize, appears above their head in a shared city, and is how
 * other players address them — so the rules here are about impersonation and
 * legibility rather than taste.
 *
 * The client mirrors these for immediate feedback, but this is the authority.
 * Anything the client does is a courtesy to the person typing.
 */

export const NAME_MIN = 3;
export const NAME_MAX = 16;

/**
 * Letters, digits, underscore and hyphen, and it must start and end with a
 * letter or digit.
 *
 * Leading and trailing separators are excluded because "___alice" and "alice"
 * read as the same person at a glance in chat, which is the whole problem
 * usernames exist to avoid. Spaces are excluded for the same reason: trailing
 * whitespace is invisible and doubles every name.
 */
const SHAPE = /^[a-zA-Z0-9][a-zA-Z0-9_-]{1,14}[a-zA-Z0-9]$/;

/**
 * Names nobody may hold.
 *
 * Impersonating staff or the game itself is the cheap attack: "Quanto Support"
 * asking for a wallet signature works far more often than it should. Matched
 * case-insensitively, and as whole names rather than substrings so "moderator"
 * is blocked while "moderately" is fine.
 */
const RESERVED = new Set([
  "admin",
  "administrator",
  "mod",
  "moderator",
  "staff",
  "support",
  "help",
  "helpdesk",
  "system",
  "server",
  "official",
  "team",
  "quanto",
  "quantoteam",
  "quantosupport",
  "block",
  "everyone",
  "here",
  "null",
  "undefined",
  "anonymous",
  "guest",
  "deleted",
  "bot",
]);

/**
 * Sequences that look like a name but are not one.
 *
 * "Trader" is how the server names an unclaimed player, so letting anyone claim
 * "Trader4821" would let them impersonate a specific stranger.
 */
const RESERVED_PREFIX = ["trader", "quanto", "admin", "mod"];

export type NameCheck = { ok: true; name: string } | { ok: false; reason: string };

/**
 * Validate and normalise a submitted username.
 *
 * Returns the exact string to store, preserving the capitalisation the player
 * chose. Only the uniqueness comparison is case-insensitive — somebody who types
 * "AliceInChains" should see that back, not "aliceinchains".
 */
export function checkUsername(raw: unknown): NameCheck {
  if (typeof raw !== "string") return { ok: false, reason: "Pick a name." };

  const name = raw.trim();
  if (name.length === 0) return { ok: false, reason: "Pick a name." };
  if (name.length < NAME_MIN) return { ok: false, reason: `At least ${NAME_MIN} characters.` };
  if (name.length > NAME_MAX) return { ok: false, reason: `At most ${NAME_MAX} characters.` };

  if (!SHAPE.test(name)) {
    return {
      ok: false,
      reason: "Letters, numbers, - and _ only, starting and ending with a letter or number.",
    };
  }

  const lower = name.toLowerCase();
  if (RESERVED.has(lower)) return { ok: false, reason: "That name is reserved." };

  for (const prefix of RESERVED_PREFIX) {
    // A bare prefix is only reserved when followed by something, so "Modest" is
    // fine and "Mod_Alice" is not.
    if (lower.startsWith(prefix) && lower.length > prefix.length) {
      const rest = lower.slice(prefix.length);
      if (/^[0-9_-]/.test(rest)) return { ok: false, reason: "That name is reserved." };
    }
  }

  return { ok: true, name };
}

/**
 * How long between changes.
 *
 * Long enough that a name means something for the length of a season, short
 * enough that a typo is not permanent. The specific risk is renaming to match a
 * rival just before a season closes, which a week comfortably outlasts.
 */
export const RENAME_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

/** When may this player rename again? 0 means now. */
export function renameAvailableAt(lastSetAt: string | Date | null): number {
  if (!lastSetAt) return 0;
  const last = new Date(lastSetAt).getTime();
  if (!isFinite(last)) return 0;
  return last + RENAME_COOLDOWN_MS;
}
