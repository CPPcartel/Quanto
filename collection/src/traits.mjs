/**
 * Trait resolution for the generator.
 *
 * The NAMES come from the server's compiled schema — imported, never retyped —
 * so a token's metadata cannot describe a trait the game does not recognise.
 * The COLOURS live here because the server deliberately has no opinion about
 * appearance; they mirror client/src/pixi/traits.ts.
 */
import { TRAIT_SLOTS, TRAIT_NAMES } from "../../server/dist/config/traits.js";

export { TRAIT_SLOTS, TRAIT_NAMES };

export const TRAIT_HEX = {
  jacket: ["#4F4DC4","#2E7A52","#A6402F","#A8641F","#5B54C9","#DB7264","#5B8DEF","#E5A85C","#26293D","#C9C4BA"],
  collar: ["#22E8FF","#FF2D95","#3BFF8F","#FFB347","#A855F7","#FF4D5E"],
  hair:   ["#1A1B24","#4A3524","#C9A227","#8A8F9E","#1F6F6B","#C2508A"],
  visor:  ["#22E8FF","#FFB347","#3BFF8F","#FF2D95","#D6E4F0"],
  skin:   ["#E8C4A8","#D9A283","#B07A52","#7A4E33","#4E3122"],
  accessory: ["#000000","#3E4A6B","#4E5A7A","#22E8FF","#FFD166"],
};

/** Turn a set of slot indices into resolved colours plus the six-digit code. */
export function resolve(indices) {
  const BASE36 = "0123456789abcdefghijklmnopqrstuvwxyz";
  const code = TRAIT_SLOTS.map((s) => BASE36[indices[s]]).join("");
  return {
    jacket: TRAIT_HEX.jacket[indices.jacket],
    collar: TRAIT_HEX.collar[indices.collar],
    hair: TRAIT_HEX.hair[indices.hair],
    visor: TRAIT_HEX.visor[indices.visor],
    skin: TRAIT_HEX.skin[indices.skin],
    accessory: indices.accessory,
    accessoryHex: TRAIT_HEX.accessory[indices.accessory],
    code,
    // Raw indices, so the art can vary SHAPE by trait value and not only
    // colour. A hair value names a cut as well as a colour, which is what stops
    // 45,000 combinations sharing one silhouette.
    ix: { ...indices },
    names: Object.fromEntries(TRAIT_SLOTS.map((s) => [s, TRAIT_NAMES[s][indices[s]]])),
  };
}
