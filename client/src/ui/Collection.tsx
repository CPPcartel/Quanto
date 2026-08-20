import { useSyncExternalStore, useState } from "react";
import { world, subscribeUi, getUiVersion } from "../net/world";
import { describeTraits } from "../pixi/traits";

/**
 * What the player holds, and what each tier grants.
 *
 * Deliberately explicit about the two things people get wrong about NFT game
 * utility: that a tier might pay you (it does not), and that not holding one
 * locks you out (it does not). Both are stated on the panel rather than left to
 * a Discord argument.
 */

const COLLECTION_URL = "https://opensea.io/collection/quanto-residents";

const TIERS = [
  {
    id: "resident",
    label: "Resident",
    color: "#8A92A6",
    supply: "~3,000",
    grants: ["Your traits render on your character", "Founding badge on the boards"],
  },
  {
    id: "landlord",
    label: "Landlord",
    color: "#22E8FF",
    supply: "~300",
    grants: ["Everything a Resident has", "Found a chartered crew — 50 members, not 20"],
  },
  {
    id: "penthouse",
    label: "Penthouse",
    color: "#FFD166",
    supply: "38",
    grants: [
      "Everything a Landlord has",
      "The top floor of one named tower",
      "That floor counts double toward control of it",
    ],
  },
] as const;

export function CollectionPanelBody({ onClose }: { onClose: () => void }) {
  useSyncExternalStore(subscribeUi, getUiVersion);

  const tier = world.localTier;
  const holding = tier !== "none";
  const current = TIERS.find((t) => t.id === tier);

  return (
    <>
        <div className="crew-head">
          <span className="wallet-label">QUANTO RESIDENTS</span>
          <button className="link tiny" onClick={onClose}>
            close
          </button>
        </div>

        {holding ? (
          <>
            <div className="crew-identity">
              <span className="crew-dot" style={{ background: current?.color }} />
              <div>
                <p className="crew-name">{current?.label}</p>
                {world.localPenthouse ? (
                  <p className="dim tiny mono">Top floor of {world.localPenthouse}</p>
                ) : (
                  <p className="dim tiny mono">Your traits are on your character</p>
                )}
              </div>
            </div>

            <div className="trait-grid">
              {describeTraits(world.localTraits).map((t) => (
                <div className="trait-row" key={t.slot}>
                  <span className="dim tiny">{t.slot}</span>
                  <span className="mono tiny">{t.name}</span>
                </div>
              ))}
            </div>
          </>
        ) : (
          <p className="dim tiny crew-note">
            You don't hold one. Everything in the game is open to you either way — a token
            changes how you look and how much of a tower you can hold, never how much you
            earn.
          </p>
        )}

        <div className="tier-list">
          {TIERS.map((t) => (
            <div className={`tier-card ${t.id === tier ? "on" : ""}`} key={t.id}>
              <div className="row space">
                <span className="mono tiny" style={{ color: t.color }}>
                  {t.label}
                </span>
                <span className="dim tiny">{t.supply}</span>
              </div>
              <ul className="tier-grants">
                {t.grants.map((g) => (
                  <li key={g} className="dim tiny">
                    {g}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <p className="dim tiny crew-note">
          No tier pays $BLOCK. Shifts, floors and storms earn exactly the same for holders
          and guests.
        </p>

        <a className="primary-btn tier-link" href={COLLECTION_URL} target="_blank" rel="noreferrer">
          View on OpenSea
        </a>
    </>
  );
}
