/**
 * The Quanto Residents trait schema.
 *
 * This is the contract between three things that must agree exactly: the NFT
 * metadata minted on OpenSea, the server's tier resolution, and the sprite
 * renderer. The collection is immutable once deployed, so this table is
 * effectively frozen at mint — treat additions as a new collection, never as an
 * edit.
 *
 * ---------------------------------------------------------------------------
 * Why the names are duplicated on the server
 *
 * `server/src/config/traits.ts` carries the same value NAMES so it can turn
 * metadata attributes into indices without knowing anything about colour.
 * Duplication across two npm packages is a real hazard — this project has
 * already been bitten twice by two sides deriving the same thing independently
 * (roads vs buildings, and the park lot hash) — so `scripts/test-traits.mjs`
 * asserts the two lists are identical and fails the build if they drift.
 *
 * ---------------------------------------------------------------------------
 * Wire format
 *
 * Traits travel as a six-character string, one base36 digit per slot, in the
 * order below: `jacket collar hair visor skin accessory`. At 150 players and
 * 20Hz, replicating readable names instead would cost roughly forty times the
 * bandwidth for information the client can reconstruct from an index.
 */

export const TRAIT_SLOTS = ["jacket", "collar", "hair", "visor", "skin", "accessory"] as const;
export type TraitSlot = (typeof TRAIT_SLOTS)[number];

/**
 * Canonical values, in metadata order. **Index is identity** — reordering this
 * table silently repaints every token that has already been minted.
 */
export const TRAIT_VALUES: Record<TraitSlot, ReadonlyArray<{ name: string; hex: string }>> = {
  jacket: [
    { name: "Midnight", hex: "#4F4DC4" },
    { name: "Moss", hex: "#2E7A52" },
    { name: "Rust", hex: "#A6402F" },
    { name: "Amber", hex: "#A8641F" },
    { name: "Violet", hex: "#5B54C9" },
    { name: "Coral", hex: "#DB7264" },
    { name: "Steel", hex: "#5B8DEF" },
    { name: "Sand", hex: "#E5A85C" },
    { name: "Ink", hex: "#26293D" },
    { name: "Bone", hex: "#C9C4BA" },
  ],
  collar: [
    { name: "Cyan", hex: "#22E8FF" },
    { name: "Magenta", hex: "#FF2D95" },
    { name: "Lime", hex: "#3BFF8F" },
    { name: "Amber", hex: "#FFB347" },
    { name: "Violet", hex: "#A855F7" },
    { name: "Red", hex: "#FF4D5E" },
  ],
  hair: [
    { name: "Black", hex: "#1A1B24" },
    { name: "Brown", hex: "#4A3524" },
    { name: "Blonde", hex: "#C9A227" },
    { name: "Grey", hex: "#8A8F9E" },
    { name: "Teal", hex: "#1F6F6B" },
    { name: "Pink", hex: "#C2508A" },
  ],
  visor: [
    { name: "Cyan", hex: "#22E8FF" },
    { name: "Amber", hex: "#FFB347" },
    { name: "Lime", hex: "#3BFF8F" },
    { name: "Magenta", hex: "#FF2D95" },
    { name: "Clear", hex: "#D6E4F0" },
  ],
  skin: [
    { name: "Porcelain", hex: "#E8C4A8" },
    { name: "Sand", hex: "#D9A283" },
    { name: "Bronze", hex: "#B07A52" },
    { name: "Umber", hex: "#7A4E33" },
    { name: "Deep", hex: "#4E3122" },
  ],
  accessory: [
    { name: "None", hex: "#000000" },
    { name: "Cap", hex: "#3E4A6B" },
    { name: "Headphones", hex: "#4E5A7A" },
    { name: "Antenna", hex: "#22E8FF" },
    { name: "Halo", hex: "#FFD166" },
  ],
};

/** Resolved colours for one token, ready to render. */
export interface Traits {
  jacket: string;
  collar: string;
  hair: string;
  visor: string;
  skin: string;
  /** Index into TRAIT_VALUES.accessory — 0 is "None". */
  accessory: number;
  accessoryHex: string;
  /** The six-character wire code this was decoded from. */
  code: string;
}

const BASE36 = "0123456789abcdefghijklmnopqrstuvwxyz";

/** Encode trait indices to the wire format. */
export function encodeTraits(indices: Record<TraitSlot, number>): string {
  return TRAIT_SLOTS.map((slot) => {
    const max = TRAIT_VALUES[slot].length - 1;
    const i = Math.max(0, Math.min(max, Math.floor(indices[slot] ?? 0)));
    return BASE36[i];
  }).join("");
}

/**
 * Decode the wire format into renderable colours.
 *
 * Never throws. A malformed or empty code yields slot 0 across the board, which
 * is a perfectly ordinary-looking resident — a player with corrupt trait data
 * should look plain, not invisible.
 */
export function decodeTraits(code: string): Traits {
  const safe = typeof code === "string" ? code : "";
  const at = (slot: TraitSlot, position: number) => {
    const values = TRAIT_VALUES[slot];
    const index = BASE36.indexOf(safe[position] ?? "0");
    return index >= 0 && index < values.length ? index : 0;
  };

  const accessory = at("accessory", 5);
  return {
    jacket: TRAIT_VALUES.jacket[at("jacket", 0)].hex,
    collar: TRAIT_VALUES.collar[at("collar", 1)].hex,
    hair: TRAIT_VALUES.hair[at("hair", 2)].hex,
    visor: TRAIT_VALUES.visor[at("visor", 3)].hex,
    skin: TRAIT_VALUES.skin[at("skin", 4)].hex,
    accessory,
    accessoryHex: TRAIT_VALUES.accessory[accessory].hex,
    code: safe.slice(0, 6) || "000000",
  };
}

/**
 * Traits for a player with no NFT.
 *
 * Derived from the colour the server already assigns every player, so a guest
 * looks exactly as they do today. Holders differ by having *chosen* traits, not
 * by being the only ones who are drawn.
 */
export function traitsFromColor(color: string): Traits {
  const jacket = TRAIT_VALUES.jacket.findIndex(
    (v) => v.hex.toLowerCase() === color.toLowerCase()
  );
  return decodeTraits(encodeTraits({
    jacket: jacket >= 0 ? jacket : 0,
    collar: 0,
    hair: 0,
    visor: 0,
    skin: 1,
    accessory: 0,
  }));
}

/** Human-readable names, for the collection panel. */
export function describeTraits(code: string): Array<{ slot: TraitSlot; name: string }> {
  const safe = typeof code === "string" ? code : "";
  return TRAIT_SLOTS.map((slot, i) => {
    const values = TRAIT_VALUES[slot];
    const index = BASE36.indexOf(safe[i] ?? "0");
    return { slot, name: values[index >= 0 && index < values.length ? index : 0].name };
  });
}
