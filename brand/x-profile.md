# X profile copy

Everything a visitor sees before deciding whether to follow. Ordered by how
each piece works cold, on a profile somebody reached from a single retweet and
will judge in about two seconds.

---

## Bio options

X allows 160 characters and preserves line breaks. Every count below was
measured, not estimated.

### 1 — Recommended

```
Every building's height is a live stock price.
3,338 Residents · 38 feeds · Robinhood Chain
The skyline is the chart.
```

**117 characters.** Three lines doing three different jobs, which is why this
beats the same words as one sentence.

The first line is the whole concept in eight words and works with no context at
all. It leads with the mechanic rather than the category, so somebody who has
never heard of this understands it before deciding whether they care, and it
says *height* rather than *building* because a building being a price is
nonsense while a building's height being one is the actual product.

The middle line is where 3,338 sits. Numbers separated by dots read as
specification rather than as boasting, and a reader scanning a profile takes
them in without reading a sentence.

The last line is what people repeat. It belongs at the bottom, where it is the
final thing seen and the easiest thing to screenshot.

---

### 2 — One sentence

```
Every building's height is a live stock price. Lease a floor, light a window. 3,338 Residents on Robinhood Chain.
```

**113 characters.** Use this if the profile looks cramped with three lines on a
narrow screen. It gains a verb, which the recommended version lacks: "lease a
floor, light a window" tells somebody what they would actually do, and doing
beats knowing when the aim is a click.

It loses the tagline, which is a real cost.

---

### 3 — Collection first

```
3,338 Residents in a city where every building's height is a live stock price. The skyline is the chart.
```

**104 characters.** Leads with the supply, so use it while the mint is the thing
being talked about and swap back afterwards. Weaker cold: a number means nothing
to somebody who does not yet know what a Resident is.

---

## Fields

| Field | Value |
|---|---|
| **Name** | `Quanto` |
| **Handle** | `@quanto` if free, else `@quantocity`, `@playquanto`, `@quantogg` |
| **Location** | `The skyline is the chart` — X does not validate it, and it is free real estate |
| **Link** | `quanto.gg` (or the live Vercel URL until DNS is set) |
| **Profile picture** | `brand/out/block-coin-576.png`, the $BLOCK coin |
| **Header** | `brand/out/x-cover-1500x500.png`, the collection behind the name |
| **Square cover** | `brand/out/quanto-city-1500.png`, for anywhere that wants 1:1 |

**The header shows 192 Residents, not all of them, and that is the point.**

Fitting the whole collection into a 1500x500 band forces each face down to 12
pixels, where a Resident is a coloured speck. Nobody looking at that learns the
collection is made of characters, which is the only thing the picture is for.
`x-cover-1500x500.png` instead uses the portraits at their native size doubled,
so a face is 64 pixels and you can read the visor, the hair, the jacket, and the
cyan and gold frames that mark Landlords and Penthouses.

The 192 are walked across the whole collection in strides rather than taken from
the front, because ids are issued in generation order and a contiguous run shares
more traits than the collection does.

`x-cover-all-3338.png` is kept for the one post where "all 3,338" is the claim
being made. It is not the header.

**On the avatar:** the coin carries Resident #2971, the TSM penthouse, drawn by
the collection's own renderer from that token's published traits. It is a coin
and a character at once, which is what a currency has always done: put a face on
the obverse.

It started as #66, the NVDA penthouse, which is the better story. That token
pairs the darkest skin in the trait set with the darkest jacket, and inside a
small dark circle the figure would not separate from the sky behind it.
Brightening does not fix that, because lifting every pixel raises the backdrop
as much as the face. What reads is a light face on a dark ground, so the coin
wears Porcelain over Midnight with a cyan visor.

---

## Pinned post

The article needs something to drive to it. A link with no hook gets scrolled.

```
We made every building's height a live stock price.

38 Chainlink feeds. One city. Walk down Tech Row and you can see which company
towers over its neighbours. You don't read it, you just see it.

Market opens at 9:30 and the whole skyline wakes up at once.

Here's how we built it 🧵👇
```

Then quote-link the article.

**Why this shape:** the first line is the entire concept in nine words, and it
works with no context and no image. The "market opens and the skyline wakes up"
line is the one that makes people want to *see* it, which is what actually drives
a click. No emoji until the last line, no "excited to announce", no "gm".

---

## Launch-day sequencing

1. **Profile first.** Avatar, header, bio, link — all live before a single post.
   People check the profile before they follow, and an incomplete one reads as
   abandoned.
2. **Pinned post + article**, timed for a weekday morning US Eastern. Post it
   *before* 9:30 so the market open lands while people are looking.
3. **A clip of the open.** The thirty seconds where the city unfreezes is the
   single most convincing thing you have. Record it live rather than describing
   it.
4. **Reply to your own thread with the audit endpoint.** Almost nobody in this
   space will publish a live invariant check on their own economy. Doing it
   unprompted is the strongest trust signal available, and it costs nothing
   because it is already built.

---

## What not to claim

The article is honest about this and the account should be too, consistently —
one over-claiming post undoes the whole posture:

- **$BLOCK has no cash value and no cash-out path.** Never imply otherwise, and
  never say "earn" without that qualifier nearby.
- **Do not describe it as a way to make money.** It isn't one, and saying so
  invites exactly the regulatory attention the design was built to avoid.
- **Do not promise the coin gate yet.** The Vault admits Quanto Residents. The
  coin path is designed and not built, so say "NFT holders" until it ships.
- **Do not call the price data tradeable.** It is displayed for entertainment.
