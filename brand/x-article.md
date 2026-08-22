# The Skyline Is the Chart

### We built a city where every building's height is a live stock price. Here is how it works, what it cost us to get right, and what we deliberately refused to build.

---

## I. The one idea

A stock chart is a line on a grid. It has been a line on a grid since the 1930s, and it works — it is dense, precise, and completely unambiguous. It is also the least memorable image in finance. Nobody has ever walked away from a candlestick chart with a feeling.

Quanto starts from a simple substitution. Take the price, and instead of plotting it as a height on an axis, make it the height of a **building**. Put the building on a street. Put the street in a district with other buildings that move for the same reasons. Then let people walk around inside it.

That is the whole idea, and it is not a metaphor. NVDA's tower in Quanto is not "inspired by" NVDA's price. It is a Chainlink oracle read, converted to a height in pixels, updated live. When the feed moves, the building moves. When the market closes, the building freezes and the lights change. A tower you walked past on Monday is a different height on Thursday, and the reason is the same reason your brokerage app shows a different number.

We think this matters for a reason that has nothing to do with games. A chart tells you what happened. A skyline tells you what things are *relative to each other*, instantly, without reading anything. You can look down a street in Tech Row and know — not calculate, know — that one company towers over its neighbours. You cannot get that from thirty-eight tabs.

---

## I½. About the name

A *quanto* is a real derivative. The word is short for "quantity adjusting option", and it describes a contract whose underlying asset is priced in one currency but which settles in another, at a fixed exchange rate. A quanto lets you take a position on a Japanese stock and be paid in dollars without ever touching yen. The exposure is to the asset; the settlement happens somewhere else entirely.

We did not pick the name because it sounds good, though it does. We picked it because it is precisely — almost uncomfortably — what this game is.

Quanto's underlying is the real market: thirty-eight live feeds, moving for reasons that have nothing to do with us. But nothing settles there. You are not exposed to those prices and you cannot gain or lose money on them. The exposure is real and the settlement happens somewhere else, in floors and towers and a currency that exists only inside the city.

It is the most honest name we could have chosen, and it happens to be a word most people in finance already know and most people outside it have never heard. That is a good place for a name to sit.

---

## II. Why a city, and not a dashboard

We tried the obvious things first. A 3D bar chart is not a city; it is a bar chart with extra steps. A "metaverse trading floor" is a room where the interesting thing is on a screen inside the room, which is worse than just having the screen.

What makes a city work is that the data becomes **architecture** — something you navigate rather than read. Three properties fall out of that, and none of them exist in a dashboard:

**Scale is felt, not parsed.** A tower four times taller than its neighbour reads as four times in a way that "412.6 vs 103.4" never does. Your eye does the maths before your brain starts.

**Neighbourhoods carry meaning.** Assets that move together are placed together. Walking from one district into another is a genuine change in atmosphere, because the things around you behave differently.

**Presence changes everything.** Other people are in there, walking the same streets, watching the same towers move. A number going up alone is information. A number going up while forty people watch it is an event.

Quanto has four districts, and they are laid out from the actual asset list rather than by hand:

**Tech Row** — Tall, glassy, volatile. The skyline that moves most. NVDA, AAPL, MSFT, GOOGL, META, AMZN, AMD, ORCL, INTC, MU, ASML, TSM, DELL, SNDK, BABA.

**Crypto Alley** — Never sleeps. The only district lit through the weekend. ETH, BTC, LINK, COIN, MSTR, CLSK, CRCL.

**Moonshot Mile** — Meme stocks, quantum, and rockets. Wildest swings in the city. TSLA, GME, PLTR, IONQ, RGTI, RKLB, NBIS, CRWV, SPCX, USAR.

**Index Plaza** — Broad funds and metals. Low, stately, dependable. SPY, QQQ, SGOV, SLV, USO, EWY.

Thirty-eight towers. The districts are not decoration — Crypto Alley genuinely stays lit at 3am on a Sunday while the rest of the city sits frozen and dark, because crypto genuinely trades then and equities genuinely do not. The first time you wander into a dead Tech Row on a weekend and find Crypto Alley blazing, the market calendar stops being a fact you know and becomes a place you have been.

---

## III. What is actually on-chain

Quanto runs on **Robinhood Chain**, and reads prices through **Chainlink** feeds. Thirty-eight of them, polled live.

It is worth being precise about what that does and does not mean, because "on-chain" is a word that has been stretched until it means almost nothing.

**The prices are real oracle reads.** Not a REST API we scrape, not a delayed feed, not numbers we generate and describe as market-like. The server reads Chainlink aggregators and converts the answer to a building height. If a feed goes stale, the tower shows it as frozen rather than quietly holding the last value and pretending.

**The NFT ownership is a real chain read.** When the game decides whether you may enter a holders-only venue, it calls `balanceOf` against the collection contract on Robinhood Chain and reads what your wallet actually holds. It does not trust anything the client says. A modified client that claims to hold a Penthouse gets exactly nothing, because the claim is never consulted.

**The game simulation is not on-chain, and should not be.** Player movement runs at sixty simulation steps a second and replicates to everyone twenty times a second. Putting that on a chain would be slower, more expensive, and worse in every dimension that matters. The chain is where **ownership and price truth** live. The city is where the game lives. Conflating those two is how projects end up with a five-second delay on walking.

---

## III½. How a price becomes a building

The conversion is the heart of the whole thing, and it is worth showing, because the naïve version does not work at all.

The obvious approach is a direct mapping: height equals price. Try it and the city is unusable. A share trading at four dollars and a share trading at nine hundred are both real and both interesting, and one of them is invisible next to the other. Index Plaza would be a car park and a single Tech Row tower would leave the atmosphere.

So height is not price. Height is **price mapped within that asset's own recent range**, then scaled into a shared architectural band. Every tower gets the full expressive range of the city, which means a four-dollar stock having a spectacular day looks genuinely spectacular — as it should, because for that asset it is.

The renderer turns that height into geometry on a 2:1 isometric grid: 64 pixels wide and 32 tall per tile, with 5.5 pixels of building per unit of height. Those numbers are not arbitrary. 2:1 is the classic isometric ratio because every diagonal lands on exact pixel boundaries, which is what keeps pixel art crisp instead of shimmering as it moves. Towers occupy a two-tile span; smaller filler buildings occupy one, and exist so the city has streets rather than a field of monoliths.

Heights are **eased rather than snapped**. When a feed updates, a tower does not teleport to its new height; it travels there over several frames. A city of buildings that jump is unreadable and faintly nauseating. A city of buildings that rise is a city you can watch.

One consequence we did not anticipate: because the easing is visible, you can see the *direction* of a move before you can read it. A tower is going up — you know that before you know which tower it is, from across the district, out of the corner of your eye. That turned out to be one of the best things in the game, and it was a side effect of a rendering decision rather than a designed feature.

---

## IV. The engineering, honestly

This section is longer than a launch post usually warrants. We are including it because the thing we are proudest of is not the concept — concepts are cheap — but that the thing runs correctly under conditions that break most multiplayer games.

### The server is authoritative, and the client predicts

Every player input is simulated twice: once immediately on your machine so the game feels instant, and once on the server, which is the only version that counts. When the two disagree, the server wins and your client rewinds and replays.

That only works if the two simulations are **identical** — not similar, identical. The movement function is a line-for-line twin on both sides, and any drift between them shows up as rubber-banding at exactly the moments players care about most. It is the single most fragile piece of code in the project and it is commented as such.

### Volatility is bucketed on purpose

Towers do not just have a height; they have a **temperament**. Each is assigned one of four volatility tiers — `calm`, `normal`, `hot`, `extreme` — with multipliers of 1.0×, 1.6×, 2.4× and 3.5×.

These are deliberately **buckets, not a continuous function**. A continuous multiplier would be more "accurate" and completely unreadable: nobody can feel the difference between 1.61× and 1.64×. Four tiers can be learned in a day, recognised at a glance, and reasoned about. "This is a hot tower" is a thought a player can have. "This tower has a volatility coefficient of 2.37" is not.

This is a general principle in the design. Where accuracy and legibility conflict, and no money depends on the difference, we choose legibility.

### The ledger, and the invariant we refuse to break

Every unit of in-game currency that has ever existed was created by an **append-only ledger entry**. Not one balance is ever set directly — not the signup grant, not floor yield, not a sale.

That gives us one line of arithmetic that must always hold:

```
SUM(ledger.amount) == players.block
```

The sum of every ledger row for a player must equal that player's balance. If it doesn't, something wrote money into existence without recording where it came from.

This is exposed at a public `/audit` endpoint. It reports the number of players whose balance disagrees with their own ledger, and it should always be zero.

We are telling you about this because it caught real bugs, and because an economy whose books do not balance is not an economy. During pre-launch testing against a production database it reported drift of exactly one player. The cause was a function that credited a balance and queued a ledger row but failed to mark the row dirty for the batched writer. Local testing never showed it. It surfaced within minutes of pointing the server at a real database in another region, and the audit is the only reason we saw it at all.

### The bugs that only exist at distance

That was not the only one, and the pattern is worth naming because it generalises.

Locally, the game runs against an in-process database. Writes settle in microseconds. Against a managed Postgres in another region, writes take hundreds of milliseconds — and every race that was theoretically possible becomes routinely observable.

Three bugs surfaced this way, all of them money- or ownership-adjacent, none of them detectable locally:

**Founding a crew failed for legitimate new players.** A function that flushed pending writes returned immediately if another flush was already running. Callers that depended on their data being on disk carried on against a database that did not yet have it.

**A sold floor could exist twice.** After a trade, the pre-trade ownership counts for both parties were still sitting in the write-behind queue. The next flush wrote them back over the settled transfer, handing the seller their floor back while the buyer kept theirs.

**The seller was not paid.** The ledger recorded the credit. The balance did not move.

Every one of these is invisible in development and catastrophic in production. We found them because we rehearsed against the real database before launch instead of after, and every fix ships with a regression test that was verified by reintroducing the original bug and confirming the test catches it. A test that has never failed proves nothing.

---

## V. The economy

The in-game currency is **$BLOCK**. Every new resident starts with 500.

### Floors

Towers have floors, and floors can be owned. Buying a floor in a tower gives you a stake in it: floors generate yield, and the yield scales with the tower's volatility tier. A floor in a `calm` Index Plaza fund pays steadily and slowly. A floor in an `extreme` Moonshot Mile name pays 3.5× as fast and feels completely different to hold.

Owned floors are also **visible**. Every owned floor renders as a lit window, so the glow of the skyline at night is a direct readout of the player economy. A tower that is fully leased is blazing. A tower nobody believes in is dark. You can see, from across the city, where everyone else has put their money.

### The floor market

Floors are tradeable between players. List one at a price, and anyone can buy it. The transfer and the payment settle in a single database transaction, because the alternative — moving the floor and then paying, or paying and then moving the floor — has a failure mode where one half happens and the other does not.

### CHARGE

Players have CHARGE, capped at 100. It is spent by doing things and regenerates over time — faster while standing in one of the city's parks or on the central plaza. It is the pacing mechanism, and it is the reason the game has places to *rest* rather than only places to earn. A city that is entirely productive is a spreadsheet with weather.

### Crews

Players can found and join crews. A crew has a name, a tag that travels with every message you send, a colour, and a shared identity in the city. Crews aggregate the floors their members hold, which makes tower control a group activity rather than a solo one.

Crews founded by a **Landlord**-tier NFT holder are *chartered*, and may grow to fifty members rather than twenty. Notably, the charter lives on the **crew**, not on the founder — selling the token later does not evict forty people from a crew that already exists. Perks that can be revoked retroactively from people who did not do anything wrong are a design mistake, not a feature.

### Territory

Each tower can have a landlord — whoever holds enough of it. The landlord's name renders **on the building itself**, so walking the city tells you who owns what without opening a single panel. This is the closest thing Quanto has to a leaderboard that you experience rather than read.

---

## V½. Storms, shifts, and the free-to-play floor

Two systems keep the city from being a place where only floor-owners have something to do.

**Shifts** are work. You clock in at a tower, do a job there for a stretch of time, and get paid in $BLOCK. It is deliberately the least glamorous mechanic in the game and deliberately the one that guarantees an income floor: a player who owns nothing, holds nothing and bought nothing can still earn, still enter the market, and still climb. We consider that non-negotiable. A game where the only way to earn is to already own is not a game, it is a funnel.

**Volatility storms** are the opposite — rare, and unschedulable. When a tower's feed starts moving violently, a storm breaks over that part of the city. The tower blazes, the district's atmosphere changes, and **data shards** begin spawning in the streets around it. Shards are collected by running to them, and the whole thing becomes a scramble.

Storms are driven by real volatility, which means they cannot be scheduled and cannot be farmed. Nobody knows when GME is going to have a day. You can only be in the city when it does — which is exactly the incentive we wanted. Be present, and eventually something happens that nobody planned.

The Vault's Storm Rave fires from the same trigger. When the tape goes wild, the club goes wild, the streets fill with shards and the skyline lights up, all from one number that none of us control.

---

## VI. Quanto Residents — the collection

**3,338** generated residents. The number is not round on purpose; round supplies are the first thing anybody checks and the first thing that reads as arbitrary.

Every resident is pixel art, generated on a 32×32 grid and delivered upscaled, drawn from a trait system covering jacket, collar, hair, visor, skin, and accessory. Backgrounds carry the city itself — a skyline silhouette and drifting data specks behind every portrait.

Three tiers:

| Tier | Supply | What it is |
|---|---|---|
| **Resident** | 3,000 | The city's population |
| **Landlord** | 300 | Charters a crew to 50 members |
| **Penthouse** | 38 | One per tower. There are thirty-eight towers and thirty-eight penthouses |

That last line is the part we like most. **There is exactly one Penthouse per tower in the city.** Holding the NVDA penthouse is not "holding a rare NFT" — it is holding *the top floor of that specific building*, and there is precisely one, forever, and it is named on the tower.

Penthouse holders carry weight in their tower's territory resolution. And because ownership is read from chain rather than cached indefinitely, a holder who sells and never returns stops holding the tower within a day rather than holding it forever — the game re-verifies, and an unverified penthouse decays out.

### The coin logo is a Resident

The $BLOCK coin mark is drawn with the collection's own renderer, on the same 32×32 grid, out of the same palette. It is round where the portraits are square — the silhouette has to identify itself at 48 pixels in a crowded timeline — and its face is a skyline rather than a letter, because the product's whole thesis is that the skyline *is* the chart. The coin states the thesis instead of initialising the name.

---

## VII. The Vault

There is a club in Crypto Alley called The Vault, and you cannot get in unless you hold.

The design constraint we set ourselves was that **a club nobody can see is not a perk, it is a private server**. So The Vault is open-topped and sits beside the central plaza — the one place everybody walks past. You can stand outside it. You can see in. You can read the names of the people inside, because nameplates carry over the wall. You can watch the light spill onto the street and the beams sweep overhead during an event.

And then you can be turned away at the rope.

Standing at a rope watching a party you cannot join is the entire mechanism. We spent most of the design effort on making the venue visible from *outside*, because that is where the feeling lives.

Inside, the dance floor is driven by live market data: it runs green when the market's mood is positive, red when it is negative, faster and tighter as volatility climbs, and goes to full intensity during a volatility storm. The music is generated in-browser from oscillators, with tempo and filter driven by the same volatility numbers — roughly 110 BPM when the tape is calm through 150 in a storm. No audio files, no licensing, and a club that genuinely gets harder when the market moves.

Events fire from real market moments rather than a calendar: **Closing Bell** when the market flips from open to closed, **Storm Rave** when a volatility storm starts, **Season Party** on the weekly rollover. They are announced to *everyone*, holder or not. A guest seeing "Closing Bell at The Vault — 18 inside" is not an oversight. It is the point.

**The Vault pays nothing.** No drops, no rewards, no shards, no CHARGE bonus. It writes zero ledger rows. This was considered and deliberately rejected: paying people to be in a token-gated room turns a party into a farm, and turns every non-holder's exclusion into a financial penalty rather than a social one.

---

## VIII. What we refused to build

We think you can judge a project more accurately by what it declined to ship than by what it shipped. Four things were on the table and are not in the game.

**No betting on price direction.** This is the obvious feature. It is the first thing anyone suggests, it would probably work commercially, and it is not going to happen. A game where you wager on whether a real security goes up or down is a prediction market on securities wearing a costume. We are not interested in finding out which regulator agrees.

**$BLOCK has no cash value and no cash-out path.** You cannot withdraw it, sell it for currency, or redeem it. It is a game currency. Any future in which that changes is gated behind an external audit and a legal review, and we would rather say so plainly now than imply otherwise and disappoint people later.

**Value flows into the game, never out.** The game may read a token, spend it, or burn it. It will never mint one or pay one out. Every token mechanic is bounded by that rule, and it is the rule that keeps the economy from being a yield product.

**No tier, NFT, coin, or club creates a payout path.** Holding makes you *visible* and *powerful within the city*. It does not make you money inside the game. The moment holding pays, the game becomes an investment product and every design decision after that is made by a lawyer.

We would rather build something people talk about because it is strange and good than something people talk about because it is briefly profitable.

---

## IX. The details we sweated

A short list, because these are the things that will not show up in a screenshot and are most of the actual work.

**Guest identity is never sent to a client.** A device id *is* an identity in the guest system, so leaking one would let anyone join as that player. Direct messages are addressed by session and resolved to a device server-side, and conversation threads carry an HMAC handle scoped to prior correspondents rather than a raw identifier.

**Blocks were built before the first incident, not after.** Proximity chat is self-limiting because the sender has to physically be there. A DM reaches anyone, which is how harassment arrives. Blocking is enforced server-side on send, so a blocked message is never written and never delivered — verified by removing the check and confirming the test fails.

**The door fails open.** If a chain read fails while deciding whether you may enter The Vault, you get in. A holder wrongly refused entry is a refund request and a support ticket; a non-holder who slips in for five minutes during an RPC blip is nothing at all.

**Sign-in is mandatory, and the server enforces it.** Not the client. The server refuses an unauthenticated join outright, and refuses to *start* if it is configured to require accounts without the means to verify them — a server that is up, healthy and impossible to log into is worse than one that failed loudly at boot.

**Identity and holdings are separate systems.** Your account says who you are. Your wallets say what you hold, and holdings are read across *every* wallet you have proved, because people keep tokens in a cold wallet and play from a hot one. Checking a single address refuses a genuine holder, which is the one failure the entire gating design exists to prevent.

---

## X. How to play

There is nothing to install. Open the site, sign in, and you are in the city.

Sign-in is by email or wallet. If you sign in with an email you get an account immediately and can connect a wallet later, whenever you want to bring an NFT in. Your floors, your crew, your balance and your name follow you to any device, because the account is the identity rather than the browser.

You start with 500 $BLOCK. Walk. Look at what is tall and what is short and what is glowing. Buy a floor in something you have an opinion about. Watch the window light up.

Then come back on a day when the market has moved, and see what the street looks like now.

---

## X½. A day in the city

It is 9:25am Eastern. The city is dark and still. Tech Row is frozen, every tower holding Friday's close, lights low, nothing moving anywhere. A handful of people stand around in Crypto Alley, which never closed, watching BTC drift. Someone is working a shift on the ETH tower because there is nothing else to do yet.

9:30. The market opens and the city wakes up in a wave. Towers unfreeze. Heights start moving. The frozen grey lifts off Tech Row and thirty-one buildings begin to breathe at once. If you have never seen it, the effect is genuinely startling — it is the best thirty seconds in the game, and it happens every weekday for free.

By mid-morning the city has a shape. Someone in Moonshot Mile is shouting in district chat that RGTI is going vertical. It is: the tower has gained a third of its height in twenty minutes and is the brightest thing on that side of the city. A storm breaks over it. Shards start spawning. Eleven people abandon whatever they were doing and sprint down the Mile.

Someone lists a floor in that tower at four times what they paid on Tuesday. It sells in under a minute. The seller's balance moves, a new window lights up in the tower, and the whole exchange is a line in a ledger that still has to balance at the end of the day.

The afternoon is quieter. Index Plaza does what Index Plaza does — barely moving, stately, full of people who decided slow and certain is a strategy. A crew argues about whether to consolidate their floors into one tower to take the landlord slot or spread them for yield. Their tag rides on every message they send.

4:00pm. Closing Bell. The equity districts freeze, the light changes, and The Vault throws a party for twenty minutes. Most of the city cannot get in. A crowd forms outside at the rope, reading the names of the people who can and watching the beams sweep. Crypto Alley stays open behind them, lit and moving, completely indifferent.

Later the city is dark again, except for the Alley and the windows — every one of them a floor somebody bought because they had an opinion about a building.

---

## XI. Where this goes

We are launching with the city, the collection, the market, crews, the messaging layer and The Vault. Things we have built the foundations for and will ship as they earn it:

**Coin-gated entry alongside NFT-gated entry.** The Vault currently admits Quanto Residents holders. The coin path is designed and not yet built, and we would rather ship the smaller true promise than the larger half-built one.

**Seasons.** Weekly seasons already run and already roll over. Making them *matter* — with a season party, a reset, and a record of who held what — is the next thing.

**More of the city.** Thirty-eight towers is a skyline. It is not yet a city with a personality on every street, and we know the difference.

---

## XII. The bet

Here is the thing we actually believe.

Financial data is the most-produced and least-loved content on the internet. Billions of dollars of it are generated every second and almost all of it is consumed as a grid of numbers by people who have trained themselves to tolerate a grid of numbers.

We do not think that is inevitable. We think it is a UI that won in 1935 and never faced a serious challenger.

A city is a serious challenger. It is legible at a glance, it is memorable, it is social, and it is *fun to be in* — and none of those things require the underlying data to be any less real. The prices in Quanto are exactly as accurate as the ones in your brokerage app. They are just standing up.

Come and look at the skyline.

**quanto.fun**

---

*Quanto is a game. $BLOCK is a game currency with no cash value and no redemption path. Nothing here is financial advice, and nothing in the game is a wager on the price of any security. Price data is displayed for entertainment; do not trade on it.*
