/**
 * The soundtrack, synthesised offline.
 *
 *   node scripts/gen-audio.mjs
 *
 * This is a straight port of `client/src/pixi/audio.ts` — the music that plays
 * inside The Vault in the game. Same voices (pitch-drop kick, highpassed noise
 * hat, sawtooth bass, square stab), same 16th-note pattern, same minor scale,
 * same one-lowpass-across-everything build. The Web Audio graph is replaced by
 * direct sample writes because there is no browser here.
 *
 * That matters more than it sounds: the promo's music is not stock, it is the
 * game's music. Anyone who plays after seeing this hears the same track.
 *
 * No files are downloaded and no licence applies. Output is 16-bit mono WAV,
 * which Remotion reads natively.
 */
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SR = 44100;

/**
 * The same timings the composition uses.
 *
 * Read from the shared file rather than copied. When these were two hand-kept
 * copies, lengthening a scene left the soundtrack at the old duration and the
 * track ran out before the video did.
 */
const timing = JSON.parse(readFileSync(resolve(ROOT, "src/timing.json"), "utf8"));

/** Which cut to render: `vertical` (default) or `landscape`. */
const CUT_NAME = process.argv[2] ?? "vertical";
const CUT = timing.cuts[CUT_NAME];
if (!CUT) {
  console.error(`unknown cut "${CUT_NAME}" — expected one of ${Object.keys(timing.cuts).join(", ")}`);
  process.exit(1);
}
const BPM = CUT.bpm;
const FPS = timing.fps;
const BEATS = CUT.beats;
const B = (FPS * 60) / BPM;
const TOTAL_FRAMES = Math.round(Object.values(BEATS).reduce((n, v) => n + v, 0) * B);
const DURATION = TOTAL_FRAMES / FPS;

/** Deterministic noise — a rerender must produce a byte-identical file. */
let seed = 0x0ca11ed;
function rnd() {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed / 4294967296;
}

// ---------------------------------------------------------------------------

function mono(seconds) {
  return new Float32Array(Math.ceil(seconds * SR));
}

/** Kick: 150Hz dropping to 45Hz in 110ms, the game's exact envelope. */
function kick(buf, at, gain = 1) {
  const n = Math.floor(0.26 * SR);
  const i0 = Math.floor(at * SR);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const f = 150 * Math.pow(45 / 150, Math.min(1, t / 0.11));
    phase += (2 * Math.PI * f) / SR;
    const env = Math.pow(0.001, Math.min(1, t / 0.24));
    write(buf, i0 + i, Math.sin(phase) * env * gain);
  }
}

/** Hat: white noise, highpassed, 40ms with a linear decay. */
function hat(buf, at, intensity) {
  const n = Math.floor(0.04 * SR);
  const i0 = Math.floor(at * SR);
  const g = 0.12 + intensity * 0.14;
  // One-pole highpass at ~7kHz, matching the game's biquad closely enough.
  const rc = 1 / (2 * Math.PI * 7000);
  const a = rc / (rc + 1 / SR);
  let prevIn = 0;
  let prevOut = 0;
  for (let i = 0; i < n; i++) {
    const raw = (rnd() * 2 - 1) * (1 - i / n);
    const out = a * (prevOut + raw - prevIn);
    prevIn = raw;
    prevOut = out;
    write(buf, i0 + i, out * g);
  }
}

/** Bass: sawtooth, 160ms, exponential in and out. */
function bass(buf, at, hz, intensity) {
  const n = Math.floor(0.18 * SR);
  const i0 = Math.floor(at * SR);
  const peak = 0.16 + intensity * 0.1;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const saw = 2 * ((t * hz) % 1) - 1;
    const env =
      t < 0.01
        ? t / 0.01
        : Math.pow(0.0001 / peak, Math.min(1, (t - 0.01) / 0.15));
    write(buf, i0 + i, saw * peak * env);
  }
}

/** Stab: a minor triad in squares, only when the track is busy. */
function stab(buf, at) {
  for (const hz of [440, 523.25, 659.25]) {
    const n = Math.floor(0.22 * SR);
    const i0 = Math.floor(at * SR);
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      const sq = ((t * hz) % 1) < 0.5 ? 1 : -1;
      const env = t < 0.01 ? t / 0.01 : Math.pow(0.002, Math.min(1, (t - 0.01) / 0.19));
      write(buf, i0 + i, sq * 0.05 * env);
    }
  }
}

/** A pad under everything, so the gaps between hits are not silent. */
function pad(buf, from, to) {
  const i0 = Math.floor(from * SR);
  const i1 = Math.floor(to * SR);
  // Detuned fifths — A1 and E2, the same root the bass line walks around.
  const voices = [55, 55.35, 82.41, 82.9];
  for (let i = i0; i < i1; i++) {
    const t = (i - i0) / SR;
    const span = (i1 - i0) / SR;
    // Fades in over a bar and out over the last two seconds.
    const env =
      Math.min(1, t / 2) * Math.min(1, Math.max(0, (span - t) / 2)) * 0.055;
    let s = 0;
    for (const hz of voices) s += Math.sin(2 * Math.PI * hz * t);
    write(buf, i, (s / voices.length) * env);
  }
}

function write(buf, i, v) {
  if (i >= 0 && i < buf.length) buf[i] += v;
}

/**
 * One-pole lowpass across the master.
 *
 * The game sweeps a single filter to make the track build; the same sweep here
 * is what carries the video from the quiet hook into the payoff.
 */
function sweepLowpass(buf, cutoffAt) {
  let prev = 0;
  for (let i = 0; i < buf.length; i++) {
    const fc = cutoffAt(i / SR);
    const rc = 1 / (2 * Math.PI * fc);
    const a = 1 / SR / (rc + 1 / SR);
    prev += a * (buf[i] - prev);
    buf[i] = prev;
  }
}

// ---------------------------------------------------------------------------
// The arrangement

const track = mono(DURATION + 0.5);
const secPerStep = 60 / BPM / 4; // a 16th note
const steps = Math.ceil(DURATION / secPerStep);
const scale = [55, 55, 65.41, 55, 73.42, 55, 82.41, 61.74];

/**
 * Section boundaries, in frames, derived from the scene list.
 *
 * The track is arranged against the edit rather than ramped blindly across it,
 * so the filter opens on a cut and the drop lands on the scene that deserves it.
 * For the landscape cut that scene is The Vault; for the vertical one there is
 * no club, so the two share this code and differ only in where the marks fall.
 */
const marks = (() => {
  // Rounded once from the running beat total, exactly as the composition does.
  // Rounding each scene separately let the error accumulate and put the last
  // cuts a couple of frames off the music.
  const out = {};
  let cumulative = 0;
  for (const [name, b] of Object.entries(BEATS)) {
    const from = Math.round(cumulative * B);
    cumulative += b;
    out[name] = { from: from / FPS, to: Math.round(cumulative * B) / FPS };
  }
  return out;
})();

/** The moment the room opens up. Everything before it is a build. */
const DROP = marks.vault ? marks.vault.from : DURATION * 0.55;
/** Where the track pulls back so the wordmark can land in space. */
const OUTRO = marks.cta ? marks.cta.from : DURATION * 0.85;

pad(track, 0, DURATION);

for (let step = 0; step < steps; step++) {
  const at = step * secPerStep;

  /**
   * Intensity, arranged in sections.
   *
   * Rising through the build, full through the drop, pulled back for the CTA.
   * This is the same curve `clubIntensity` follows in the game when volatility
   * climbs — which is the point: the music gets harder because the market does.
   */
  let intensity;
  if (at < DROP) intensity = 0.22 + (at / DROP) * 0.62;
  else if (at < OUTRO) intensity = 1;
  else intensity = Math.max(0.18, 1 - ((at - OUTRO) / Math.max(0.001, DURATION - OUTRO)) * 1.4);

  /** Four bars before the drop everything thins out, so the drop hits harder. */
  const barSec = (60 / BPM) * 4;
  const inGap = at >= DROP - barSec * 0.5 && at < DROP;

  if (step % 4 === 0 && !inGap) kick(track, at, at >= DROP ? 1 : 0.8);
  // Double-time hats after the drop: the single clearest "it got harder" cue.
  if (!inGap) {
    if (at >= DROP) {
      if (step % 2 === 1) hat(track, at, intensity);
    } else if (step % 4 === 2 || (intensity > 0.6 && step % 2 === 1)) {
      hat(track, at, intensity);
    }
  }
  if (step % 2 === 0 && !inGap) bass(track, at, scale[(step / 2) % 8], intensity);
  if (at >= DROP && step % 8 === 6) stab(track, at);
  else if (intensity > 0.75 && step % 16 === 14) stab(track, at);
}

/**
 * One filter across the master, swept by section.
 *
 * Closed through the build so the drop is the first time the top end arrives,
 * wide open through the club, easing shut under the CTA.
 */
sweepLowpass(track, (t) => {
  if (t < DROP) return 340 + (t / DROP) * 2600;
  if (t < OUTRO) return 16000;
  const p = (t - OUTRO) / Math.max(0.001, DURATION - OUTRO);
  return Math.max(1400, 16000 - p * 20000);
});

// ---------------------------------------------------------------------------
// A transition hit for every cut

const hit = mono(0.7);
kick(hit, 0.0, 1);
// A short reversed noise swell into the kick, then a bright tail after it.
for (let i = 0; i < Math.floor(0.18 * SR); i++) {
  const t = i / SR;
  const env = Math.pow(t / 0.18, 2.2);
  write(hit, i, (rnd() * 2 - 1) * env * 0.16);
}
for (const hz of [110, 164.81]) {
  for (let i = 0; i < Math.floor(0.45 * SR); i++) {
    const t = i / SR;
    write(hit, i, Math.sin(2 * Math.PI * hz * t) * Math.pow(0.001, t / 0.42) * 0.22);
  }
}
sweepLowpass(hit, () => 5200);

// ---------------------------------------------------------------------------
// A riser, to run into the drop
//
// Noise through a climbing highpass plus a rising sine. Placed by the
// composition so it lands ON the cut rather than near it.

const riser = mono(1.2);
{
  const n = riser.length;
  let prevIn = 0;
  let prevOut = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const p = t / 1.2;
    // Highpass climbs 200Hz -> 6kHz, which is what makes it feel like lift.
    const fc = 200 + Math.pow(p, 2) * 5800;
    const rc = 1 / (2 * Math.PI * fc);
    const a = rc / (rc + 1 / SR);
    const raw = rnd() * 2 - 1;
    const out = a * (prevOut + raw - prevIn);
    prevIn = raw;
    prevOut = out;
    // A sine sweeping up underneath it, and a hard duck in the last 40ms so the
    // riser gets out of the way of the kick it is announcing.
    const sine = Math.sin(2 * Math.PI * (120 + Math.pow(p, 2.4) * 900) * t);
    const duck = p > 0.968 ? (1 - p) / 0.032 : 1;
    write(riser, i, (out * 0.5 + sine * 0.1) * Math.pow(p, 1.5) * duck);
  }
}

// ---------------------------------------------------------------------------

function toWav(samples) {
  // Normalise to a fixed ceiling rather than to the peak, so regenerating with
  // a tweaked arrangement does not silently change the overall level.
  let peak = 0;
  for (const s of samples) peak = Math.max(peak, Math.abs(s));
  const gain = peak > 0 ? Math.min(1, 0.89 / peak) : 1;

  const buf = Buffer.alloc(44 + samples.length * 2);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + samples.length * 2, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(SR, 24);
  buf.writeUInt32LE(SR * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(samples.length * 2, 40);
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i] * gain));
    buf.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
  }
  return buf;
}

const suffix = CUT_NAME === "vertical" ? "" : `-${CUT_NAME}`;
mkdirSync(resolve(ROOT, "public/sfx"), { recursive: true });
writeFileSync(resolve(ROOT, `public/sfx/track${suffix}.wav`), toWav(track));
writeFileSync(resolve(ROOT, `public/sfx/hit${suffix}.wav`), toWav(hit));
writeFileSync(resolve(ROOT, `public/sfx/riser${suffix}.wav`), toWav(riser));

console.log(`track${suffix}.wav  ${DURATION.toFixed(2)}s  ${TOTAL_FRAMES} frames @ ${FPS}fps`);
console.log(`hit${suffix}.wav    0.70s`);
console.log(`riser${suffix}.wav  1.20s`);
console.log(`${BPM} BPM — ${(60 / BPM).toFixed(3)}s per beat, ${B.toFixed(3)} frames per beat`);
