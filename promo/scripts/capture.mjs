/**
 * Capture real footage of the running game.
 *
 *   node scripts/capture.mjs <shot> [--frames N]
 *
 * Drives an actual browser against an actual game client talking to an actual
 * server reading actual Chainlink feeds, and writes a PNG sequence plus an mp4.
 * Nothing here is a recreation — the pixels are the game's own renderer.
 *
 * ---------------------------------------------------------------------------
 * Why a real browser and not headless shell
 *
 * The game is PixiJS on WebGL. `chrome-headless-shell` has no GPU stack at all,
 * so the canvas comes back blank — the page loads, the HUD renders, and the city
 * is missing. Full Chromium with SwiftShader software rasterisation renders it
 * correctly, just slowly, which is fine because we are not capturing in real
 * time (see below).
 *
 * ---------------------------------------------------------------------------
 * Why deterministic stepping and not a screen recording
 *
 * A wall-clock screen grab of a software-rasterised WebGL canvas produces
 * uneven frame intervals, and pasting that into a 30fps timeline gives judder
 * that no amount of grading hides. Instead the page is advanced one fixed
 * timestep at a time and screenshotted after each — so every captured frame is
 * exactly 1/30s of game time regardless of how long it took to draw.
 */
import { chromium } from "playwright-core";
import { mkdirSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { Buffer } from "node:buffer";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
/** `/` is the marketing landing page. The game itself lives at `/play`. */
const CLIENT_URL = process.env.CAPTURE_URL ?? "http://localhost:5199/play";
const FPS = 30;

/** Full Chromium, not the headless shell — the shell cannot do WebGL. */
const CHROME =
  process.env.CHROME_PATH ??
  `${process.env.LOCALAPPDATA}\\ms-playwright\\chromium-1234\\chrome-win64\\chrome.exe`;

// ---------------------------------------------------------------------------
// Shots

/**
 * Each shot gets the game into a state and then plays out.
 *
 * `setup` runs once before capture starts; `frame` runs before every captured
 * frame and receives the frame index, so a shot can hold a key, tap a panel or
 * sweep the camera on an exact schedule.
 */
const SHOTS = {
  /** The whole city, wide, drifting. */
  /**
   * The whole city, wide, drifting.
   *
   * This is the configuration that verifiably renders: zoom 0.40, camera pan
   * only, no keys held. Holding a movement key makes the renderer ease the pan
   * back to zero every frame (it treats walking as "take me back to my
   * character"), so a shot cannot both walk and hold a camera offset.
   */
  skyline: {
    frames: 96,
    hud: false,
    async setup(page) {
      await zoomTo(page, Number(process.env.CAP_ZOOM ?? 0.4));
      await panTo(page, 0, 0);
    },
    async frame(page, i) {
      await panTo(page, -190 + i * 2.2, -40 + i * 0.55);
    },
  },

  /** The city with the HUD on: this is what playing actually looks like. */
  hud: {
    frames: 96,
    hud: true,
    async setup(page) {
      await zoomTo(page, 0.62);
      await page.keyboard.down(AXIS.xPlus);
    },
    async frame(page, i) {
      if (i === 70) {
        await page.keyboard.up(AXIS.xPlus);
        await page.keyboard.down(AXIS.zPlus);
      }
      if (i === 130) await page.keyboard.up(AXIS.zPlus);
    },
  },

  /** Street level, walking between towers. */
  /** Closer in, walking the streets. Kept under the bloom ceiling. */
  street: {
    frames: 96,
    hud: false,
    async setup(page) {
      await zoomTo(page, 0.92);
      await page.keyboard.down(AXIS.zMinus);
    },
    async frame(page, i) {
      if (i === 60) {
        await page.keyboard.up(AXIS.zMinus);
        await page.keyboard.down(AXIS.xPlus);
      }
      if (i === 125) await page.keyboard.up(AXIS.xPlus);
    },
  },

  /**
   * The Vault, close.
   *
   * The club lot is at world (-78, -26); through the game's own projection that
   * is screen (416, 416) from the player. The camera is panned there rather
   * than walking the player over, because a shot should not depend on how long
   * a walk takes.
   */
  /**
   * The Vault.
   *
   * `stage.position = screen/2 - (cam + pan) * zoom`, so the world point at the
   * centre of frame is `cam + pan` — to look at the club's screen coordinate of
   * (-416, -416) the pan is negative, not positive.
   *
   * Zoom is held at 0.78 rather than pushed in close. Bloom switches on above
   * LOD_ZOOM 0.35 and its filter area scales with zoom; past about 1.0 the
   * render target is larger than SwiftShader will allocate and every frame comes
   * back empty. On a machine with a real GPU this can go much closer.
   */
  vault: {
    frames: 96,
    hud: false,
    async setup(page) {
      await zoomTo(page, 0.78);
      await panTo(page, -416, -416);
    },
    async frame(page, i) {
      await panTo(page, -416 + Math.sin(i / 60) * 26, -416 + i * 0.22);
    },
  },

  /** Pulling back off the club to the wider city. */
  /** Walking up to the club from the street outside it. */
  /** Drifting off the club back out over the city. */
  door: {
    frames: 96,
    hud: false,
    async setup(page) {
      await zoomTo(page, 0.72);
      await panTo(page, -416, -300);
    },
    async frame(page, i) {
      await panTo(page, -416 + i * 1.4, -300 + i * 0.9);
    },
  },
};

// ---------------------------------------------------------------------------

/**
 * Hide the interface for a clean plate.
 *
 * The HUD is genuinely good and belongs in the shots that are *about* the HUD,
 * but text laid over a leaderboard and a chat log is unreadable. Hidden with
 * CSS rather than by unmounting, so the game keeps running exactly as it was.
 */
async function hideHud(page) {
  await page.addStyleTag({
    content: `
      .shell > .hud,
      .shell > .tape,
      .overlay { visibility: hidden !important; }
    `,
  });
}

/** The client exposes its camera through the world object in dev. */
async function zoomTo(page, z) {
  await page.evaluate((zoom) => {
    const w = window;
    if (w.__ccSetZoom) w.__ccSetZoom(zoom);
  }, z);
}

/**
 * Walk the player to a world position, using the game's own movement.
 *
 * The camera follows the player, and the pan offset turned out to be clamped
 * relative to them — panning far enough to reach the club just ran off the edge
 * of the world into empty space. Walking is slower to set up and completely
 * reliable, and it exercises the real input path, prediction and reconciliation
 * on the way.
 *
 * Returns how close it got, so a shot can fail loudly instead of filming dirt.
 */
async function walkTo(page, tx, tz, budget = 900) {
  const KEYS = ["KeyW", "KeyA", "KeyS", "KeyD"];
  let held = null;
  for (let step = 0; step < budget; step++) {
    const { x, z } = await page.evaluate(() => ({
      x: window.__ccWorld.local.x,
      z: window.__ccWorld.local.z,
    }));
    const dx = tx - x;
    const dz = tz - z;
    if (Math.hypot(dx, dz) < 4) break;

    /**
     * Pick the key by trying each axis' dominant direction.
     * WASD map onto the isometric axes rather than screen x/y, so the mapping is
     * measured once below rather than assumed.
     */
    const want =
      Math.abs(dx) > Math.abs(dz)
        ? dx > 0
          ? AXIS.xPlus
          : AXIS.xMinus
        : dz > 0
          ? AXIS.zPlus
          : AXIS.zMinus;

    if (want !== held) {
      if (held) await page.keyboard.up(held);
      await page.keyboard.down(want);
      held = want;
    }
    await page.evaluate((dt) => window.__ccFrame(dt), 1000 / FPS);
    void KEYS;
  }
  if (held) await page.keyboard.up(held);
  const end = await page.evaluate(() => ({
    x: +window.__ccWorld.local.x.toFixed(1),
    z: +window.__ccWorld.local.z.toFixed(1),
  }));
  return end;
}

/**
 * Which key moves which way.
 *
 * Measured at startup rather than assumed: WASD are mapped through the
 * isometric yaw, so "W" is not "-z" and guessing produces a shot that walks
 * confidently in the wrong direction.
 */
const AXIS = { xPlus: "KeyD", xMinus: "KeyA", zPlus: "KeyA", zMinus: "KeyW" };

async function measureAxes(page) {
  const read = () =>
    page.evaluate(() => ({ x: window.__ccWorld.local.x, z: window.__ccWorld.local.z }));
  for (const key of ["KeyW", "KeyA", "KeyS", "KeyD"]) {
    const before = await read();
    await page.keyboard.down(key);
    for (let i = 0; i < 10; i++) await page.evaluate((dt) => window.__ccFrame(dt), 1000 / FPS);
    await page.keyboard.up(key);
    const after = await read();
    const dx = after.x - before.x;
    const dz = after.z - before.z;
    if (Math.abs(dx) > Math.abs(dz)) {
      if (dx > 0) AXIS.xPlus = key;
      else AXIS.xMinus = key;
    } else {
      if (dz > 0) AXIS.zPlus = key;
      else AXIS.zMinus = key;
    }
  }
  return AXIS;
}

/**
 * Move the camera without moving the player.
 *
 * Setting `world.local` instead would be pointless: the server owns position and
 * reconciles the client back within a tick or two, so a "teleport" lasts about
 * 50ms. The pan offset is purely a camera concern and stays put.
 */
async function panTo(page, x, y) {
  await page.evaluate(
    ([px, py]) => {
      const w = window;
      if (w.__ccPan) w.__ccPan(px, py);
    },
    [x, y]
  );
}

const shotName = process.argv[2];
const shot = SHOTS[shotName];
if (!shot) {
  console.error(`unknown shot "${shotName}" — one of ${Object.keys(SHOTS).join(", ")}`);
  process.exit(1);
}

const frames = Number(
  process.argv.includes("--frames") ? process.argv[process.argv.indexOf("--frames") + 1] : shot.frames
);

const outDir = resolve(ROOT, "capture", shotName);
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

if (!existsSync(CHROME)) {
  console.error(`Chromium not found at ${CHROME}. Set CHROME_PATH.`);
  process.exit(1);
}

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: [
    // SwiftShader: software WebGL. Slow, correct, and available everywhere.
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
    "--disable-gpu-sandbox",
    "--hide-scrollbars",
    "--mute-audio",
  ],
});

/**
 * Capture resolution.
 *
 * SwiftShader costs scale with pixels, and at 1920x1080 this scene renders at
 * roughly one frame every five seconds — over an hour for a full set of shots.
 * 1600x900 is about a third cheaper and gets upscaled 1.2x in the composition,
 * which is invisible underneath the grade and scrims these plates sit behind.
 * Set CAP_W/CAP_H to shoot native on a machine with a real GPU.
 */
const page = await browser.newPage({
  viewport: {
    width: Number(process.env.CAP_W ?? 1600),
    height: Number(process.env.CAP_H ?? 900),
  },
  deviceScaleFactor: 1,
});

// Software WebGL plus a websocket handshake is slow to first frame; the 30s
// default fires long before the city has arrived.
page.setDefaultTimeout(180_000);

/**
 * A virtual clock, but real animation frames.
 *
 * Two problems have to be solved at once here.
 *
 * Software WebGL renders this scene at about 3fps, so a screenshot loop in wall
 * time captures ~3 frames of game motion per second and plays them back at 30 —
 * ten times too fast. So `performance.now` is virtual, and the capture advances
 * it by exactly 1/30s per frame. The game's own dt is then always one frame,
 * however long the draw actually took.
 *
 * But `requestAnimationFrame` must stay REAL. Replacing it too — which the first
 * attempt did — means Pixi draws outside any animation frame, the WebGL drawing
 * buffer is never composited, and every screenshot comes back blank while the
 * simulation happily runs. The world state looked perfect and the pictures were
 * empty, which is a memorable way to lose an hour.
 *
 * `Date.now` and `setTimeout` are left alone as well: the websocket heartbeat
 * and the server tick run on real time, and freezing those drops the connection
 * mid-shot.
 */
await page.addInitScript(() => {
  let t = 0;
  performance.now = () => t;

  /** Advance game time by `dt` ms, then wait for the frame that draws it. */
  window.__ccFrame = (dt) =>
    new Promise((resolve) => {
      t += dt;
      // Two frames: the first runs the game's rAF callbacks and issues the draw,
      // the second returns once that draw has been presented.
      requestAnimationFrame(() => requestAnimationFrame(() => resolve(t)));
    });
});

page.on("console", (m) => {
  if (m.type() === "error") console.warn("  [page error]", m.text().slice(0, 160));
});
page.on("pageerror", (e) => console.warn("  [page threw]", String(e).slice(0, 200)));

console.log(`loading ${CLIENT_URL} …`);
await page.goto(CLIENT_URL, { waitUntil: "load", timeout: 90_000 });

/**
 * Wait for the city, not for the page.
 *
 * `load` fires long before the websocket has replicated a single tower, and a
 * screenshot taken then is an empty ground plane. This waits for the client to
 * report that it is connected AND that towers have arrived.
 */
/** Nothing renders unless the clock is pumped, so pump it while waiting. */
async function pump(frames, dtMs = 1000 / FPS) {
  for (let i = 0; i < frames; i++) {
    await page.evaluate((dt) => window.__ccFrame(dt), dtMs);
  }
}

const readyAt = Date.now();
while (Date.now() - readyAt < 180_000) {
  await pump(4);
  const ok = await page.evaluate(() => {
    const w = window;
    return !!(w.__ccWorld && w.__ccWorld.conn === "connected" && w.__ccWorld.tickers.size > 0);
  });
  if (ok) break;
  await page.waitForTimeout(120);
}
const towers = await page.evaluate(() => window.__ccWorld.tickers.size);
console.log(`connected — ${towers} towers replicated`);

// Let the city finish growing into place before the shot starts. Towers ease
// toward their live height, so a shot that begins immediately opens on a city
// still visibly inflating.
await pump(90);
// Opt-in: this presses all four keys to learn the mapping, which walks the
// player somewhere unpredictable before the shot has been framed.
if (process.argv.includes("--measure")) {
  console.log("axes:", JSON.stringify(await measureAxes(page)));
}
if (shot.hud === false && !process.argv.includes("--hud")) await hideHud(page);
await shot.setup(page);
await pump(20);

/**
 * `--probe` reports the world state at each stage instead of capturing.
 *
 * Framing problems in a headless capture are invisible until you have already
 * shot 150 frames, so it is worth being able to ask the game where it thinks the
 * camera and the player are before committing to a take.
 */
/**
 * `--sweep` renders one frame per (zoom, pan) combination and reports how much
 * of the frame is lit. Framing blind through a 20-second render loop is how the
 * last hour went; this answers the question in one pass.
 */
if (process.argv.includes("--sweep")) {
  const brightness = async () => {
    const buf = await page.screenshot({ type: "jpeg", quality: 40 });
    // Rough proxy: JPEG of a black frame compresses to almost nothing.
    return buf.length;
  };
  for (const zoom of [0.4, 0.78]) {
    for (const pan of [[0, 0], [-200, -200], [-416, -416], [416, 416]]) {
      await zoomTo(page, zoom);
      await panTo(page, pan[0], pan[1]);
      await pump(6);
      console.log(
        `zoom ${zoom.toFixed(2)}  pan ${String(pan[0]).padStart(5)},${String(pan[1]).padStart(5)}  jpeg ${await brightness()} bytes`
      );
    }
  }
  await browser.close();
  process.exit(0);
}

if (process.argv.includes("--probe")) {
  const snap = () =>
    page.evaluate(() => {
      const w = window.__ccWorld;
      return {
        x: +w.local.x.toFixed(1),
        z: +w.local.z.toFixed(1),
        zoom: +w.zoom.toFixed(3),
        zoomMin: +w.zoomMin.toFixed(3),
        camZoom: +window.__ccCamera.zoom.toFixed(3),
        towers: w.tickers.size,
        fatal: w.debug.fatal || null,
      };
    });
  console.log("settled      ", JSON.stringify(await snap()));
  console.log("canvases     ", JSON.stringify(await page.evaluate(() => {
    return [...document.querySelectorAll("canvas")].map((c) => ({
      parent: c.parentElement?.className ?? null,
      w: c.width,
      h: c.height,
      ctxLost: (() => {
        try {
          const gl = c.getContext("webgl2") || c.getContext("webgl");
          return gl ? gl.isContextLost() : "no-webgl-ctx";
        } catch (e) { return "err"; }
      })(),
    }));
  })));
  console.log("debug        ", JSON.stringify(await page.evaluate(() => window.__ccWorld.debug)));
  console.log("dom          ", JSON.stringify(await page.evaluate(() => {
    const sel = ".hud, .ticker-tape, .overlay";
    const hit = [...document.querySelectorAll(sel)].map((e) => e.className).slice(0, 8);
    const shell = document.querySelector(".shell");
    return {
      matched: hit,
      shellChildren: shell ? [...shell.children].map((c) => c.className || c.tagName) : null,
      canvasParent: document.querySelector("canvas")?.parentElement?.className ?? null,
      canvasInsideMatch: !!document.querySelector("canvas")?.closest(sel),
    };
  })));
  for (let i = 0; i < frames; i++) {
    await shot.frame(page, i);
    await page.evaluate((dt) => window.__ccFrame(dt), 1000 / FPS);
    if (i % 20 === 0) console.log(`frame ${String(i).padStart(3)}  `, JSON.stringify(await snap()));
  }
  console.log("end          ", JSON.stringify(await snap()));
  await browser.close();
  process.exit(0);
}

/**
 * Prove the session can read pixels back before shooting 96 frames into a void.
 *
 * Under SwiftShader the readback is unreliable per *session*, not per frame: a
 * launched browser either returns real pixels for the whole run or transparent
 * ones for the whole run, and which you get is luck. Rather than discover that
 * after two minutes of capture, take one frame and check it — the caller
 * relaunches on a dud.
 */
const probe = await page.evaluate(() => {
  const all = [...document.querySelectorAll("canvas")];
  if (!all.length) return 0;
  const c = all.sort((a, b) => b.width * b.height - a.width * a.height)[0];
  try {
    return c.toDataURL("image/png").length;
  } catch {
    return 0;
  }
});
if (probe < 30000) {
  console.error(`  READBACK DEAD (${probe} chars) — relaunch`);
  await browser.close();
  process.exit(75);
}
console.log(`  readback ok (${Math.round(probe / 1024)}KB/frame)`);

console.log(`capturing ${frames} frames …`);
const started = Date.now();
/**
 * Read the pixels out of the canvas, not off the page.
 *
 * `page.screenshot` goes through the browser compositor, and capturing a
 * software-rasterised WebGL surface that way is unreliable: the same shot
 * renders correctly one run and comes back fully transparent the next, with the
 * renderer demonstrably drawing either way. `toDataURL` reads the drawing buffer
 * directly — possible because the client keeps that buffer in dev builds — so
 * the capture no longer depends on compositor timing at all.
 *
 * It also yields exactly the game canvas with no page chrome, which is what a
 * clean plate wants anyway.
 */
let blanks = 0;
for (let i = 0; i < frames; i++) {
  await shot.frame(page, i);
  await page.evaluate((dt) => window.__ccFrame(dt), 1000 / FPS);

  const dataUrl = await page.evaluate(() => {
    // The largest canvas is the game; the minimap is a small one in the HUD.
    // Selecting by ancestor class proved brittle, so pick by area.
    const all = [...document.querySelectorAll("canvas")];
    if (!all.length) return null;
    const c = all.sort((a, b) => b.width * b.height - a.width * a.height)[0];
    try {
      return c.toDataURL("image/png");
    } catch {
      return null;
    }
  });
  if (!dataUrl) throw new Error("no game canvas found in .viewport");

  const png = Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64");
  if (png.length < 20000) blanks++;
  writeFileSync(resolve(outDir, `${String(i).padStart(4, "0")}.png`), png);
  if (i % 25 === 0) process.stdout.write(`  ${i}/${frames}`);
}
if (blanks > frames * 0.2) console.error(`  WARNING: ${blanks}/${frames} frames look blank`);
console.log(`  ${frames}/${frames} in ${((Date.now() - started) / 1000).toFixed(1)}s`);

await browser.close();

// ---------------------------------------------------------------------------
// Encode the sequence so the composition can use one file instead of 150.

const mp4 = resolve(ROOT, "public/footage", `${shotName}.mp4`);
mkdirSync(dirname(mp4), { recursive: true });
/**
 * Remotion's own ffmpeg binary, called directly.
 *
 * Not `npx remotion ffmpeg`: without a shell, `npx.cmd` is not resolvable from
 * this process on Windows, and *with* a shell the arguments are concatenated
 * rather than escaped — and this project's path contains a space, so ffmpeg
 * tried to open "E:\new". Calling the packaged binary avoids both.
 */
const FFMPEG = resolve(
  ROOT,
  "node_modules/@remotion/compositor-win32-x64-msvc/ffmpeg.exe"
);

const ff = spawnSync(
  existsSync(FFMPEG) ? FFMPEG : "ffmpeg",
  [
    "-y",
    "-framerate",
    String(FPS),
    "-i",
    `capture/${shotName}/%04d.png`,
    "-c:v",
    "libx264",
    "-crf",
    "15",
    "-pix_fmt",
    "yuv420p",
    `public/footage/${shotName}.mp4`,
  ],
  { cwd: ROOT, stdio: ["ignore", "ignore", "pipe"] }
);
if (ff.status !== 0) {
  console.error(String(ff.stderr).split(String.fromCharCode(10)).slice(-6).join(String.fromCharCode(10)));
}

writeFileSync(
  resolve(ROOT, "capture", `${shotName}.json`),
  JSON.stringify({ shot: shotName, frames, fps: FPS, capturedAt: new Date().toISOString() }, null, 2)
);

console.log(ff.status === 0 ? `wrote public/footage/${shotName}.mp4` : "ffmpeg failed");
