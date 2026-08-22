/**
 * Render the animated collection banner as a looping GIF.
 *
 * Frames come from a real browser rather than the pixel encoder, because the
 * banner is built from CSS layers: tiled backgrounds, a radial warm pool, and
 * edge fades. Reimplementing those against a raw pixel grid to avoid opening a
 * browser would be more code and less faithful.
 *
 * GIF is the format the marketplace accepts for an animated cover. It is also a
 * format with 256 colours, so the encode goes through palettegen rather than
 * ffmpeg's default: the default builds its palette from the first frame alone,
 * and a crowd whose colours change as it scrolls comes out banded and dirty.
 *
 *   node brand/make-banner.mjs
 */
import { chromium } from "../promo/node_modules/playwright-core/index.mjs";
import { existsSync, readdirSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "out");
const FRAMES = join(OUT, "banner-frames");

const WIDTH = 1400;
const HEIGHT = 400;

/**
 * 36 frames at 16fps, so the loop runs a little over two seconds.
 *
 * Both numbers are a compromise with the format, and the compromise is harsher
 * here than usual: every pixel scrolls, so no frame shares a region with the
 * one before it and GIF cannot skip anything. Frame count therefore multiplies
 * file size almost exactly. 48 frames came out at 7.7MB and 36 at 5.3MB with no
 * visible difference, which is the trade taken. A banner nobody waits for is
 * not a banner.
 */
const FRAME_COUNT = 36;
const FPS = 16;

const FFMPEG = join(
  HERE,
  "..",
  "promo",
  "node_modules",
  "@remotion",
  "compositor-win32-x64-msvc",
  "ffmpeg.exe"
);

function findChrome() {
  const base = join(process.env.LOCALAPPDATA ?? "", "ms-playwright");
  if (!existsSync(base)) return undefined;
  for (const d of readdirSync(base)) {
    if (!d.startsWith("chromium")) continue;
    const exe = join(base, d, "chrome-win64", "chrome.exe");
    if (existsSync(exe)) return exe;
  }
  return undefined;
}

rmSync(FRAMES, { recursive: true, force: true });
mkdirSync(FRAMES, { recursive: true });

const browser = await chromium.launch({
  executablePath: findChrome(),
  args: ["--force-color-profile=srgb"],
});
const page = await browser.newPage({
  viewport: { width: WIDTH, height: HEIGHT },
  deviceScaleFactor: 1,
});

await page.goto(pathToFileURL(join(HERE, "banner.html")).href, { waitUntil: "networkidle" });

for (let i = 0; i < FRAME_COUNT; i++) {
  await page.evaluate(([f, total]) => window.setFrame(f, total), [i, FRAME_COUNT]);
  await page.screenshot({
    path: join(FRAMES, `f${String(i).padStart(3, "0")}.png`),
    type: "png",
  });
}
await browser.close();
console.log(`  ${FRAME_COUNT} frames at ${WIDTH}x${HEIGHT}`);

/**
 * Two passes: build a palette from every frame, then apply it.
 *
 * stats_mode=diff weights the palette toward what actually changes between
 * frames rather than the static background, which is most of this image.
 * Bayer dithering is chosen over the default error diffusion because error
 * diffusion crawls: the noise pattern shifts frame to frame and a flat dark
 * background appears to boil.
 */
const palette = join(FRAMES, "palette.png");
execFileSync(FFMPEG, [
  "-y", "-loglevel", "error",
  "-framerate", String(FPS),
  "-i", join(FRAMES, "f%03d.png"),
  "-vf", "palettegen=stats_mode=diff:max_colors=160",
  palette,
]);

const gif = join(OUT, "collection-banner.gif");
execFileSync(FFMPEG, [
  "-y", "-loglevel", "error",
  "-framerate", String(FPS),
  "-i", join(FRAMES, "f%03d.png"),
  "-i", palette,
  "-lavfi", "paletteuse=dither=bayer:bayer_scale=3:diff_mode=rectangle",
  "-loop", "0",
  gif,
]);

const { statSync } = await import("node:fs");
console.log(`  collection-banner.gif  ${(statSync(gif).size / 1024 / 1024).toFixed(2)} MB`);

// A still, for anywhere that will not take an animation.
const stillIn = join(FRAMES, "f000.png");
execFileSync(FFMPEG, ["-y", "-loglevel", "error", "-i", stillIn, join(OUT, "collection-banner.png")]);
console.log("  collection-banner.png  first frame, as a still");

rmSync(FRAMES, { recursive: true, force: true });
