import { loadFont as loadArchivo } from "@remotion/google-fonts/Archivo";
import { loadFont as loadMono } from "@remotion/google-fonts/JetBrainsMono";

/**
 * Hero text never falls back to a system font.
 *
 * Archivo at 800 is a tight grotesk that holds up at 130px; JetBrains Mono
 * carries every number and ticker symbol. The pairing is deliberate — a
 * trading terminal is monospace, and the whole premise of this game is that the
 * skyline is a price feed.
 *
 * Weights are requested explicitly. Remotion subsets what it loads, and a
 * missing 800 silently renders as 400 — which looks like a design failure
 * rather than a loading one.
 */
export const archivo = loadArchivo("normal", {
  weights: ["400", "600", "700", "800"],
  subsets: ["latin"],
});

export const mono = loadMono("normal", {
  weights: ["400", "500", "700", "800"],
  subsets: ["latin"],
});

export const fontFamilies = {
  display: archivo.fontFamily,
  mono: mono.fontFamily,
};
