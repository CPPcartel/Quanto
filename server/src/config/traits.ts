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
export const DEFAULT_TRAIT_CODE = "000010";
