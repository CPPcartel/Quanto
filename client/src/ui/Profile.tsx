import { useEffect, useMemo, useState } from "react";
import { useSyncExternalStore } from "react";
import { world, subscribeUi, getUiVersion } from "../net/world";
import {
  checkName,
  claimName,
  setColor,
  setAvatar,
  requestProfile,
  signInWithWallet,
} from "../net/connection";
import { connectWallet, hasWallet, shortAddress } from "../net/wallet";

/**
 * The player's own profile.
 *
 * Three things they own and can change — name, colour, appearance — plus the
 * facts about their account they cannot. Deliberately the owner's view only:
 * nothing here is replicated to other players, because a profile is an account
 * page rather than a public record.
 */

const MAX = 16;
const SHAPE = /^[a-zA-Z0-9][a-zA-Z0-9_-]{1,14}[a-zA-Z0-9]$/;

/**
 * The trait slots, mirroring server/src/config/traits.ts.
 *
 * Duplicated rather than imported because client and server are separate
 * packages. The server sanitises every submission, so a drift here shows up as
 * an option that does not apply rather than as a wrong appearance — annoying,
 * not dangerous. Holder-only indices are marked so the UI can show them locked;
 * the actual enforcement is server-side and this is only a label.
 */
const SLOTS = [
  { key: "jacket", label: "Jacket", options: ["Midnight", "Moss", "Rust", "Amber", "Violet", "Coral", "Steel", "Sand", "Ink", "Bone"], holderOnly: [8, 9] },
  { key: "collar", label: "Collar", options: ["Cyan", "Magenta", "Lime", "Amber", "Violet", "Red"], holderOnly: [] },
  { key: "hair", label: "Hair", options: ["Black", "Brown", "Blonde", "Grey", "Teal", "Pink"], holderOnly: [] },
  { key: "visor", label: "Visor", options: ["Cyan", "Amber", "Lime", "Magenta", "Clear"], holderOnly: [4] },
  { key: "skin", label: "Skin", options: ["Porcelain", "Sand", "Bronze", "Umber", "Deep"], holderOnly: [] },
  { key: "accessory", label: "Accessory", options: ["None", "Cap", "Headphones", "Antenna", "Halo"], holderOnly: [3, 4] },
] as const;

const BASE36 = "0123456789abcdefghijklmnopqrstuvwxyz";

const COLOURS = [
  "#4F4DC4", "#22e8ff", "#e5a85c", "#5fb37e",
  "#db7264", "#c77dff", "#8d8af2", "#ecedf3",
];

/**
 * Format a date that arrived over the wire, whatever shape it took.
 *
 * The server now sends an ISO string, but this used to call .slice on the
 * value directly and the server used to send a Date, because msgpack
 * preserves the type where JSON would have stringified it. The result was not
 * a wrong date, it was the entire interface unmounting.
 *
 * Nothing arriving from a socket is worth crashing a panel over, so this
 * accepts a string, a Date or a number and gives up quietly if it is none of
 * them.
 */
function asDay(value: unknown): string {
  if (!value) return "-";
  const d = value instanceof Date ? value : new Date(value as string | number);
  return Number.isNaN(d.getTime()) ? "-" : d.toISOString().slice(0, 10);
}

function relative(ms: number): string {
  const left = ms - Date.now();
  if (left <= 0) return "now";
  const days = Math.floor(left / 86_400_000);
  if (days >= 1) return `in ${days} day${days === 1 ? "" : "s"}`;
  const hours = Math.ceil(left / 3_600_000);
  return `in ${hours} hour${hours === 1 ? "" : "s"}`;
}

export function ProfilePanelBody() {
  useSyncExternalStore(subscribeUi, getUiVersion);

  // The panel is the only thing that asks for this, so it asks on open.
  useEffect(() => {
    requestProfile();
  }, []);

  const profile = world.profile;
  const isHolder = world.localTier !== "none";
  const traits = world.localTraits || "000010";

  return (
    <div className="profile-body">
      <NameSection profile={profile} />

      <section className="profile-section">
        <h4 className="profile-heading">Colour</h4>
        <p className="dim tiny">Your marker on the street and on the minimap.</p>
        <div className="swatches">
          {COLOURS.map((c) => (
            <button
              key={c}
              className={`swatch ${world.localColor.toLowerCase() === c.toLowerCase() ? "on" : ""}`}
              style={{ background: c }}
              aria-label={c}
              onClick={() => setColor(c)}
            />
          ))}
        </div>
      </section>

      <section className="profile-section">
        <h4 className="profile-heading">Appearance</h4>
        <p className="dim tiny">
          {isHolder
            ? "Your Resident's traits are unlocked, including holder-only options."
            : "Some options are reserved for Quanto Residents holders."}
        </p>

        {SLOTS.map((slot, i) => {
          const current = BASE36.indexOf(traits[i] ?? "0");
          return (
            <div className="trait-row" key={slot.key}>
              <span className="trait-label">{slot.label}</span>
              <div className="trait-options">
                {slot.options.map((name, index) => {
                  const locked = !isHolder && (slot.holderOnly as readonly number[]).includes(index);
                  return (
                    <button
                      key={name}
                      className={`trait-chip ${current === index ? "on" : ""} ${locked ? "locked" : ""}`}
                      disabled={locked}
                      title={locked ? "Holders only" : name}
                      onClick={() => {
                        const next = traits.split("");
                        next[i] = BASE36[index];
                        setAvatar(next.join(""));
                      }}
                    >
                      {name}
                      {locked && <span className="lock">·</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}

        {profile?.customAvatar && (
          <button className="ghost-btn" onClick={() => setAvatar(null)}>
            {isHolder ? "Use my Resident's look" : "Reset appearance"}
          </button>
        )}
      </section>

      <WalletSection profile={profile} />

      <section className="profile-section">
        <h4 className="profile-heading">Account</h4>
        <dl className="profile-facts">
          <div>
            <dt>Tier</dt>
            <dd className="mono">{(profile?.tier ?? world.localTier).toUpperCase()}</dd>
          </div>
          <div>
            <dt>Resident since</dt>
            <dd className="mono">
              {asDay(profile?.createdAt)}
            </dd>
          </div>
        </dl>
      </section>
    </div>
  );
}

/**
 * Connecting a wallet, which is about holdings and not about signing in.
 *
 * Your account already says who you are. This says what you hold, and it is the
 * only route to a tier, to holder-only traits, and through the rope at The
 * Vault. Signing proves the wallet is yours: it costs no gas and authorises no
 * transaction.
 *
 * Every address you connect is checked, so a Resident sitting in a cold wallet
 * still counts while you play from another one.
 */
function WalletSection({ profile }: { profile: typeof world.profile }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const wallets = profile?.wallets ?? [];

  const connect = async () => {
    setBusy(true);
    setError("");
    try {
      await signInWithWallet((nonce) => connectWallet(nonce));
      // The server decides what changed; ask rather than assume.
      requestProfile();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="profile-section">
      <h4 className="profile-heading">Wallets</h4>

      {wallets.length > 0 ? (
        <ul className="wallet-list">
          {wallets.map((w) => (
            <li key={w} className="mono">
              {shortAddress(w)}
            </li>
          ))}
        </ul>
      ) : (
        <p className="dim tiny">
          None connected. Your floors and balance do not need one; a wallet is
          how the city sees a Quanto Residents NFT you hold.
        </p>
      )}

      {hasWallet() ? (
        <>
          <button className="ghost-btn" disabled={busy} onClick={connect}>
            {busy ? "Check your wallet…" : wallets.length ? "Connect another" : "Connect a wallet"}
          </button>
          <p className="dim tiny">
            You sign one message to prove it is yours. No gas, no transaction,
            and nothing about your progress changes.
          </p>
        </>
      ) : (
        <p className="dim tiny">
          No browser wallet detected. MetaMask is the usual one; install it and
          reload to connect.
        </p>
      )}

      {error && <p className="claim-status bad">{error}</p>}
    </section>
  );
}

/**
 * Renaming, with the cooldown made visible.
 *
 * The cooldown is shown as a date rather than hidden behind a rejection,
 * because "you changed your name recently" after typing a new one is a worse
 * experience than knowing up front that the field is closed until Thursday.
 */
function NameSection({ profile }: { profile: typeof world.profile }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");

  const readyAt = profile?.renameReadyAt ?? 0;
  const locked = readyAt > Date.now();

  useEffect(() => {
    const trimmed = name.trim();
    if (!trimmed || !SHAPE.test(trimmed)) return;
    const id = setTimeout(() => checkName(trimmed), 320);
    return () => clearTimeout(id);
  }, [name]);

  const check = world.nameCheck;
  const claim = world.nameClaim;

  const verdict = useMemo(() => {
    const trimmed = name.trim();
    if (!trimmed) return null;
    if (!SHAPE.test(trimmed)) return { ok: false, reason: "Letters, numbers, - and _ only." };
    if (claim && claim.ok === false) return { ok: false, reason: claim.reason ?? "" };
    if (check && check.name.toLowerCase() === trimmed.toLowerCase()) return check;
    return null;
  }, [name, check, claim]);

  useEffect(() => {
    if (claim?.ok) {
      setEditing(false);
      setName("");
      requestProfile();
    }
  }, [claim?.ok]);

  return (
    <section className="profile-section">
      <h4 className="profile-heading">Name</h4>

      {!editing ? (
        <>
          <div className="profile-name-row">
            <span className="profile-name">{world.localName || "-"}</span>
            <button
              className="ghost-btn"
              disabled={locked}
              onClick={() => {
                world.nameClaim = null;
                setEditing(true);
              }}
            >
              Change
            </button>
          </div>
          <p className="dim tiny">
            {locked
              ? `You can change your name again ${relative(readyAt)}.`
              : "You can change your name once a week."}
          </p>
        </>
      ) : (
        <>
          <div className="claim-field">
            <input
              className={`claim-input ${verdict && !verdict.ok ? "bad" : ""}`}
              value={name}
              maxLength={MAX}
              spellCheck={false}
              autoComplete="off"
              placeholder={world.localName}
              onChange={(e) => {
                setName(e.target.value);
                world.nameClaim = null;
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && verdict?.ok) claimName(name.trim());
                if (e.key === "Escape") setEditing(false);
                e.stopPropagation();
              }}
            />
            <span className="claim-count mono">
              {name.trim().length}/{MAX}
            </span>
          </div>

          <p className={`claim-status ${verdict?.ok ? "good" : verdict ? "bad" : "dim"}`}>
            {!name.trim()
              ? "Pick something new."
              : verdict
                ? verdict.ok
                  ? `${name.trim()} is available.`
                  : verdict.reason
                : "Checking…"}
          </p>

          <div className="profile-actions">
            <button
              className="primary-btn"
              disabled={!verdict?.ok}
              onClick={() => claimName(name.trim())}
            >
              Save
            </button>
            <button className="ghost-btn" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        </>
      )}
    </section>
  );
}
