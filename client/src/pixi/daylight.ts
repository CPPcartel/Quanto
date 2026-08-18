/**
 * Day and night, taken from the player's own device clock.
 *
 * `new Date()` in a browser is already local to the machine it runs on, so the
 * whole "get the time from the connecting device" problem is one call — the
 * work is everything after it: turning a clock reading into light.
 *
 * ---------------------------------------------------------------------------
 * Why the device clock and not the server's
 *
 * Every other number in this game is server-authoritative, because every other
 * number is worth cheating for. The sky is not: it pays nothing, gates nothing,
 * and spawns nothing. Setting your OS clock forward buys you a different
 * colour and no advantage whatsoever, which is exactly why it's safe to let the
 * client decide — and the schema's `serverTime` stays the source of truth for
 * anything that *does* pay out.
 *
 * The real trade-off is social: two players standing on the same corner in
 * different timezones see different skies. That's the cost of the city
 * matching the light outside your own window, and for a game people drop into
 * for twenty minutes it's the better half of the bargain. Flip
 * `DAYLIGHT_SOURCE` to "server" if a single shared sky ever matters more.
 *
 * ---------------------------------------------------------------------------
 * Why "day" here is not a blue sky
 *
 * The city's entire read is neon: every lit window is a floor a real player
 * owns, and that only works against darkness. A literal daytime sky would wash
 * out the one visual that carries the game's meaning. So the range runs from
 * deep night to an overcast blue-grey afternoon — the light plainly changes,
 * the glow survives it. This is a deliberate ceiling, not an unfinished
 * gradient.
 */

export type DaylightSource = "device" | "server";

/** Where the clock comes from. See the note above before changing this. */
export const DAYLIGHT_SOURCE: DaylightSource = "device";

/** Hours, in local time, that anchor the transitions. */
const DAWN_START = 5.0;
const DAWN_END = 7.5;
const DUSK_START = 17.0;
const DUSK_END = 19.5;

export type SkyPhase = "night" | "dawn" | "day" | "dusk";

export interface Daylight {
  /** 0 = full night, 1 = full day. Smooth across dawn and dusk. */
  sun: number;
  phase: SkyPhase;
  /** Local hour as a fraction, e.g. 18.5 for 18:30. */
  hour: number;
  /** Sky gradient, top and bottom, as 0xRRGGBB. */
  skyTop: number;
  skyBottom: number;
  /**
   * How much artificial light the city should be running: 1 in the dark, 0 at
   * noon. Not simply `1 - sun` — streetlights come on before it is fully dark
   * and stay on a while after dawn, which is both true and more legible.
   */
  lamps: number;
}

/**
 * Local hour as a fraction of the day.
 *
 * `getHours()` is already the device's local time — no timezone maths, no
 * `Intl`, no offset juggling. Minutes are folded in so the sky drifts
 * continuously instead of stepping once an hour.
 */
export function localHour(now: Date = new Date()): number {
  return now.getHours() + now.getMinutes() / 60 + now.getSeconds() / 3600;
}

/** Hermite ease. Keeps dawn from arriving as a hard edge. */
function smoothstep(t: number): number {
  const x = Math.max(0, Math.min(1, t));
  return x * x * (3 - 2 * x);
}

/** How high the sun is, 0..1, for a local hour. */
export function sunAt(hour: number): number {
  const h = ((hour % 24) + 24) % 24;
  if (h <= DAWN_START || h >= DUSK_END) return 0;
  if (h >= DAWN_END && h <= DUSK_START) return 1;
  if (h < DAWN_END) return smoothstep((h - DAWN_START) / (DAWN_END - DAWN_START));
  return 1 - smoothstep((h - DUSK_START) / (DUSK_END - DUSK_START));
}

function phaseAt(hour: number, sun: number): SkyPhase {
  if (sun <= 0.02) return "night";
  if (sun >= 0.98) return "day";
  return hour < 12 ? "dawn" : "dusk";
}

// ---------------------------------------------------------------------------
// Palette
// ---------------------------------------------------------------------------

/**
 * Sky keyframes, darkest first. `at` is the sun value each colour belongs to,
 * so the gradient is interpolated by light level rather than by clock — which
 * is what makes dawn and dusk share the same warm band without special-casing
 * either.
 */
const SKY_KEYS: Array<{ at: number; top: number; bottom: number }> = [
  { at: 0.0, top: 0x04050b, bottom: 0x0b0f1c }, // deep night
  { at: 0.18, top: 0x0d0a1e, bottom: 0x2a1630 }, // first light / last light
  { at: 0.42, top: 0x1a1533, bottom: 0x63304a }, // the warm band
  { at: 0.7, top: 0x1d2542, bottom: 0x4a5570 }, // early morning, late afternoon
  { at: 1.0, top: 0x223051, bottom: 0x5b6b8a }, // overcast afternoon — the ceiling
];

function mixChannel(a: number, b: number, t: number, shift: number): number {
  const ca = (a >> shift) & 0xff;
  const cb = (b >> shift) & 0xff;
  return Math.round(ca + (cb - ca) * t) << shift;
}

/** Blend two packed colours. */
export function mixColor(a: number, b: number, t: number): number {
  const k = Math.max(0, Math.min(1, t));
  return mixChannel(a, b, k, 16) | mixChannel(a, b, k, 8) | mixChannel(a, b, k, 0);
}

function skyFor(sun: number): { top: number; bottom: number } {
  for (let i = 1; i < SKY_KEYS.length; i++) {
    const prev = SKY_KEYS[i - 1];
    const next = SKY_KEYS[i];
    if (sun <= next.at) {
      const span = next.at - prev.at;
      const t = span <= 0 ? 0 : (sun - prev.at) / span;
      return { top: mixColor(prev.top, next.top, t), bottom: mixColor(prev.bottom, next.bottom, t) };
    }
  }
  const last = SKY_KEYS[SKY_KEYS.length - 1];
  return { top: last.top, bottom: last.bottom };
}

/**
 * Everything the renderer needs for one frame.
 *
 * `serverMs` is used only when DAYLIGHT_SOURCE is "server"; passing it always
 * keeps the call site identical either way.
 */
export function daylight(serverMs = 0): Daylight {
  const now =
    DAYLIGHT_SOURCE === "server" && serverMs > 0 ? new Date(serverMs) : new Date();

  const hour = localHour(now);
  const sun = sunAt(hour);
  const sky = skyFor(sun);

  return {
    sun,
    hour,
    phase: phaseAt(hour, sun),
    skyTop: sky.top,
    skyBottom: sky.bottom,
    // Lamps lead the darkness slightly and linger past dawn: they are already
    // on at dusk while there is still light in the sky, which is how streets
    // actually look and reads far better than snapping at zero.
    lamps: Math.max(0, Math.min(1, 1 - sun * 1.35)),
  };
}

/**
 * Multiplicative tint for the solid parts of the world — ground, road, building
 * bodies, street furniture.
 *
 * This, not the sky, is what actually sells the time of day. The city's ground
 * plane spans the whole playfield and fills the screen at street zoom, so the
 * sky gradient is only visible when pulled right out; darkening the surfaces
 * themselves is what a player standing on a corner sees.
 *
 * Applied to solid geometry ONLY. Lit windows, neon signs and lamp glow keep
 * their full brightness, because the contrast between a dim street and bright
 * windows *is* the night look — a uniform screen-wide dimming darkens the neon
 * along with everything else and just produces a murky grey city.
 *
 * Night is cool rather than merely dark: an even grey reads as "the monitor
 * turned down", a blue shift reads as evening.
 */
const NIGHT_TINT = 0x5d6b9c;

export function worldTint(sun: number): number {
  return mixColor(NIGHT_TINT, 0xffffff, Math.max(0, Math.min(1, sun)));
}

/** Human-readable clock for the HUD, in the device's own locale. */
export function clockLabel(now: Date = new Date()): string {
  return now.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}
