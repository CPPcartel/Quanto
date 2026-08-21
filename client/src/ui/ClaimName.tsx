import { useEffect, useMemo, useRef, useState } from "react";
import { useSyncExternalStore } from "react";
import { world, subscribeUi, getUiVersion } from "../net/world";
import { checkName, claimName } from "../net/connection";

/**
 * Claiming a name, before the city.
 *
 * Every resident should have a name they chose. "Trader4821" is what the server
 * calls somebody it knows nothing about, and a city full of them reads as empty
 * — nobody talks to a number. So this is a gate rather than a setting: one
 * screen, one decision, and then you are in.
 *
 * It renders over the city rather than instead of it, for the same reason the
 * sign-in wall does: the skyline drawing behind is a better argument for
 * finishing than a blank page.
 */

const MIN = 3;
const MAX = 16;

/**
 * A local mirror of the server's rule, for immediate feedback only.
 *
 * The server is the authority and re-checks everything. This exists so the
 * field can go red as somebody types instead of after a round trip, and it is
 * deliberately the shape check only — reserved names and collisions are the
 * server's answer to give.
 */
const SHAPE = /^[a-zA-Z0-9][a-zA-Z0-9_-]{1,14}[a-zA-Z0-9]$/;

function localProblem(name: string): string {
  if (name.length === 0) return "";
  if (name.length < MIN) return `At least ${MIN} characters.`;
  if (name.length > MAX) return `At most ${MAX} characters.`;
  if (!SHAPE.test(name)) return "Letters, numbers, - and _ only.";
  return "";
}

export function ClaimName({ onDone }: { onDone?: () => void }) {
  useSyncExternalStore(subscribeUi, getUiVersion);
  const [name, setName] = useState("");
  const [touched, setTouched] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    input.current?.focus();
  }, []);

  const problem = localProblem(name.trim());

  /**
   * Ask the server whether it is free, but not on every keystroke.
   *
   * Debounced because a name is typed a character at a time and each character
   * is not a question worth asking. Skipped entirely while the shape is wrong,
   * since the answer would be about the shape rather than availability.
   */
  useEffect(() => {
    const trimmed = name.trim();
    if (!trimmed || problem) return;
    const id = setTimeout(() => checkName(trimmed), 320);
    return () => clearTimeout(id);
  }, [name, problem]);

  const check = world.nameCheck;
  const claim = world.nameClaim;

  /** Only trust an answer that is about the name currently in the box. */
  const verdict = useMemo(() => {
    const trimmed = name.trim();
    if (!trimmed) return null;
    if (problem) return { ok: false, reason: problem };
    if (claim && claim.ok === false) return { ok: false, reason: claim.reason ?? "" };
    if (check && check.name.toLowerCase() === trimmed.toLowerCase()) return check;
    return null;
  }, [name, problem, check, claim]);

  // The server confirming a claim is the only thing that closes this.
  useEffect(() => {
    if (world.localNameClaimed) onDone?.();
  }, [world.localNameClaimed, onDone]);

  const canSubmit = Boolean(name.trim()) && !problem && verdict?.ok === true;

  const submit = () => {
    setTouched(true);
    if (!canSubmit) return;
    claimName(name.trim());
  };

  return (
    <div className="overlay center signin-wall">
      <div className="panel signin-panel">
        <span className="wallet-label">QUANTO</span>

        <h2 className="signin-title">Claim your name</h2>

        <p className="dim signin-copy">
          This is what the city calls you: above your head on the street, on the
          leaderboard, and on any tower you come to own.
        </p>

        <div className="claim-field">
          <input
            ref={input}
            className={`claim-input ${touched && verdict && !verdict.ok ? "bad" : ""}`}
            value={name}
            maxLength={MAX}
            spellCheck={false}
            autoComplete="off"
            placeholder="skyline"
            onChange={(e) => {
              setName(e.target.value);
              setTouched(true);
              // A previous rejection is about a previous name.
              world.nameClaim = null;
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
              // The city is behind this panel and listens for movement keys.
              e.stopPropagation();
            }}
          />
          <span className="claim-count mono">
            {name.trim().length}/{MAX}
          </span>
        </div>

        <p className={`claim-status ${verdict?.ok ? "good" : verdict ? "bad" : "dim"}`}>
          {!name.trim()
            ? "3 to 16 characters. Letters, numbers, - and _."
            : verdict
              ? verdict.ok
                ? `${name.trim()} is available.`
                : verdict.reason
              : "Checking…"}
        </p>

        <button className="primary-btn" onClick={submit} disabled={!canSubmit}>
          Enter the city
        </button>

        <p className="dim tiny signin-note">
          You can change it later from your profile, though not more than once a
          week.
        </p>
      </div>
    </div>
  );
}
