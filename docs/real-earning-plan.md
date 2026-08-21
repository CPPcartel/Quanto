# Real earning with a real token: a plan

**Status: proposal. Nothing here is implemented and nothing should be until the
preconditions in section 6 are met.**

---

## 0. The short version

You can do this. It is not primarily an engineering problem, and the engineering
is the part you are closest to finishing. `BlockToken.sol` and `FloorDeed.sol`
are already written, and whoever wrote `BlockToken` already worried about the
right thing, because it has a daily mint cap.

The two things that decide whether this works are:

1. **Where the money comes from.** Get this wrong and the design dies on a
   schedule you can predict in advance.
2. **A securities problem that is specific to Quanto** and much sharper than the
   usual "is the token a security" question. Section 2.

Read section 2 before anything else. It is the one that can end the project
rather than merely cost money.

---

## 1. Where does the money actually come from

Every "earn real money" game economy is funded from one of three places. Only one
of them survives.

### Source A: new buyers

Players earn tokens, sell them, and the buyers are the next wave of players.

This is what killed every play-to-earn game of the last cycle without exception.
The failure is mechanical, not bad luck:

- People who arrive to earn are not players, they are workers. They sell on sight.
- Sell pressure is continuous. Buy pressure is only new arrivals.
- Arrivals slow. Price falls. Earnings fall in fiat terms.
- The workers leave for the next game, dumping inventory on the way out.
- What remains is a chart and a Discord.

`BlockToken`'s daily cap slows this. It cannot prevent it. A cap limits the rate
of dilution; it does not create demand. **If the only reason to buy $BLOCK is
that other people need it to earn more $BLOCK, the cap just makes the decline
smoother.**

### Source B: real revenue

NFT mint proceeds, marketplace fees, cosmetics, season passes, sponsorship.

This is money entering the system from outside the token. It is finite, it is
measurable, and it does not depend on recruitment. It is the only durable answer.

### Source C: other players, with you as the venue

Players trade assets with each other. You take a fee. You never pay anyone.

This is the CS:GO skins model and it is the most successful real-money game
economy ever built. Valve has never paid a player a cent. They made items
desirable and provided a market. Value moves between players; the house takes a
cut and carries no liability for anyone's outcome.

**Recommendation: build on B and C. Treat A as forbidden.** The test to apply to
any mechanic: *if new player signups went to zero tomorrow, does this still
work?* If not, it is source A wearing a costume.

---

## 2. The securities problem that is specific to you

This is the section that matters most, and it is not the generic warning.

The usual question is whether your token is a security. That question is real and
your lawyer will answer it. **But Quanto has a second, sharper problem that most
projects do not have.**

Your game's value is derived from **real, live, named securities**. NVDA. TSLA.
SPY. Not fictional assets, not an index you invented. Real tickers, real
Chainlink feeds, real prices.

Now consider a player who:

1. Buys a floor in the NVDA tower,
2. NVDA rises, so the tower grows and the floor yields more and is worth more,
3. Sells that floor for something convertible to real money.

That player has just taken a position on NVDA and been paid according to how NVDA
performed. **The economic substance of that is a derivative on NVDA**, regardless
of what it is called, what it looks like, or that a game is wrapped around it.

Regulators look at economic substance. This is settled and not novel.

You already understood this once. Betting on price direction was deliberately
excluded from the design because it would be "a prediction market on securities."
**Adding a cash-out path to a game whose asset values track real securities
recreates that exact exposure through a longer route.** It is the same trade with
more steps.

### The unavoidable tradeoff

> **The more your real-money outcomes track real market performance, the more
> your product is a derivative. The less they track it, the less special your
> product is.**

That is the whole design problem in one sentence, and there is no clever way
around it. Every option in section 3 is a different position on that line.

Anyone who tells you this is fine because it is "just a game" is telling you
something that has not worked for anyone who tried it with real tickers.

---

## 3. Four architectures

### Option A: emissions (what `BlockToken.sol` currently implies)

$BLOCK becomes a real ERC-20. The server mints it to players for shifts, yield
and shards, inside the daily cap. Players sell it on a DEX.

| | |
|---|---|
| Money from | Source A, new buyers |
| Effort | Low. The contract is written |
| Market link | Total. Yield scales with real volatility tiers |
| Verdict | **Do not build this** |

This is the death-spiral design, and it has the worst version of the section 2
problem: the amount you earn is a direct function of real asset volatility.

### Option B: tradeable floors, you take a fee

`FloorDeed` goes live. Floors become real ERC-721s that players trade on a real
marketplace. You take a percentage. **The game never mints, never pays out, never
promises a return.**

| | |
|---|---|
| Money from | Source C, with source B fees |
| Effort | Medium. Contract exists, needs settlement rework |
| Market link | High and reducible. See below |
| Verdict | **Strongest candidate** |

Structurally much safer: you are a venue, not a counterparty. But floor value
still tracks the underlying asset unless you deliberately break that, which is
the work in section 5.

### Option C: revenue share to holders

Distribute a slice of real revenue to NFT or token holders.

| | |
|---|---|
| Money from | Source B, real revenue |
| Effort | Low technically |
| Market link | Low |
| Verdict | **Economically soundest, legally worst** |

"Buy this asset, receive income generated by someone else's effort" is close to a
textbook Howey recital. Sound business, high risk of being an unregistered
security offering. Do not do this without an opinion letter you paid real money
for.

### Option D: skill competitions with prizes

Seasonal tournaments with real prizes, funded by sponsorship or entry fees. No
token required at all.

| | |
|---|---|
| Money from | Source B |
| Effort | Low. Mostly operational |
| Market link | Severable by design |
| Verdict | **Best near-term option, and available now** |

Esports has walked this path for twenty years and the legal ground is well
mapped. Prizes for skill are treated very differently from returns on an
investment. It needs no contract, no token, and no cash-out path, and it can ship
in weeks rather than quarters.

Its weakness is that it rewards the top few rather than everyone. That is also
precisely why it is legally clean.

---

## 4. Recommendation

**Ship D now. Build toward B. Never build A. Only consider C with counsel.**

Concretely:

- **D gives you real earning this quarter** with no token, no contract, no
  cash-out path, and no change to the honest posture you have already published.
- **B is the real destination**, because a marketplace where you are the venue
  scales, does not require you to promise anyone anything, and gets stronger as
  the game gets more popular rather than weaker.
- **A is the trap.** It is the cheapest to build, which is exactly why so many
  people built it.

---

## 5. Severing the market link

If you go to B, this is the actual design work, and it is the part I would spend
the most time on.

The goal: **make a floor valuable for reasons that are not "the underlying asset
went up."**

Levers available, in rough order of usefulness:

**Scarcity and position, not price.** A floor's worth should come from *which
floor it is* rather than what the ticker did. The penthouse structure already
does this perfectly. There are 38 towers and 38 penthouses, and the top floor of
the NVDA tower is scarce because there is exactly one, forever, not because NVDA
went up.

**Status and visibility.** Landlord names render on buildings. Crew charters.
Vault access. These are worth real money to real people and none of them are a
function of price.

**Utility inside the city.** Territory control, crew size, access to venues,
cosmetic rights. Game power, not financial exposure.

**Decouple yield from volatility tiers.** This is the painful one. Right now
yield scales 1.0x to 3.5x with the real asset's volatility. If yield converts to
real money, that multiplier is the derivative. Options: make yield a function of
game activity rather than asset volatility, or keep tiers as pure gameplay flavour
with no cash-convertible consequence.

**Cap the correlation explicitly.** If floor prices in your own marketplace start
tracking the underlying with high correlation, that is measurable, and it is
evidence. Measure it deliberately rather than finding out from someone else.

**Note honestly:** every one of these makes the product slightly less magical.
The market link is the best thing about Quanto. This is the cost of the cash-out
path, and it should be weighed rather than assumed away.

---

## 6. Preconditions, before a single line is written

Non-negotiable, in order:

1. **A named legal entity in a named jurisdiction.** Everything else depends on
   where you are.
2. **A securities opinion covering both questions**: is the token a security, and
   does the market-linked cash-out path create derivative exposure. Insist on the
   second one explicitly. It is the one that gets skipped.
3. **Geofencing plan.** Several jurisdictions will be off the table. Know which
   before you launch, not after.
4. **KYC/AML** if there is any fiat off-ramp. This is a real operational burden,
   not a checkbox.
5. **A funded smart-contract audit.** `BlockToken` and `FloorDeed` are
   unaudited. Real money means an audit before mainnet, not after.
6. **Tax analysis**, both yours and your players'. Paying people creates
   reporting obligations in many places.
7. **Terms of service written for this**, not adapted from a game template.

Item 2 is the gate. If the answer is bad, items 3 through 7 do not matter.

---

## 7. Phasing

**Phase 0: measure the thing you cannot fake.** Change nothing. Launch as is and
find out whether people play *without* being paid. This is the single most
valuable piece of information you can get, and it is free. If retention is poor
without earning, adding earning does not fix it, it just changes who leaves and
how loudly. If retention is good, you have something worth protecting and every
subsequent decision gets easier.

**Phase 1: real money in, none out.** Mint revenue, cosmetics, season passes. No
payouts, no token, no legal exposure beyond ordinary commerce. Proves people will
spend, which is the precondition for any marketplace being worth anything.

**Phase 2: competitions.** Option D. Real prizes, funded by phase 1 revenue.
Real earning arrives with no cash-out path and no token.

**Phase 3: the marketplace.** Option B, and only after the section 6 gate. Floor
deeds on chain, real marketplace, you take a fee. This is where "real earning"
becomes structural rather than promotional.

**Phase 4: a token, only if it earns its place.** By phase 3 you will know whether
a token solves a problem you actually have. Most projects issue one first and
spend years looking for the problem.

---

## 8. What this costs you

Be clear-eyed. The current posture is a genuine asset, and I would not trade it
cheaply.

Right now you can say: no cash value, no cash-out, value flows in and never out,
nothing gated pays. That is unusual, it is credible, and it is *why* the audit
endpoint and the refusals list land the way they do.

Adding real earning spends that. Not entirely, and not irrecoverably, but it does.

The published copy handles this correctly already, and deliberately. The article
says any change is "gated behind an external audit and a legal review." That is
true, it leaves the door open, and it does not promise never. **Do not tighten
that language, and do not loosen it.** If you decide to go this way, phase 1 and
2 require no walk-back at all, because prizes and revenue are not payouts.

---

## 9. Kill criteria

Decide these now, while nothing is at stake:

- **Legal opinion says the market link creates derivative exposure that cannot be
  designed around.** Stop. Ship D forever and keep the closed economy.
- **Phase 0 shows people only play when paid.** Stop. Earning will not fix a game
  people do not want.
- **Floor prices in your marketplace correlate above some threshold you set in
  advance with the underlying tickers.** You have built a derivative by accident.
  Sever the link or stop.
- **Revenue is not covering prizes by end of phase 2.** The economics do not work
  and phase 3 will not rescue them.

---

## 10. The one-paragraph answer

Yes, you can add real earning, and the strongest version does not look like the
version people ask for. It is a marketplace where players earn from each other
and you take a fee, not a faucet where the game pays people to show up. Ship
competitions first because they need no token and no cash-out path. Build the
marketplace second, after a lawyer has answered the specific question of whether
a market-linked cash-out path makes your floors derivatives on real securities.
Do not deploy `BlockToken` as an emissions faucet, because that design has a
failure mode you can already predict, and the daily cap does not prevent it.
