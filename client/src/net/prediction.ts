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
/**
 * A rectangle this mover may not enter. Null when nothing is barred.
 *
 * Passed in rather than looked up, so `applyInput` stays a pure function of its
 * arguments — which is the only reason the client and server copies can be
 * compared line for line.
 */
export interface Barrier {
  x: number;
  z: number;
  half: number;
}

function barred(barrier: Barrier | null | undefined, x: number, z: number): boolean {
  if (!barrier) return false;
  return Math.abs(x - barrier.x) <= barrier.half && Math.abs(z - barrier.z) <= barrier.half;
}

export function applyInput(
  target: Movable,
  cmd: InputCommand,
  dt: number,
  barrier?: Barrier | null
): boolean {
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
  const nextX = clamp(target.x + worldX * speed * dt, -WORLD_LIMIT, WORLD_LIMIT);
  const nextZ = clamp(target.z + worldZ * speed * dt, -WORLD_LIMIT, WORLD_LIMIT);

  /**
   * Axis-separated, so a barred mover slides along the wall instead of sticking
   * to it. Testing the combined position would stop them dead the moment either
   * axis entered, which reads as a bug rather than as a door.
   */
  if (!barred(barrier, nextX, target.z)) target.x = nextX;
  if (!barred(barrier, target.x, nextZ)) target.z = nextZ;

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
      applyInput(world.local, cmd, SIM_DT, clubBarrier());
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
    for (const cmd of this.pending) applyInput(replayed, cmd, SIM_DT, clubBarrier());

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

/**
 * The Vault, as a barrier — or null if this player may enter.
 *
 * Read from replicated state rather than hardcoded, so the client can never
 * disagree with the server about where the venue is. The permission check
 * mirrors the server's `isHolder` exactly; if the two ever drift, a non-holder
 * would predict walking in and then be yanked back every tick, which is far
 * worse than a clean refusal.
 *
 * Returns null while the club has not replicated yet. That fails open for a
 * second or two on join, which is the right direction to fail.
 */
export function clubBarrier(): Barrier | null {
  if (world.localTier && world.localTier !== "none") return null;
  const club = world.parks.find((p) => p.kind === "club");
  return club ? { x: club.x, z: club.z, half: club.half } : null;
}
