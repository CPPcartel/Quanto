import { useState, useEffect, useSyncExternalStore, forwardRef, useImperativeHandle } from "react";
import { world, subscribeUi, getUiVersion } from "../net/world";
import { onDirectMessage } from "../net/connection";
import { CrewPanelBody } from "./Crew";
import { MarketPanelBody } from "./Market";
import { CollectionPanelBody } from "./Collection";
import { InboxPanelBody } from "./Inbox";
import { ProfilePanelBody } from "./Profile";

/**
 * The centre dock: crew, market, collection and messages.
 *
 * One panel at a time, by construction. These were three independent panels
 * that each owned their own open/closed state and were positioned at the same
 * `left: 50%` with different margin-tops — so opening two stacked them on top
 * of each other and on the wallet readout. Three overlapping panels is not a
 * layout problem to be nudged with margins; it is a missing constraint.
 *
 * Holding the state here makes the constraint impossible to violate: there is
 * one `open` value, so there is one panel.
 */

type DockPanel = "crew" | "market" | "residents" | "inbox" | "profile" | null;

/** Lets the HUD open a conversation from a name clicked in chat. */
export interface DockHandle {
  whisper(session: string, name: string): void;
}

export const Dock = forwardRef<DockHandle>(function Dock(_props, ref) {
  useSyncExternalStore(subscribeUi, getUiVersion);
  const [open, setOpen] = useState<DockPanel>(null);
  const [draftTo, setDraftTo] = useState<{ session: string; name: string } | null>(null);

  const toggle = (panel: Exclude<DockPanel, null>) =>
    setOpen((current) => (current === panel ? null : panel));

  useImperativeHandle(ref, () => ({
    whisper(session: string, name: string) {
      // A fresh conversation, not a stale one: clearing `dmOpen` stops the
      // previous thread's messages showing under the new person's name.
      world.dmOpen = null;
      setDraftTo({ session, name });
      setOpen("inbox");
    },
  }));

  /**
   * An arriving message opens nothing.
   *
   * The unread badge is the notification. Popping a panel over the city because
   * somebody typed would take the keyboard away mid-walk.
   */
  useEffect(() => onDirectMessage(() => {}), []);

  const crew = world.crew;
  const tier = world.localTier;
  const unread = world.dmUnread;

  return (
    <div className="hud dock">
      <div className="dock-tabs">
        <button className={`dock-tab ${open === "crew" ? "on" : ""}`} onClick={() => toggle("crew")}>
          {crew ? (
            <>
              <span className="dock-dot" style={{ background: crew.color }} />
              <span className="mono">[{crew.tag}]</span>
            </>
          ) : (
            <>
              <span className="dock-dot dim-dot" />
              <span className="mono">CREW</span>
            </>
          )}
        </button>

        <button
          className={`dock-tab ${open === "market" ? "on" : ""}`}
          onClick={() => toggle("market")}
        >
          <span className="mono">MARKET</span>
          {world.listings.length > 0 && (
            <span className="dock-count">{world.listings.length}</span>
          )}
        </button>

        <button
          className={`dock-tab ${open === "inbox" ? "on" : ""}`}
          onClick={() => toggle("inbox")}
        >
          <span className="mono">MESSAGES</span>
          {unread > 0 && <span className="dock-count alert">{unread}</span>}
        </button>

        {/*
          Last, and marked with the player's own colour rather than a tier dot.
          It is the one tab that is about them rather than about the city.
        */}
        <button
          className={`dock-tab ${open === "profile" ? "on" : ""}`}
          onClick={() => toggle("profile")}
        >
          <span className="dock-dot" style={{ background: world.localColor }} />
          <span className="mono">PROFILE</span>
        </button>

        <button
          className={`dock-tab ${open === "residents" ? "on" : ""}`}
          onClick={() => toggle("residents")}
        >
          <span
            className="dock-dot"
            style={{ background: TIER_COLOR[tier] ?? "var(--panel-border)" }}
          />
          <span className="mono">{tier !== "none" ? tier.toUpperCase() : "RESIDENTS"}</span>
        </button>
      </div>

      {open && (
        <div className={`panel compact dock-panel ${open === "profile" ? "wide" : ""}`}>
          {open === "crew" && <CrewPanelBody onClose={() => setOpen(null)} />}
          {open === "market" && <MarketPanelBody onClose={() => setOpen(null)} />}
          {open === "residents" && <CollectionPanelBody onClose={() => setOpen(null)} />}
          {open === "profile" && <ProfilePanelBody />}
          {open === "inbox" && (
            <InboxPanelBody
              onClose={() => setOpen(null)}
              draftTo={draftTo}
              onDraftHandled={() => setDraftTo(null)}
            />
          )}
        </div>
      )}
    </div>
  );
});

const TIER_COLOR: Record<string, string> = {
  penthouse: "#FFD166",
  landlord: "#22E8FF",
  resident: "#8A92A6",
};
