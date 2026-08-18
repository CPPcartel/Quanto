import { world, type Snapshot } from "./world";
import { room } from "./connection";

/**
 * Client-side prediction + server reconciliation.
 *
 * These constants MUST match server/src/rooms/CityRoom.ts. If they drift, the
 * server will keep correcting the client and movement will feel rubbery.
 */
export const WALK_SPEED = 6.5;
export const RUN_SPEED = 12.0;
export const SIM_DT = 1 / 60;
const WORLD_LIMIT = 190;

/** Remote players are rendered this far in the past so we always interpolate
 *  between two known snapshots instead of extrapolating into a guess. */
export const INTERP_DELAY_MS = 100;

/** Above this gap we snap instead of easing — a teleport or a bad desync. */
const SNAP_DISTANCE = 6;

export interface InputCommand {
  seq: number;
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
  run: boolean;
  yaw: number;
}

export interface Movable {
  x: number;
  z: number;
  yaw: number;
}

/**
 * Integrate one command. This is a line-for-line twin of `applyInput` on the
 * server; any change here must be mirrored there.
 */
export function applyInput(target: Movable, cmd: InputCommand, dt: number): boolean {
  let dx = 0;
  let dz = 0;
  if (cmd.up) dz -= 1;
  if (cmd.down) dz += 1;
  if (cmd.left) dx -= 1;
  if (cmd.right) dx += 1;

  if (dx === 0 && dz === 0) return false;

  const len = Math.hypot(dx, dz);
  dx /= len;
  dz /= len;

  const sin = Math.sin(cmd.yaw);
  const cos = Math.cos(cmd.yaw);
  const worldX = dx * cos - dz * sin;
  const worldZ = dx * sin + dz * cos;

  const speed = cmd.run ? RUN_SPEED : WALK_SPEED;
  target.x = clamp(target.x + worldX * speed * dt, -WORLD_LIMIT, WORLD_LIMIT);
  target.z = clamp(target.z + worldZ * speed * dt, -WORLD_LIMIT, WORLD_LIMIT);
  target.yaw = Math.atan2(worldX, worldZ);
  return true;
}

export class Predictor {
  private seq = 0;
  private pending: InputCommand[] = [];
  private accumulator = 0;
  private lastAckSeq = 0;

  /**
   * Advance local simulation. Call once per rendered frame with the real
   * frame delta; internally we step at a fixed rate so movement is identical
   * regardless of display refresh rate.
   */
  step(dtSeconds: number, sample: () => Omit<InputCommand, "seq">) {
    // Guard against huge deltas after a tab regains focus.
    this.accumulator += Math.min(dtSeconds, 0.25);

    while (this.accumulator >= SIM_DT) {
      this.accumulator -= SIM_DT;
      const cmd: InputCommand = { ...sample(), seq: ++this.seq };

      // Predict immediately — the player never waits for the round trip.
      applyInput(world.local, cmd, SIM_DT);
      this.pending.push(cmd);
      room?.send("input", cmd);
    }

    if (this.pending.length > 240) this.pending.splice(0, this.pending.length - 240);
  }

  /**
   * Fold in the latest authoritative state: rewind to what the server says,
   * then replay every command it hasn't acknowledged yet.
   */
  reconcile() {
    const auth = world.authoritative;
    if (!auth.valid) return;

    // Nothing new to reconcile against.
    if (auth.lastSeq === this.lastAckSeq) return;
    this.lastAckSeq = auth.lastSeq;

    this.pending = this.pending.filter((cmd) => cmd.seq > auth.lastSeq);

    const replayed: Movable = { x: auth.x, z: auth.z, yaw: auth.yaw };
    for (const cmd of this.pending) applyInput(replayed, cmd, SIM_DT);

    const drift = Math.hypot(replayed.x - world.local.x, replayed.z - world.local.z);
    if (drift > SNAP_DISTANCE) {
      world.local.x = replayed.x;
      world.local.z = replayed.z;
    } else if (drift > 0.001) {
      // Small corrections are eased in so the avatar never visibly snaps.
      world.local.x += (replayed.x - world.local.x) * 0.2;
      world.local.z += (replayed.z - world.local.z) * 0.2;
    }
  }
}

/**
 * Sample a remote player's buffer at `renderTime`, interpolating between the
 * two snapshots that bracket it. Returns null while the buffer is too cold.
 */
export function sampleBuffer(buffer: Snapshot[], renderTime: number): Snapshot | null {
  if (buffer.length === 0) return null;
  if (buffer.length === 1) return buffer[0];

  for (let i = buffer.length - 1; i > 0; i--) {
    const a = buffer[i - 1];
    const b = buffer[i];
    if (a.t <= renderTime && renderTime <= b.t) {
      const span = b.t - a.t;
      const alpha = span > 0 ? (renderTime - a.t) / span : 1;
      return {
        t: renderTime,
        x: a.x + (b.x - a.x) * alpha,
        z: a.z + (b.z - a.z) * alpha,
        yaw: a.yaw + shortestAngle(a.yaw, b.yaw) * alpha,
      };
    }
  }

  // renderTime is newer than everything we have (sender paused) — hold last.
  return buffer[buffer.length - 1];
}

/** Interpolate the short way around the circle so avatars never spin 350°. */
export function shortestAngle(from: number, to: number): number {
  let diff = (to - from) % (Math.PI * 2);
  if (diff > Math.PI) diff -= Math.PI * 2;
  if (diff < -Math.PI) diff += Math.PI * 2;
  return diff;
}

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}
