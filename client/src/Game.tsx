import { useEffect, useRef } from "react";
import { Hud } from "./ui/Hud";
import { connect } from "./net/connection";
import { installInput } from "./net/input";
import { startGame, type GameHandle } from "./pixi/app";
import { world, markUiDirty } from "./net/world";
import { useAccount } from "./auth/useAccount";
import { privyEnabled } from "./auth/PrivyGate";
import { SignInWall, SignInUnavailable } from "./ui/SignInWall";
import { Boundary } from "./ui/Boundary";
import { ClaimName } from "./ui/ClaimName";

/**
 * Whether an account is required to play.
 *
 * Mirrors the server's REQUIRE_AUTH, which is the actual boundary — this only
 * decides what the player is shown. Defaults on, and turns itself off when no
 * Privy app is configured so local development still runs.
 */
const requireSignIn =
  privyEnabled && (import.meta.env.VITE_REQUIRE_AUTH ?? "true").toLowerCase() !== "false";

/**
 * The socket should survive a StrictMode remount, so it is guarded at module
 * scope. The renderer must NOT be guarded that way — see below.
 */
let socketStarted = false;

export default function Game() {
  const account = useAccount();
  const host = useRef<HTMLDivElement>(null);

  /**
   * Lock the viewport for the duration of the game only. The site's pages must
   * still scroll normally, and both stylesheets are loaded globally.
   */
  useEffect(() => {
    document.documentElement.classList.add("game-mode");
    document.body.classList.add("game-mode");
    return () => {
      document.documentElement.classList.remove("game-mode");
      document.body.classList.remove("game-mode");
    };
  }, []);

  /**
   * Do not open a socket until the player is signed in.
   *
   * The server refuses an unauthenticated join, so connecting first would just
   * produce a failed handshake and an error the player cannot act on. Waiting
   * for `authenticated` means the first thing an anonymous visitor sees is the
   * sign-in panel, not a broken city.
   *
   * `ready` matters as much as `authenticated`: Privy reports `false` for both
   * while it is still restoring a session, and reacting to that first frame
   * would sign out anyone who reloads the page.
   */
  useEffect(() => {
    if (!account.ready) return;
    if (requireSignIn && !account.authenticated) return;
    if (socketStarted) return;
    socketStarted = true;
    connect().catch(() => {
      /* surfaced through world.conn in the HUD */
    });
  }, [account.ready, account.authenticated]);

  useEffect(() => {
    const el = host.current;
    if (!el) return;

    /**
     * React StrictMode mounts, cleans up, then mounts again in development.
     * The renderer therefore has to follow the normal effect lifecycle: create
     * on mount, fully destroy on cleanup, create again on remount.
     *
     * A module-level "already started" guard breaks this subtly and badly —
     * the first (async) startGame resolves *after* its own cleanup has run, so
     * it destroys itself, while the second mount skips creation entirely. The
     * result is a live canvas element attached to a destroyed application:
     * correct canvas size, zero fps, nothing ever drawn.
     */
    let handle: GameHandle | null = null;
    let disposed = false;

    const removeInput = installInput(el);

    startGame(el)
      .then((h) => {
        if (disposed) h.destroy();
        else handle = h;
      })
      .catch((err) => {
        if (disposed) return;
        world.debug.fatal = String(err?.message ?? err);
        markUiDirty();
        console.error("[pixi] failed to start", err);
      });

    return () => {
      disposed = true;
      removeInput();
      handle?.destroy();
      handle = null;
    };
  }, []);

  /**
   * Two ways to end up at the wall.
   *
   * The expected one: this build knows accounts are required and the player is
   * not signed in. The other: the server refused the join because it requires
   * accounts and this client was built without `VITE_PRIVY_APP_ID` — a deploy
   * mismatch that would otherwise present as a city that silently never loads.
   */
  const locked =
    (requireSignIn && account.ready && !account.authenticated) || world.authRequired;

  /**
   * Signed in, connected, but has never picked a name.
   *
   * Deliberately after `locked`: somebody who is not signed in has a different
   * problem, and stacking both panels would ask them to name an account they do
   * not have yet. Also requires a live connection, since the claim needs a
   * server to answer it.
   */
  const needsName =
    !locked && world.conn === "connected" && world.sessionId !== "" && !world.localNameClaimed;

  return (
    <div className="shell">
      <div className="viewport" ref={host} />
      {/*
        The HUD stays mounted so the city keeps rendering behind the wall, and
        carries its own boundary so one panel throwing cannot take the renderer
        and every other panel down with it.
      */}
      <Boundary area="hud">
        <Hud />
      </Boundary>
      {locked && (privyEnabled ? <SignInWall /> : <SignInUnavailable />)}
      {needsName && <ClaimName />}
    </div>
  );
}
