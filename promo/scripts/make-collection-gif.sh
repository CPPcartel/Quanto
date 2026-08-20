#!/usr/bin/env bash
# Render the collection image and encode it as a looping GIF.
#
# Two ffmpeg passes: palettegen builds a 256-colour palette from the whole
# sequence, paletteuse applies it. A single-pass GIF quantises per frame and the
# pixel art shimmers between frames as the palette shifts under it.
set -euo pipefail
cd "$(dirname "$0")/.."
FF="node_modules/@remotion/compositor-win32-x64-msvc/ffmpeg.exe"
[ -x "$FF" ] || FF=ffmpeg

rm -rf out/collection-frames
npx remotion render src/index.ts CollectionImage out/collection-frames --sequence --image-format png

"$FF" -y -framerate 24 -i "out/collection-frames/element-%02d.png" \
  -vf "palettegen=stats_mode=full" out/collection-palette.png

"$FF" -y -framerate 24 -i "out/collection-frames/element-%02d.png" -i out/collection-palette.png \
  -lavfi "paletteuse=dither=bayer:bayer_scale=3" \
  -loop 0 out/collection-image.gif

rm -rf out/collection-frames out/collection-palette.png
ls -la out/collection-image.gif
