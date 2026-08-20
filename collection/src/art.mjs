import { Grid, shade, tintUp, mix } from "./png.mjs";
import { drawText, textWidth, GLYPH_H } from "./font.mjs";

/**
 * The Quanto Resident portrait.
 *
 * A 32x32 bust, not the 20x34 walk sprite the game renders. Those are the same
 * character described by the same traits, but they answer different questions:
 * the walk sprite has to read at street zoom among a hundred others, and this
 * has to read as a 200px thumbnail in a marketplace grid. Shipping the walk
 * sprite as the PFP would be a tiny figure lost in empty space.
 *
 * Trait values are the ones the game already uses, imported rather than
 * redeclared, so a token's portrait and its in-game avatar cannot disagree.
 */

export const GRID = 32;

/**
 * Backgrounds by tier. Rarity has to be legible before anyone reads the text.
 *
 * All three stay DARK. A first pass gave Penthouse a light gold ground on the
 * theory that rare should look bright — it read as muddy olive, the jacket lost
 * all contrast against it, and lime collar specks looked like mould. Rarity is
 * carried by the frame and the tower mark instead, which works because every
 * portrait then shares the same night-city ground the game does.
 */
const TIER_BACKDROP = {
  resident:  { base: "#141A2A", glow: "#1E2740", frame: null },
  landlord:  { base: "#0E2230", glow: "#123549", frame: "#22E8FF" },
  penthouse: { base: "#16120A", glow: "#2A2010", frame: "#FFD166" },
};

/**
 * Draw one portrait.
 *
 * `traits` carries resolved hex colours (see traits.mjs); `tier` and `tower`
 * come from the supply plan.
 */
export function drawPortrait(traits, tier, tower, seed, options = {}) {
  const g = new Grid(GRID);
  const rand = mulberry(seed);
  const back = TIER_BACKDROP[tier] ?? TIER_BACKDROP.resident;

  drawBackdrop(g, back, traits, rand);
  drawShoulders(g, traits, options.shirtText, options.shirtTextColor, options.shirtY);
  drawNeckAndHead(g, traits);
  drawHair(g, traits);
  drawFace(g, traits);
  drawAccessory(g, traits);

  /**
   * A square frame is wrong for anything cropped round.
   *
   * X renders profile pictures as circles, which slices a rectangular border
   * into four disconnected arcs — they read as rendering glitches rather than
   * as a frame. `options.ring` draws the border ON the circle instead, so the
   * crop completes it rather than breaking it.
   */
  if (options.ring) drawRing(g, options.ring);
  else if (back.frame) drawFrame(g, back.frame, tier);

  if (tier === "penthouse" && tower && !options.pfp) drawSkylineMark(g, traits);

  return g;
}

/** A one-pixel ring on the circle X will crop to. */
function drawRing(g, colour) {
  const r = GRID / 2 - 0.5;
  const centre = (GRID - 1) / 2;
  for (let y = 0; y < GRID; y++) {
    for (let x = 0; x < GRID; x++) {
      const d = Math.hypot(x - centre, y - centre);
      if (d <= r + 0.5 && d > r - 1.1) g.set(x, y, colour);
    }
  }
}

// ---------------------------------------------------------------------------

function drawBackdrop(g, back, traits, rand) {
  g.clear(back.base);

  // A soft vertical lift, so the silhouette separates from the ground rather
  // than sitting flat on it.
  for (let y = 0; y < GRID; y++) {
    const t = 1 - y / GRID;
    g.rect(0, y, GRID, 1, mix(back.base, back.glow, t * 0.85));
  }

  /**
   * Lit windows, confined to the upper sky.
   *
   * An earlier version scattered these across the whole frame and put two tall
   * towers either side of the head. At 32px that read as dark pillars flanking
   * the face — and on the headphones trait the ear cups collided with them. The
   * character has to be unambiguously the subject, so the city sits low and
   * behind.
   */
  const count = 10 + Math.floor(rand() * 8);
  for (let i = 0; i < count; i++) {
    const x = Math.floor(rand() * GRID);
    const y = Math.floor(rand() * 11);
    g.set(x, y, mix(back.glow, traits.collar, 0.22 + rand() * 0.22));
  }

  /**
   * A low skyline along the bottom, mostly hidden by the shoulders.
   *
   * Only the outer few columns are ever visible, which is enough to say "city"
   * without competing with the face. Heights are seeded so no two tokens share
   * a horizon.
   */
  const silhouette = mix(back.base, "#000000", 0.45);
  for (let x = 0; x < GRID; x += 2) {
    const h = 4 + Math.floor(rand() * 8);
    const top = GRID - 6 - h;
    g.rect(x, top, 2, h + 6, silhouette);
    // One lit window per tower, dim.
    if (rand() > 0.45) g.set(x + (rand() > 0.5 ? 0 : 1), top + 2, mix(silhouette, traits.collar, 0.3));
  }
}

function drawShoulders(g, t, shirtText, shirtTextColor, shirtY) {
  const jacket = t.jacket;

  // Torso block, widening toward the bottom edge so it reads as a bust.
  g.rect(6, 25, 20, 7, shade(jacket, 0.15));
  g.rect(7, 24, 18, 1, shade(jacket, 0.25));
  g.rect(4, 27, 24, 5, shade(jacket, 0.1));
  g.rect(3, 29, 26, 3, jacket);

  // Lit edge on the north-east, matching the city's light direction.
  g.rect(20, 25, 5, 7, tintUp(jacket, 0.12));
  g.rect(24, 27, 4, 5, tintUp(jacket, 0.08));

  /**
   * Lapels, or a print — not both.
   *
   * The lapels sit at x=11..13 and x=18..20, which is exactly the chest a print
   * needs. Drawing both turns the text into stripes. A shirt with something
   * written on it is a tee, so it loses the jacket lapels and gains a print.
   */
  if (shirtText) {
    const w = textWidth(shirtText);
    const x = Math.round((GRID - w) / 2);
    /**
     * One row higher when this is destined for a circular crop.
     *
     * At y=26 the last row of text sits exactly on the circle's edge, where the
     * chord is only as wide as the text itself — the panel behind it got sliced
     * and the print looked like it was falling out of frame.
     */
    const y = shirtY ?? 24;
    // A darker panel behind the print, so it reads on any jacket colour rather
    // than only on the dark ones.
    g.rect(x - 2, y - 1, w + 4, GLYPH_H + 2, shade(jacket, 0.45));
    drawText(g, shirtText, x, y, shirtTextColor || tintUp(t.collar, 0.25));
  } else {
    g.rect(11, 24, 3, 6, shade(jacket, 0.4));
    g.rect(18, 24, 3, 6, shade(jacket, 0.4));
  }

  /**
   * The neon collar — the cyberpunk tell, and the one saturated line at this
   * scale. Two rows normally; one when the shirt carries a print.
   *
   * Row 24 is the only place a print fits without being clipped by a circular
   * crop, measured rather than guessed: at y=25 one pixel falls under the ring,
   * at y=26 twelve do. So the collar yields that row rather than the text
   * losing its baseline.
   */
  g.rect(11, 23, 10, 1, t.collar);
  if (!shirtText) {
    g.rect(12, 24, 8, 1, mix(t.collar, jacket, 0.45));
    g.set(10, 24, mix(t.collar, jacket, 0.6));
    g.set(21, 24, mix(t.collar, jacket, 0.6));
  }
}

function drawNeckAndHead(g, t) {
  const skin = t.skin;

  // Neck, shaded by the jaw above it.
  g.rect(13, 20, 6, 4, shade(skin, 0.3));
  g.rect(13, 20, 6, 2, shade(skin, 0.45));

  // Head. Slightly narrower at the jaw than the temples.
  g.rect(10, 7, 12, 13, skin);
  g.rect(11, 6, 10, 1, skin);
  g.rect(11, 20, 10, 1, shade(skin, 0.12));
  g.rect(12, 21, 8, 1, shade(skin, 0.22));

  // Ears.
  g.rect(9, 12, 1, 3, shade(skin, 0.18));
  g.rect(22, 12, 1, 3, shade(skin, 0.18));

  // Form: left side falls into shadow, right catches the light.
  g.rect(10, 7, 2, 13, shade(skin, 0.22));
  g.rect(20, 8, 2, 12, tintUp(skin, 0.1));
}

/**
 * Hair, where the collection gets its silhouette variety.
 *
 * The cut is chosen by the hair TRAIT VALUE, not by a hidden random — so
 * "Blonde" is a specific look, and everything visible in the portrait is
 * described by something in the metadata. A first pass gave every token the
 * same flat cap of hair in a different colour, and fifty of them side by side
 * looked like one character recoloured fifty times.
 */
function drawHair(g, t) {
  const hair = t.hair;
  const lit = tintUp(hair, 0.22);
  const dark = shade(hair, 0.28);

  switch (t.ix.hair) {
    case 0: // Black — short crop, straight fringe.
      g.rect(10, 4, 12, 5, hair);
      g.rect(9, 6, 14, 3, hair);
      g.rect(10, 9, 12, 1, dark);
      g.rect(15, 4, 7, 1, lit);
      break;

    case 1: // Brown — side part, fringe swept to one side.
      g.rect(10, 5, 12, 4, hair);
      g.rect(9, 7, 14, 2, hair);
      g.rect(10, 9, 7, 2, hair);
      g.rect(17, 9, 5, 1, dark);
      g.rect(9, 9, 1, 4, dark);
      g.rect(16, 5, 6, 1, lit);
      break;

    case 2: // Blonde — spiked, deliberately uneven. Five equal spikes read as
      // a crown, which is confusing next to the Halo accessory.
      g.rect(10, 6, 12, 3, hair);
      g.rect(9, 8, 14, 1, hair);
      const spikes = [
        [10, 4, 2, 3],
        [13, 3, 2, 4],
        [16, 5, 2, 2],
        [18, 3, 3, 4],
      ];
      for (const [x, y, w, h] of spikes) {
        g.rect(x, y, w, h, hair);
        g.rect(x, y, w, 1, lit);
      }
      g.rect(10, 9, 12, 1, dark);
      break;

    case 3: // Grey — slicked back, high forehead.
      g.rect(10, 4, 12, 3, hair);
      g.rect(9, 5, 14, 3, hair);
      g.rect(9, 8, 2, 5, dark);
      g.rect(21, 8, 2, 5, dark);
      g.rect(11, 4, 10, 1, lit);
      break;

    case 4: // Teal — bowl cut, long over the ears.
      g.rect(10, 4, 12, 5, hair);
      g.rect(8, 6, 16, 4, hair);
      g.rect(8, 10, 2, 5, hair);
      g.rect(22, 10, 2, 5, hair);
      g.rect(10, 10, 12, 1, dark);
      g.rect(15, 4, 7, 1, lit);
      break;

    default: // Pink — tousled, uneven strands.
      g.rect(10, 5, 12, 4, hair);
      g.rect(9, 7, 14, 2, hair);
      g.rect(10, 3, 3, 3, hair);
      g.rect(15, 2, 3, 4, hair);
      g.rect(19, 4, 3, 2, hair);
      g.rect(9, 9, 2, 3, hair);
      g.rect(21, 9, 2, 2, hair);
      g.set(16, 2, lit);
      g.set(11, 3, lit);
      break;
  }
}

function drawFace(g, t) {
  // Visor across the eyes — this is the project's signature, and at 32px it
  // reads far better than two pixel eyes would.
  g.rect(10, 12, 12, 3, shade("#05060C", 0));
  g.rect(11, 13, 10, 1, t.visor);
  g.rect(11, 12, 4, 1, mix(t.visor, "#FFFFFF", 0.45));
  g.rect(17, 14, 4, 1, mix(t.visor, "#000000", 0.35));

  // Visor frame, so it sits on the face rather than floating.
  g.rect(9, 12, 1, 3, shade(t.skin, 0.5));
  g.rect(22, 12, 1, 3, shade(t.skin, 0.5));

  // Mouth: one short line, shaded.
  g.rect(14, 18, 4, 1, shade(t.skin, 0.42));
}

function drawAccessory(g, t) {
  const hex = t.accessoryHex;

  switch (t.accessory) {
    case 1: // Cap — sits ON the hair rather than replacing it. An earlier
      // version covered the whole crown, which hid the hair cut entirely and
      // made every capped token look like it was wearing the same grey brick.
      g.rect(10, 3, 12, 4, hex);
      g.rect(11, 2, 10, 1, tintUp(hex, 0.28));
      g.rect(10, 3, 12, 1, tintUp(hex, 0.16));
      g.rect(9, 4, 1, 3, shade(hex, 0.25));
      g.rect(22, 4, 1, 3, shade(hex, 0.25));
      // Brim, forward and short, with a lit top edge so it reads as separate
      // from the face beneath.
      g.rect(9, 7, 13, 1, tintUp(hex, 0.1));
      g.rect(9, 8, 12, 1, shade(hex, 0.45));
      break;

    case 2: // Headphones — cups sit OUTSIDE the visor line. A first pass put
      // them at x=7 and x=22, which is exactly where the visor frame lives, so
      // they read as grey blocks stuck to the face rather than as headphones.
      g.rect(10, 2, 12, 2, hex);
      g.rect(11, 1, 10, 1, tintUp(hex, 0.3));
      g.rect(8, 3, 2, 3, hex);
      g.rect(22, 3, 2, 3, hex);
      // Cups, clear of the face, with a darker inner pad so they read as worn.
      g.rect(6, 10, 3, 7, hex);
      g.rect(23, 10, 3, 7, hex);
      g.rect(7, 11, 2, 5, shade(hex, 0.35));
      g.rect(24, 11, 2, 5, shade(hex, 0.35));
      g.rect(6, 10, 3, 1, tintUp(hex, 0.25));
      g.rect(23, 10, 3, 1, tintUp(hex, 0.25));
      break;

    case 3: // Antenna — kept fully inside the frame; running to y=0 made it
      // look like a wire attached to the border rather than to the character.
      g.rect(20, 2, 1, 4, shade(hex, 0.35));
      g.rect(19, 1, 3, 2, hex);
      g.set(20, 1, tintUp(hex, 0.65));
      g.set(19, 3, shade(hex, 0.5));
      break;

    case 4: // Halo — floats clear of the head so it reads as separate.
      g.rect(11, 1, 10, 1, hex);
      g.rect(10, 2, 1, 1, hex);
      g.rect(21, 2, 1, 1, hex);
      g.rect(12, 2, 8, 1, mix(hex, "#FFFFFF", 0.35));
      break;
  }
}

/** A one-pixel border, used to make the rare tiers obvious at thumbnail size. */
function drawFrame(g, colour, tier) {
  const n = GRID - 1;
  g.rect(0, 0, GRID, 1, colour);
  g.rect(0, n, GRID, 1, colour);
  g.rect(0, 0, 1, GRID, colour);
  g.rect(n, 0, 1, GRID, colour);

  if (tier === "penthouse") {
    // Corner marks, so a Penthouse is distinguishable from a Landlord even in
    // greyscale or at very small sizes.
    const bright = tintUp(colour, 0.5);
    for (const [x, y] of [[1, 1], [n - 1, 1], [1, n - 1], [n - 1, n - 1]]) {
      g.set(x, y, bright);
    }
    g.rect(2, 1, 2, 1, bright);
    g.rect(n - 3, 1, 2, 1, bright);
  }
}

/**
 * The Penthouse tell: a small lit tower behind the shoulder.
 *
 * Penthouse tokens name a real company, so the portrait carries a building the
 * others do not. It is the only piece of art that differs structurally rather
 * than by palette.
 */
function drawSkylineMark(g, t) {
  const gold = "#FFD166";
  // A lit tower behind the shoulder — the only structural difference between a
  // Penthouse portrait and any other, so it has to survive a thumbnail.
  g.rect(25, 5, 5, 9, "#0B0904");
  g.rect(25, 4, 5, 1, gold);
  g.rect(26, 6, 1, 1, gold);
  g.rect(28, 7, 1, 1, gold);
  g.rect(26, 9, 1, 1, mix(gold, t.collar, 0.45));
  g.rect(28, 11, 1, 1, gold);
  g.rect(26, 12, 1, 1, mix(gold, t.collar, 0.3));
}

/** Small deterministic PRNG. Same token in, same portrait out, always. */
export function mulberry(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
