# Quanto

A multiplayer isometric pixel city where **every building's height is a real, live share price**,
read from Chainlink feeds on [Robinhood Chain](https://docs.robinhood.com/chain/) (chain `4663`).
Own floors, work shifts, chase volatility storms, and hang neon signs on a skyline that moves with
the actual market.

```
client/      React + PixiJS v8  — isometric renderer, HUD
server/      Colyseus            — authoritative game server, Chainlink oracle, Postgres
contracts/   Hardhat + Solidity  — $BLOCK, floor deeds, oracle router, city controller
collection/  Node                — generator for the Quanto Residents NFT art
```

---

## Before you deploy

```bash
node preflight.mjs
```

Builds both sides, runs all 11 test suites, and — first, because it is the one
mistake that cannot be undone — checks that no `.env` or private key is tracked by
git and that no server secret reached the client bundle. It needs no accounts and
no network. Green means the repo is safe to push.

---

## Running it

Two terminals. **No database to install** — with no `DATABASE_URL` set, the server runs
PGlite, which is real PostgreSQL compiled to WebAssembly. Same SQL as production, no Docker.

```bash
# terminal 1
cd server && npm install && npm run dev     # ws://localhost:2567

# terminal 2
cd client && npm install && npm run dev     # http://localhost:5173
```

Open `http://localhost:5173`. Open it twice to see multiplayer.

**Requires Node 22+.** Developed on Node 25.

### Controls

| | |
|---|---|
| `W` `A` `S` `D` | walk |
| `Shift` | run |
| scroll | zoom — street level out to the whole-city Skyline Mode |
| `M` | snap between street and map view |
| click a tower | inspect it |
| `Space` | during a shift, hit the green band |

---

## How it works

### The oracle is read-only

The server polls ~38 Chainlink price feeds every 20 seconds in a single multicall. Reading a
blockchain costs nothing, needs no wallet, and needs no gas — which is why the entire living city
runs today with no wallet connected.

Building height comes from a **log scale** of the real price. Raw price would be unusable: Bitcoin
at $63k would be a thousand times taller than GameStop at $25.

### Market hours are a game mechanic

Robinhood's tokenized-equity feeds are **24/5** — they freeze at the last price when the US market
closes. Rather than patch around that, the city is built on it:

- **Market open** — towers move, storms fire, floors pay full rate
- **After hours** — the skyline freezes, fog rolls in, most floors stop earning
- **Crypto Alley** — never sleeps, because crypto feeds are genuinely 24/7

Session detection cross-checks feed staleness against the ET trading calendar, so feeds ticking in
extended hours don't fool it.

### The client/server split

Movement, chat, weather and minigames run on the game server at 20Hz and **never touch the
blockchain**. Only ownership and money settle on-chain, in batches. Movement uses client-side
prediction with server reconciliation, so it feels instant despite being server-authoritative.

Client and server share a fixed `1/60` simulation step. If they drift, the server will fight the
player's prediction — `applyInput` in `server/src/rooms/CityRoom.ts` and
`client/src/net/prediction.ts` must stay line-for-line twins.

---

## Gameplay

| Verb | Cost | Earns |
|---|---|---|
| **Work a shift** | 12 CHARGE, 30m cooldown | $BLOCK once, scaled by volatility tier and accuracy |
| **Run a storm** | free | shards, first-touch |
| **Lease a floor** | $BLOCK | $BLOCK forever — and lights one window |
| **Mount a sign** | 8 shards + 120 $BLOCK + 20 CHARGE | $BLOCK per passer-by |

**Every lit window is a floor a player owns.** The skyline's glow is the player economy, rendered.

Payouts are bucketed into four coarse **volatility tiers** (calm / normal / hot / extreme →
1× / 1.6× / 2.4× / 3.5×), never a continuous function of price change, and nothing pays more for a
stock going up than down. This is deliberate — see *Legal* below.

### Testing storms

Storms fire off real volatility, so they can't be exercised on a closed market. Join the game first,
then:

```bash
curl -X POST http://localhost:2567/debug/storm/NVDA
```

### Server routes

| Route | Purpose |
|---|---|
| `GET /health` | server + oracle status |
| `GET /oracle` | every current reading, sorted by height |
| `POST /debug/storm/:symbol` | force a storm |

---

## Wallet sign-in

Play-first: the city is fully playable as a guest, and connecting is an optional upgrade.

1. Play — progress saves against a browser id
2. Click **Connect wallet** → sign one message
3. The server verifies the signature against a single-use nonce
4. Guest progress is adopted by the wallet (or the wallet's existing save is restored)

Signing proves ownership only. It authorises no transaction and costs no gas. Nonces are single-use
and expire in 5 minutes, so a captured signature can't be replayed.

---

## Contracts

```bash
cd contracts
npm install
npx hardhat compile
npx hardhat test          # 25 tests
```

| Contract | Role |
|---|---|
| `OracleRouter` | ticker → Chainlink feed, with staleness + sequencer-uptime checks |
| `BlockToken` | $BLOCK ERC-20, **capped per day** |
| `FloorDeed` | ERC-721, one per owned floor |
| `CityController` | buys floors, settles wage batches |

Two safety properties worth knowing:

- **The daily emission cap is on-chain.** Even a fully compromised game server can only mint one
  day's worth. There's a test proving settlement beyond the cap reverts.
- **Floor payments are burned, not pooled.** Floors are a sink, so emission doesn't compound.

### Deploying

Generate a deployment key. **The private key is written to `contracts/.env` and never printed** —
only the address is shown, because that's the only part safe to share.

```bash
cd contracts
node scripts/new-key.cjs
```

Fund the printed address with a small amount of ETH on Robinhood Chain, then:

```bash
npx hardhat run scripts/deploy.cjs --network robinhoodTestnet    # chain 46630
npx hardhat run scripts/deploy.cjs --network robinhoodMainnet    # chain 4663
```

The deploy script registers the real mainnet feed addresses and wires the controller as minter and
deed controller. Set `SETTLER_ADDRESS` to authorise the game server to settle wages.

> `contracts/.env` is gitignored. It holds a **hot key** in plaintext — fund it with roughly what a
> deploy costs and no more. Use a hardware wallet for anything holding real value.

---

## Before launching a real token

Two gates, neither of them technical, and neither of which this repo can clear:

1. **Security audit.** The contracts have tests and are Slither-ready, but an external firm must
   audit them before mainnet. Tests are not an audit.
2. **Legal review.** A token that pays out based on the movement of real securities can look like a
   derivative to a regulator, whatever the pixel art around it. The tier-bucketed, direction-neutral
   payout design above deliberately reduces that exposure — it does not remove it. Get a lawyer
   before $BLOCK is tradeable for real value.

---

## Notable implementation details

- **Ground is one `TilingSprite`.** The pattern tiles seamlessly on the isometric brick offset, so
  the entire street plan is a single draw call instead of ~11,000 tiles.
- **Bloom is thresholded and screen-clipped.** Only pixels above a brightness cutoff glow, so neon
  bleeds while building bodies stay crisp. The filter lives on an untransformed, screen-sized
  wrapper — filtering the world container makes Pixi allocate a city-sized framebuffer.
- **Lit windows are only drawn when owned**, so sprite count scales with the economy, not the map.
- **All art is generated in code** — facades, characters, signs, streets. No downloads, no missing
  assets. Every texture comes from a factory in `client/src/pixi/art.ts`; swap those to move to
  hand-drawn art.
