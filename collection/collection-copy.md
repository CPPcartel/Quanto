# Quanto Residents — collection copy

Paste-ready text for the marketplace listing. No em dashes, consistent with
everything else being published.

---

## Description (recommended)

```
Quanto is a live isometric city on Robinhood Chain where every building's
height is a real stock price. 38 Chainlink feeds, four districts, and a skyline
that moves when the market does.

These are its 3,338 residents. Hold one and it becomes your character: the
jacket, hair, visor and accessory on your token are the ones you walk around
in, and holder-only options unlock that nobody else can wear.

There are 38 towers in the city and exactly 38 penthouses, one per tower.
Holding the NVDA penthouse is not a rarity tier, it is the top floor of that
specific building, and there is only ever one. 300 Landlords charter a crew to
50 members instead of 20. The remaining 3,000 are Residents.

Holders also pass the rope at The Vault, a holders-only venue in Crypto Alley
whose dance floor runs off live market data and which pays absolutely nothing.

No tier pays $BLOCK. Holding makes you visible and powerful inside the city; it
is not an income product, and the game is free to play without one.
```

**Why it is shaped this way.** The first paragraph explains the world, because
a Resident means nothing to somebody who does not know what it is a resident
of. The second explains what holding does, which is the only question a buyer
actually has. The penthouse paragraph is the strongest fact in the collection
and gets its own space. The last line is the honest one and stays in.

---

## Short version, where space is tight

```
3,338 residents of Quanto, a live city on Robinhood Chain where every
building's height is a real stock price. Your token is your character in-game.
38 towers, 38 penthouses, one each. No tier pays out.
```

---

## Before importing

**The `external_url` column points at `https://quanto-iota.vercel.app`.**

Regenerate with the real domain before minting if you are buying one:

```
node src/make-csv.mjs https://quanto.gg
```

This is worth doing first. The URL is written into metadata that outlives any
redeploy, and a listing linking to a dead host is the kind of thing nobody
notices until somebody is deciding whether to buy.

**Images are referenced by filename** (`1.png`, `66.png`), matching the files in
`out/images/`. If the importer wants full URLs instead, they need a host and the
column has to be rewritten to match. Upload the images first and check which
form it expects before importing 3,338 rows.

**Column names may need renaming.** Different importers expect different
headers for the same data. The shape here is the common one: identity columns
first, then one column per trait. If yours wants `attributes[Jacket]` or similar,
rename the header row rather than regenerating.
