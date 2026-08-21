import { useEffect, useRef } from "react";
import { useAccount, accountLabel } from "../auth/useAccount";

/**
 * The door, as the player sees it.
 *
 * The server refuses an unauthenticated join, so this is not a suggestion — it
 * is the only way in. It renders over the city rather than instead of it: the
 * skyline is already drawing behind, which is a far better argument for signing
 * in than a blank page with a button on it.
 *
 * Deliberately says what a player gets rather than what we need from them. "Log
 * in to continue" is a toll; "your city, on any device" is a reason.
 */
export function SignInWall() {
  const account = useAccount();

  /**
   * Open the sign-up immediately on arrival.
   *
   * "Enter the city" is the button the player actually pressed, back on the
   * landing page. Making them press a second one here would be a toll booth in
   * front of a toll booth. Privy cannot live on the landing page itself — it and
   * its Solana peers weigh over a megabyte, and that page is judged in two
   * seconds — so the modal opens on the first frame after the auth stack has
   * loaded instead.
   *
   * Fired once, via a ref rather than state: dismissing the modal must leave the
   * player looking at the city with a button, not re-trigger it in a loop.
   */
  const opened = useRef(false);
  useEffect(() => {
    if (!account.ready || account.authenticated || opened.current) return;
    opened.current = true;
    account.login();
  }, [account.ready, account.authenticated]);

  return (
    <div className="overlay center signin-wall">
      <div className="panel signin-panel">
        <span className="wallet-label">QUANTO</span>

        <h2 className="signin-title">Claim your address</h2>

        <p className="dim signin-copy">
          Every resident has an account, so your floors, crew and balance follow you to any
          device, and so the people you meet in the city are the same people tomorrow.
        </p>

        {/* The modal opens by itself above; this is the way back if it was
            dismissed, not the primary path. */}
        <button className="primary-btn" onClick={account.login} disabled={!account.ready}>
          {account.ready ? "Sign up or sign in" : "Loading…"}
        </button>

        <p className="dim tiny signin-note">
          Sign in with an email or connect a wallet. You can connect a wallet later to
          bring an NFT in, your city is yours either way.
        </p>
      </div>
    </div>
  );
}

/** Shown when the server wants accounts but none are configured. */
export function SignInUnavailable() {
  return (
    <div className="overlay center signin-wall">
      <div className="panel signin-panel">
        <span className="wallet-label">QUANTO</span>
        <h2 className="signin-title">Accounts are not configured</h2>
        {/*
          Deliberately vague about server configuration.

          An earlier version named the server's Privy credentials here, which put
          the string "PRIVY_APP_SECRET" into the client bundle and tripped the
          build's secret-name scan. Nothing sensitive was leaked — it was the
          name, not the value — but shipping the names of server secrets to the
          browser is exactly the habit that check exists to prevent, and the
          person who can fix this is reading the server logs, not this panel.
        */}
        <p className="dim signin-copy">
          This build requires an account, but no sign-in provider is configured. The server
          logs explain which settings are missing.
        </p>
      </div>
    </div>
  );
}

export { accountLabel };
