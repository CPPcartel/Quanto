import { useEffect, useRef } from "react";
import { Hud } from "./ui/Hud";
import { connect } from "./net/connection";
import { installInput } from "./net/input";
import { startGame, type GameHandle } from "./pixi/app";
import { world, markUiDirty } from "./net/world";

/**
 * The socket should survive a StrictMode remount, so it is guarded at module
 * scope. The renderer must NOT be guarded that way — see below.
 */
let socketStarted = false;

export default function Game() {
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

  useEffect(() => {
    if (socketStarted) return;
    socketStarted = true;
    connect().catch(() => {
      /* surfaced through world.conn in the HUD */
    });
  }, []);

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

  return (
    <div className="shell">
      <div className="viewport" ref={host} />
      <Hud />
    </div>
  );
}
