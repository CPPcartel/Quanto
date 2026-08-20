import { world } from "../net/world";
import { CLUB_FALLOFF } from "./clubZone";

/**
 * The Vault's music, generated in the browser.
 *
 * Every sound here comes out of oscillators and noise — there are no audio
 * files, which means no licensing, no bandwidth, and nothing for the artifact
 * CSP to block. It also fits the rest of the project: the art, the city and the
 * NFT portraits are all generated rather than authored.
 *
 * ---------------------------------------------------------------------------
 * It reacts to the real market
 *
 * Tempo runs from 110 BPM when the tape is calm to 150 during a volatility
 * storm, and the filter opens as it climbs. The club literally gets harder when
 * the market moves, which is a thing only this game can do — `clubIntensity` is
 * computed server-side from the same feeds the skyline is built from.
 *
 * ---------------------------------------------------------------------------
 * Autoplay
 *
 * Browsers refuse to start audio without a user gesture, and a suspended
 * context produces silence with no error — which is very hard to diagnose
 * later. So the context is created suspended, `resume()` is wired to the first
 * pointer or key event, and `state` is reported to the HUD.
 */

const BPM_CALM = 110;
const BPM_PEAK = 150;

/** Master ceiling. Even "full" should not be the loudest thing on the machine. */
const MAX_GAIN = 0.22;

const STORAGE_KEY = "quanto.audio";
/** Pre-rename key. Only a mute preference, but free to carry over. */
const LEGACY_STORAGE_KEY = "candlestick.audio";

type Ready = "idle" | "blocked" | "running";

class ClubAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private filter: BiquadFilterNode | null = null;

  private timer = 0;
  private step = 0;
  /** When the next 16th note is due, on the audio clock. */
  private nextNoteAt = 0;

  private enabled = false;
  ready: Ready = "idle";

  constructor() {
    // Muted by default. Audio that starts on its own is the fastest way to make
    // someone close a tab.
    try {
      this.enabled =
        (localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_STORAGE_KEY)) === "on";
    } catch {
      this.enabled = false;
    }
  }

  get isEnabled() {
    return this.enabled;
  }

  /**
   * Called from the first real user gesture. Safe to call repeatedly.
   */
  unlock() {
    if (!this.enabled) return;
    this.ensureContext();
    if (this.ctx?.state === "suspended") {
      this.ctx.resume().then(
        () => {
          this.ready = "running";
        },
        () => {
          this.ready = "blocked";
        }
      );
    }
  }

  toggle(): boolean {
    this.enabled = !this.enabled;
    try {
      localStorage.setItem(STORAGE_KEY, this.enabled ? "on" : "off");
    } catch {
      /* private mode; the setting simply will not persist */
    }

    if (this.enabled) this.unlock();
    else this.silence();
    return this.enabled;
  }

  private ensureContext() {
    if (this.ctx) return;
    const Ctor: typeof AudioContext | undefined =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) {
      this.ready = "blocked";
      return;
    }

    this.ctx = new Ctor();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0;

    // One filter across everything: sweeping it is most of what makes a build
    // feel like a build, for one node.
    this.filter = this.ctx.createBiquadFilter();
    this.filter.type = "lowpass";
    this.filter.frequency.value = 700;
    this.filter.Q.value = 1.1;

    this.filter.connect(this.master);
    this.master.connect(this.ctx.destination);
    this.nextNoteAt = this.ctx.currentTime;
    this.ready = this.ctx.state === "running" ? "running" : "blocked";
  }

  private silence() {
    if (!this.master || !this.ctx) return;
    this.master.gain.cancelScheduledValues(this.ctx.currentTime);
    this.master.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05);
  }

  /**
   * Advance the sequencer. Called every frame from the render loop.
   *
   * Notes are scheduled slightly ahead on the audio clock rather than fired on
   * the frame, because frame timing jitters and a jittering kick drum is
   * immediately audible.
   */
  update() {
    if (!this.enabled || !this.ctx || !this.master || !this.filter) return;
    if (this.ctx.state !== "running") return;
    this.ready = "running";

    /**
     * Volume falls off with distance from the venue, so the music bleeds onto
     * the street and pulls people toward it rather than switching on at a
     * boundary.
     */
    const club = world.parks.find((p) => p.kind === "club");
    let proximity = 0;
    if (club) {
      const d = Math.hypot(world.local.x - club.x, world.local.z - club.z);
      proximity = Math.max(0, 1 - Math.max(0, d - club.half) / CLUB_FALLOFF);
    }

    const intensity = world.clubIntensity || 0.28;
    const target = MAX_GAIN * proximity * (0.55 + intensity * 0.45);
    this.master.gain.setTargetAtTime(target, this.ctx.currentTime, 0.15);

    // Nothing to schedule if it is inaudible out here.
    if (proximity <= 0.001) return;

    this.filter.frequency.setTargetAtTime(
      600 + intensity * 5200,
      this.ctx.currentTime,
      0.25
    );

    const bpm = BPM_CALM + (BPM_PEAK - BPM_CALM) * intensity;
    const sixteenth = 60 / bpm / 4;

    // Schedule ~120ms ahead. Enough to ride out a dropped frame, short enough
    // that a tempo change is heard almost immediately.
    while (this.nextNoteAt < this.ctx.currentTime + 0.12) {
      this.scheduleStep(this.step, this.nextNoteAt, intensity);
      this.nextNoteAt += sixteenth;
      this.step = (this.step + 1) % 16;
    }

    void this.timer;
  }

  /** One 16th note of a very simple four-to-the-floor pattern. */
  private scheduleStep(step: number, at: number, intensity: number) {
    const ctx = this.ctx!;
    const out = this.filter!;

    // Kick on every beat.
    if (step % 4 === 0) this.kick(ctx, out, at);

    // Offbeat hat, doubling up as it gets busier.
    if (step % 4 === 2 || (intensity > 0.6 && step % 2 === 1)) {
      this.hat(ctx, out, at, intensity);
    }

    // A rolling bass line — the pattern is fixed, the notes come from a minor
    // scale so it cannot land on anything sour.
    if (step % 2 === 0) {
      const scale = [55, 55, 65.41, 55, 73.42, 55, 82.41, 61.74];
      this.bass(ctx, out, at, scale[(step / 2) % 8], intensity);
    }

    // A stab on the last eighth of the bar, only when it is busy.
    if (intensity > 0.75 && step === 14) this.stab(ctx, out, at);
  }

  private kick(ctx: AudioContext, out: AudioNode, at: number) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.setValueAtTime(150, at);
    osc.frequency.exponentialRampToValueAtTime(45, at + 0.11);
    gain.gain.setValueAtTime(1, at);
    gain.gain.exponentialRampToValueAtTime(0.001, at + 0.24);
    osc.connect(gain).connect(out);
    osc.start(at);
    osc.stop(at + 0.26);
  }

  private hat(ctx: AudioContext, out: AudioNode, at: number, intensity: number) {
    // White noise through a highpass — cheaper and crisper than an oscillator.
    const len = Math.floor(ctx.sampleRate * 0.04);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);

    const src = ctx.createBufferSource();
    src.buffer = buf;
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 7000;
    const gain = ctx.createGain();
    gain.gain.value = 0.12 + intensity * 0.14;
    src.connect(hp).connect(gain).connect(out);
    src.start(at);
  }

  private bass(ctx: AudioContext, out: AudioNode, at: number, hz: number, intensity: number) {
    const osc = ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.value = hz;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(0.16 + intensity * 0.1, at + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.16);
    osc.connect(gain).connect(out);
    osc.start(at);
    osc.stop(at + 0.18);
  }

  private stab(ctx: AudioContext, out: AudioNode, at: number) {
    // A minor triad, short and bright.
    for (const hz of [440, 523.25, 659.25]) {
      const osc = ctx.createOscillator();
      osc.type = "square";
      osc.frequency.value = hz;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.05, at + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.2);
      osc.connect(gain).connect(out);
      osc.start(at);
      osc.stop(at + 0.22);
    }
  }
}

export const clubAudio = new ClubAudio();
