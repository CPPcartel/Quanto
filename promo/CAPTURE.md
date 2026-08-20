# Shooting real game footage

`scripts/capture.mjs` drives the real client in a real browser against the real
server and writes a PNG sequence plus an mp4 into `public/footage/`. The video's
scenes are already wired to use those clips.

## Run it

```bash
# 1. the game server
cd ../server && PORT=2567 DATA_DIR=./data-e2e node dist/index.js

# 2. the client, in dev (the capture handles only exist in dev builds)
cd ../client && npx vite --port 5199 --strictPort

# 3. the shots
cd ../promo && bash scripts/capture-all.sh
```

Then re-render: `npm run render:landscape`.

## It needs a real GPU

This works, but not reliably on software rendering. On a machine without GPU
acceleration Chromium falls back to SwiftShader, and two things go wrong:

- **Speed.** The scene renders at 3–4 fps, so a 96-frame shot takes minutes.
- **Blank frames.** The canvas draws correctly — `world.debug` reports
  `fps: 3, built: true` and the WebGL context is alive — but reading the pixels
  back returns transparent, intermittently. Both `page.screenshot` (compositor
  path) and `canvas.toDataURL` (drawing-buffer path) hit it. It is a SwiftShader
  readback problem, not a game problem.

On a machine with a working GPU, drop the SwiftShader flags in
`scripts/capture.mjs` (`--use-angle=swiftshader`, `--enable-unsafe-swiftshader`)
and it should shoot at full speed with stable readback.

## Client changes this relies on

All three are `import.meta.env.DEV`-guarded and verified absent from production
builds:

- `src/dev/captureHandle.ts` — exposes `world` and a zoom setter
- `src/pixi/app.ts` — `__ccPan` camera offset setter
- `src/pixi/app.ts` — `preserveDrawingBuffer` on the Pixi renderer, so the
  drawing buffer survives compositing and can be read back at all

## Shots

`skyline` (wide city), `street` (closer), `vault` (the club), `door`
(approaching it), `hud` (the interface, for "this is what playing looks like").
