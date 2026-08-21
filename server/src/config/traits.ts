/**
 * The Quanto Residents trait schema, server side.
 *
 * The server's only job here is turning NFT metadata attributes into indices,
 * so it carries the value **names** and nothing about colour — the renderer owns
 * appearance. Keeping colour out means a palette tweak never needs a server
 * deploy, and the server never has an opinion it could disagree with.
 *
 * ---------------------------------------------------------------------------
 * This table is duplicated in `client/src/pixi/traits.ts` and MUST match it.
 *
 * Two packages deriving the same thing independently is how this project broke
 * twice before — roads painted on a texture-space period while buildings avoided
 * a world-space grid, and park lots claimed with a different hash than the one
 * the filler used. Both looked fine until they didn't.
 *
 * `client/scripts/test-traits.mjs` reads both files and fails if the name lists
 * differ, so the duplication is checked rather than hoped for.
 *
 * **Index is identity.** Reordering any list silently repaints every token that
 * has already been minted, because the wire format carries positions, not names.
 */

export const TRAIT_SLOTS = ["jacket", "collar", "hair", "visor", "skin", "accessory"] as const;
export type TraitSlot = (typeof TRAIT_SLOTS)[number];

export const TRAIT_NAMES: Record<TraitSlot, readonly string[]> = {
  jacket: ["Midnight", "Moss", "Rust", "Amber", "Violet", "Coral", "Steel", "Sand", "Ink", "Bone"],
  collar: ["Cyan", "Magenta", "Lime", "Amber", "Violet", "Red"],
  hair: ["Black", "Brown", "Blonde", "Grey", "Teal", "Pink"],
  visor: ["Cyan", "Amber", "Lime", "Magenta", "Clear"],
  skin: ["Porcelain", "Sand", "Bronze", "Umber", "Deep"],
  accessory: ["None", "Cap", "Headphones", "Antenna", "Halo"],
};

/**
 * Trait options that only NFT holders may wear.
 *
 * The collection defines how residents look, so letting anyone assemble any
 * appearance would quietly remove the reason to hold one. Reserving a handful of
 * options keeps a Resident visibly worth something without taking customisation
 * away from everybody else — a free player still picks from most of the range,
 * they just cannot wear the halo.
 *
 * Indices, not names, because that is what a trait code stores. Kept small on
 * purpose: a long exclusive list makes the free look feel like a demo.
 */
/** What a resident looks like before anything is chosen for them. */
export const DEFAULT_TRAIT_CODE = "000010";

export const HOLDER_ONLY: Partial<Record<TraitSlot, readonly number[]>> = {
  // "Ink" and "Bone" — the two flattest, most deliberate jackets.
  jacket: [8, 9],
  // "Clear" — no tint at all, which reads as expensive precisely because
  // every free option is coloured.
  visor: [4],
  // "Halo" and "Antenna".
  accessory: [3, 4],
};

/** Is this option available to somebody at this tier? */
export function traitAllowed(slot: TraitSlot, index: number, isHolder: boolean): boolean {
  const options = TRAIT_NAMES[slot];
  if (!Number.isInteger(index) || index < 0 || index >= options.length) return false;
  if (isHolder) return true;
  return !(HOLDER_ONLY[slot] ?? []).includes(index);
}

/**
 * Coerce a submitted trait code into one this player is allowed to wear.
 *
 * Never rejects outright. A code that is malformed or reaches for a holder-only
 * option falls back per slot rather than failing the whole change, because the
 * alternative is a player poking at a customiser and being told "no" with no
 * indication of which of six choices was the problem.
 *
 * Server-side and non-negotiable: the client decides what to show, this decides
 * what is true. A modified client asking for the halo gets the default.
 */
export function sanitiseTraits(raw: unknown, isHolder: boolean, fallback = DEFAULT_TRAIT_CODE): string {
  const code = typeof raw === "string" ? raw.toLowerCase() : "";
  return TRAIT_SLOTS.map((slot, i) => {
    const wanted = BASE36.indexOf(code[i] ?? "");
    if (traitAllowed(slot, wanted, isHolder)) return BASE36[wanted];
    // Fall back to whatever they had, and only then to the default.
    const previous = BASE36.indexOf(fallback[i] ?? "");
    return traitAllowed(slot, previous, isHolder) ? BASE36[previous] : "0";
  }).join("");
}

const BASE36 = "0123456789abcdefghijklmnopqrstuvwxyz";

/** One attribute as OpenSea writes it. */
export interface MetadataAttribute {
  trait_type?: string;
  value?: string | number;
}

/**
 * Turn a token's metadata attributes into the six-character wire code.
 *
 * Unknown trait types and unknown values fall back to index 0 rather than
 * failing. A token whose metadata we cannot fully read should render as a plain
 * resident, not block the player from joining — the metadata host is the one
 * part of this pipeline we do not control.
 */
export function encodeAttributes(attributes: MetadataAttribute[] | undefined): string {
  const byType = new Map<string, string>();
  for (const attr of attributes ?? []) {
    if (!attr?.trait_type) continue;
    byType.set(String(attr.trait_type).toLowerCase(), String(attr.value ?? ""));
  }

  return TRAIT_SLOTS.map((slot) => {
    const names = TRAIT_NAMES[slot];
    const raw = byType.get(slot) ?? "";
    const index = names.findIndex((n) => n.toLowerCase() === raw.toLowerCase());
    return BASE36[index >= 0 ? index : 0];
  }).join("");
}

/** The code a player with no NFT carries. */
