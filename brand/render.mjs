/**
 * Render a brand HTML page to PNG at an exact pixel size.
 *
 * Uses the Chromium that promo/ already downloaded for game capture, so this
 * adds no dependency. Waits on document.fonts rather than a timeout — Google
 * Fonts arrive over the network, and screenshotting before they land silently
 * ships a page set in the fallback face, which is the kind of mistake nobody
 * notices until it is printed on a header.
 *
 *   node brand/render.mjs cover.html x-cover-1500x500.png 1500 500
 */
import { chromium } from "../promo/node_modules/playwright-core/index.mjs";
import { existsSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

const [page, outName, wArg, hArg] = process.argv.slice(2);
if (!page || !outName) {
  console.error("usage: node brand/render.mjs <page.html> <out.png> [width] [height]");
  process.exit(1);
}
const width = Number(wArg ?? 1500);
const height = Number(hArg ?? 500);

/** Same discovery the capture script uses. */
function findChrome() {
  const local = process.env.LOCALAPPDATA;
  if (local) {
    const base = join(local, "ms-playwright");
    if (existsSync(base)) {
      for (const dir of readdirSync(base)) {
        if (!dir.startsWith("chromium")) continue;
        const exe = join(base, dir, "chrome-win64", "chrome.exe");
        if (existsSync(exe)) return exe;
      }
    }
  }
  return undefined;
}

const executablePath = findChrome();
const browser = await chromium.launch({ executablePath, args: ["--force-color-profile=srgb"] });

/** deviceScaleFactor 1: the page is authored at final pixel size already. */
const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
const p = await ctx.newPage();

const url = pathToFileURL(resolve(HERE, page)).href;
await p.goto(url, { waitUntil: "networkidle" });

// Webfonts, not a guess at how long they take.
await p.evaluate(() => document.fonts.ready);
await p.waitForTimeout(350);

const out = join(HERE, "out", outName);
/**
 * Transparent when asked.
 *
 * A logo dropped into somebody else 's interface cannot bring its own
 * background with it, because that interface may be any colour. Passing
 * --transparent omits the page ground so the PNG carries alpha.
 */
const transparent = process.argv.includes("--transparent");
await p.screenshot({ path: out, type: "png", omitBackground: transparent });
await browser.close();

console.log(`${outName}  ${width}x${height}`);
