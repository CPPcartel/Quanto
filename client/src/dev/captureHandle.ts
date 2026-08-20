import { world } from "../net/world";
import { camera } from "../net/input";

/**
 * A handle on the running game, for capturing footage.
 *
 * The promo video is shot from the real client rather than recreated, which
 * means something outside the page has to be able to ask "are you connected
 * yet?" and "put the camera here". That is all this does.
 *
 * ---------------------------------------------------------------------------
 * It cannot reach production
 *
 * Guarded on `import.meta.env.DEV`, so Vite dead-code-eliminates the whole
 * module out of a production build — the object simply does not exist in the
 * deployed bundle. That matters because it exposes `world` by reference, and a
 * writable handle on client state is exactly the kind of thing that turns into
 * a trainer if it ships.
 *
 * It is also only a *client* handle. Nothing here can move a player on the
 * server: positions are still reconciled against the authoritative simulation,
 * so setting `local.x` moves the camera's idea of the player and the server
 * corrects it on the next tick. That is fine for a camera move and useless for
 * cheating, which is the correct combination.
 */
export function installCaptureHandle() {
  if (!import.meta.env.DEV) return;

  (window as unknown as Record<string, unknown>).__ccWorld = world;
  (window as unknown as Record<string, unknown>).__ccCamera = camera;

  // A single place for the capture script to set zoom without knowing that the
  // renderer eases toward `camera.zoom` rather than reading it directly.
  (window as unknown as Record<string, unknown>).__ccSetZoom = (z: number) => {
    camera.zoom = Math.max(camera.min, Math.min(camera.max, z));
  };

  console.info("[capture] dev handle installed — window.__ccWorld");
}
