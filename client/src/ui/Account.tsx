import { useEffect, useRef } from "react";
import { useAccount, accountLabel } from "../auth/useAccount";
import { reconnect } from "../net/connection";

/**
 * In-game account panel.
 *
 * Play-first: a guest sees a quiet "Save your progress" prompt rather than a
 * wall. Logging in is what turns a browser-bound save into a real account, and
 * quietly creates a self-custodial wallet for people who don't have one.
 */
export function AccountPanel() {
  const account = useAccount();
  const wasAuthed = useRef(account.authenticated);

  /**
   * Identity is established when the room is joined, so a login mid-session
   * has to reconnect for the server to see the new token. Without this the
   * player would appear logged in while the server still treats them as a
   * guest.
   */
  useEffect(() => {
    if (account.authenticated !== wasAuthed.current) {
      wasAuthed.current = account.authenticated;
      reconnect();
    }
  }, [account.authenticated]);

  if (!account.available) return null;

  if (!account.ready) {
    return (
      <div className="hud account">
        <div className="panel compact">
          <p className="dim tiny">Loading account…</p>
        </div>
      </div>
    );
  }

  if (!account.authenticated) {
    return (
      <div className="hud account">
        <div className="panel compact">
          <button className="connect" onClick={account.login}>
            Save your progress
          </button>
          <p className="dim tiny">
            Log in with email, a wallet is created for you, no seed phrase.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="hud account">
      <div className="panel compact">
        <div className="row space">
          <span className="row" style={{ gap: "0.4rem" }}>
            <span className="dot-live" />
            <span className="mono small">{accountLabel(account)}</span>
          </span>
          <button className="link" onClick={account.logout}>
            log out
          </button>
        </div>
        {account.address && (
          <p className="dim tiny mono">
            {account.isEmbedded ? "wallet " : "connected "}
            {account.address.slice(0, 6)}…{account.address.slice(-4)}
          </p>
        )}
      </div>
    </div>
  );
}
