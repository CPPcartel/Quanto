/**
 * Keyboard + pointer sampling. Kept out of React so the game loop can read
 * current input state synchronously without re-render churn.
 */
import { isTyping } from "../ui/keyboard";


const pressed = new Set<string>();

/**
 * The isometric camera angle is fixed, so unlike the 3D build there is no
 * orbit — only zoom. Movement is rotated by a constant yaw so that pressing W
 * walks "up-screen" along the iso axis rather than along world +x.
 *
 * Derivation: screen y falls as (x + z) falls, so up-screen is world (-1,-1).
 * The server's applyInput computes worldX = sin(yaw), worldZ = -cos(yaw) for
 * an "up" press, and sin(-PI/4) = -1/sqrt2, -cos(-PI/4) = -1/sqrt2. Hence:
 */
export const ISO_YAW = -Math.PI / 4;

/**
 * Shared camera state.
 *
 * `min` is not a constant: it is the zoom at which the whole city fits the
 * window, recomputed by the renderer on resize. It lives here rather than in
 * the renderer because this file owns the wheel clamp — when the floor was
 * duplicated in both places, changing one silently left the other behind.
 */
export const camera = {
  zoom: 1.0,
  /** Whole-city-fits zoom. Overwritten on first resize; this is only a seed. */
  min: 0.12,
  max: 2.2,
};



export function installInput(target: HTMLElement) {
  const onKeyDown = (e: KeyboardEvent) => {
    if (isTyping()) return;
    pressed.add(e.code);
    if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.code)) {
      e.preventDefault();
    }
    // Quick jump between street level and the full-city overview.
    if (e.code === "KeyM") {
      // Threshold is relative to the floor, which now varies by screen: a
      // fixed 0.3 would mean "already zoomed out" on one monitor and "still at
      // street level" on another.
      camera.zoom = camera.zoom > camera.min * 1.6 ? camera.min : 1.0;
    }
  };
  const onKeyUp = (e: KeyboardEvent) => pressed.delete(e.code);
  const onBlur = () => pressed.clear();

  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    // Exponential zoom so each notch feels the same at any scale.
    const factor = Math.exp(-e.deltaY * 0.0014);
    camera.zoom = clamp(camera.zoom * factor, camera.min, camera.max);
  };
  const onContextMenu = (e: Event) => e.preventDefault();

  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", onBlur);
  target.addEventListener("wheel", onWheel, { passive: false });
  target.addEventListener("contextmenu", onContextMenu);

  return () => {
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("keyup", onKeyUp);
    window.removeEventListener("blur", onBlur);
    target.removeEventListener("wheel", onWheel);
    target.removeEventListener("contextmenu", onContextMenu);
  };
}

export function sampleInput() {
  return {
    up: pressed.has("KeyW") || pressed.has("ArrowUp"),
    down: pressed.has("KeyS") || pressed.has("ArrowDown"),
    left: pressed.has("KeyA") || pressed.has("ArrowLeft"),
    right: pressed.has("KeyD") || pressed.has("ArrowRight"),
    run: pressed.has("ShiftLeft") || pressed.has("ShiftRight"),
    yaw: ISO_YAW,
  };
}

export function isPressed(code: string) {
  return pressed.has(code);
}

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}
