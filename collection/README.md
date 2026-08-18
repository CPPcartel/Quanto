# Candlestick Residents

The pixel NFT collection for Candlestick City. 3,338 tokens across three tiers.

```
npm run preview   # 50 tokens into preview/out — for eyeballing
npm run build     # the full 3,338 into out/
npm run verify    # check the output before minting anything
```

## What it produces

```
out/images/1.png … 3338.png      1024x1024, ~12 KB each, 37.5 MB total
out/metadata/1.json … 3338.json  OpenSea-compatible attributes
out/rarity.json                  trait distribution + the seed
out/contact-sheet.png            the first 100 tokens, as a set
```

## Reproducible

Everything derives from one seed (`SEED` in `src/generate.mjs`). Two runs produce
byte-identical output — verified by hashing all 6,676 files before and after a
regenerate. That means the art can be fixed and rebuilt without reshuffling which
token is which, right up until the moment it is minted.

**Do not change the seed after minting.** It would produce a completely different
collection while the on-chain token ids stayed the same.

## No native dependencies

`src/png.mjs` is a small PNG encoder built on Node's own `zlib`. node-canvas and
sharp both need native binaries that are awkward on Windows, and neither is
needed: this art is nothing but filled rectangles.

## The schema is the contract

Trait names come from `server/src/config/traits.ts` — imported, never retyped —
so metadata cannot describe a trait the game does not recognise. The colours are
duplicated here because the generator runs outside the client bundle, and
`client/scripts/test-traits.mjs` asserts all three copies agree.

That test matters more than it looks. A value the server cannot read silently
becomes slot 0: write `"Chartreuse"` where the schema says `"Black"` and the game
renders black hair forever, on a collection that cannot be edited.

## Art

`src/art.mjs` draws a 32x32 bust, scaled 32x on encode. This is *not* the 20x34
walk sprite the game renders — same character, same traits, different job. The
walk sprite has to read at street zoom among a hundred others; this has to read
as a 200px thumbnail in a marketplace grid.

Hair value drives the **cut** as well as the colour, which is what stops 45,000
combinations sharing one silhouette. Everything visible in a portrait is
described by something in its metadata.

## Before minting

Run `npm run verify`. It reads the files on disk — not the generator's
intentions — and checks completeness, the supply plan, one-to-one tower
assignment, uniqueness, PNG validity, and that every attribute survives a round
trip through the server's own reader.
