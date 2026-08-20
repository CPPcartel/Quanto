# Quanto — promo

Three cuts, all generated. No stock footage, no licensed music, no external
assets of any kind.

| File | Size | Length | Use |
|---|---|---|---|
| `out/quanto-landscape.mp4` | 1920×1080 | 44.1s | The long cut. **Real captured game footage** in eight scenes, every mechanic, the collection wall, The Vault as the drop. |
| `out/collection-image.gif` | 1000×1000 | 3s loop | Collection image for the OpenSea drop. |
| `out/quanto.mp4` | 1080×1920 | 18.9s | Vertical, for a feed. |
| `out/quanto-square.mp4` | 1080×1080 | 18.9s | Square fallback. |

## What is real in it

- **Prices.** All 38 came off the live Chainlink feeds on Robinhood Chain
  (chain 4663). Regenerate with `node scripts/pull-prices.mjs`.
- **The skyline.** Tower heights use the game's own `baseHeightFor()` log curve,
  and the layout is `layoutFor()` from `server/src/config/tickers.ts` — same four
  districts, same 26-unit plot spacing, same 2×2 footprints.
- **The filler blocks.** Same 13-unit grid, same FNV-1a seed per `"x,z"`, same
  0.32 cutoff as `buildFiller()` in `client/src/pixi/City.ts`. 411 blocks, in the
  same places the game puts them.
- **The Vault.** The server's real lot (`half: 12`), the renderer's 12×12 dance
  floor, four sweeping beams.
- **The numbers on the cards.** `VOL_TIERS`, `SHIFT_ROUNDS`, `COST_SHIFT`,
  the club event triggers and durations — all read out of the server source.
- **The NFTs.** The tiles are the collection's own PNGs from
  `collection/out/images` — the same bytes that go to OpenSea. `src/collection.json`
  is written alongside the copy so an id and its art can never drift apart.
  Traits shown next to a hero token come from that token's metadata.
- **The music.** A port of the game's own club synth (`client/src/pixi/audio.ts`)
  to an offline WAV renderer. Same voices, same pattern, same minor scale.

## Real footage

Eight scenes sit on plates captured from the running client — a real browser
driving the real game against the real server. See `CAPTURE.md`. Re-shoot with
`bash scripts/capture-all.sh`, then `npm run render:landscape`.

The Vault interior, the storm shards, the mechanic cards and the collection art
stay generated: they are overlays the game cannot stage on demand, or the token
art itself.

## Commands

```bash
npm run audio            # vertical soundtrack
node scripts/gen-audio.mjs landscape
npm run render           # vertical
npm run render:landscape # landscape
npm run studio           # scrub it
```

Timing lives in `src/timing.json` and drives both the composition and the audio,
so a scene length can never disagree with the soundtrack.
