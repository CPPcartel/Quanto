# Going live

Everything buildable is built and verified. What remains is the work only you can
do — creating accounts, holding credentials, and making the two judgement calls
that carry real risk.

Read this top to bottom once before starting. **Steps 1–5 take about an hour and
put the game live. Step 6 is where money and law enter, and it is deliberately
last.**

---

## The one architectural fact to know first

**The game server cannot run on Vercel.** Vercel is serverless: functions start on
a request, die shortly after, share no memory and have no persistent disk. The
game server is the opposite of all three — it holds the city in memory, runs a
20 Hz simulation loop continuously, and keeps WebSocket connections open.

| Piece | Where | Why |
|---|---|---|
| Client (site + game) | **Vercel** | Static files. Free, global CDN. |
| Game server | **Railway** | Long-lived stateful process. |
| Database | **Supabase** | Managed Postgres. |

---

## 1 · Supabase (~10 min)

1. Create a project at supabase.com. Save the database password it shows you — it
   is displayed once.
2. **Project Settings → Database → Connection string → URI**, and pick the
   **Transaction pooler** (port 6543), not the direct connection. The pooler is
   what lets a long-lived server hold a small pool safely.
3. That string is your `DATABASE_URL`.

Nothing else to configure. **Migrations run automatically on server boot** — all
six of them, idempotently. You do not need to paste SQL anywhere.

> Row Level Security is irrelevant here and should stay off for these tables: the
> game server is the only database client, and it connects as the service role.
> No browser ever holds a database credential. Anything a client could write, a
> determined player could forge.

---

## 2 · Privy (~10 min)

1. Create an app at dashboard.privy.io.
2. Copy the **App ID** and the **App Secret**.
3. In **Login methods**, enable: Email, Google, Twitter, Discord, Wallet.
4. In **Embedded wallets**, set *Create on login* → **Users without wallets**.
   This is the setting that quietly gives an email-only player a real
   self-custodial wallet.
5. In **Allowed domains**, add your Vercel URL once you have it (step 4), plus
   `http://localhost:5173` for development.

---

## 3 · Game server on Railway (~15 min)

New Project → Deploy from GitHub repo → root directory `server/`. It detects the
Dockerfile automatically.

**Variables:**

| Key | Value |
|---|---|
| `DATABASE_URL` | the Supabase pooler URI from step 1 |
| `PRIVY_APP_ID` | from step 2 |
| `PRIVY_APP_SECRET` | from step 2 |
| `ALLOWED_ORIGIN` | your Vercel URL (fill in after step 4) |
| `MAX_PLAYERS` | `150` |
| `DEBUG_TOKEN` | any long random string |

Do **not** set `PORT` — Railway injects it. Do **not** set `numReplicas` above 1:
the city lives in one process's memory, so two replicas means two divergent
cities.

Then **Settings → Networking → Generate Domain**. Railway serves it over TLS, so
your WebSocket URL is `wss://…`.

> A volume is no longer needed — state lives in Supabase now.

---

## 4 · Client on Vercel (~10 min)

Import the repo, root directory `client/`, framework preset Vite.

**Environment variables:**

| Key | Value |
|---|---|
| `VITE_SERVER_URL` | `wss://your-app.up.railway.app` |
| `VITE_PRIVY_APP_ID` | the same App ID from step 2 |

`VITE_SERVER_URL` **must** be `wss://`, not `ws://`. A page served over HTTPS
cannot open an insecure WebSocket — the browser blocks it as mixed content, and
the symptom is a game that loads but never connects.

Deploy, then go back and set Railway's `ALLOWED_ORIGIN` and Privy's allowed
domains to the real Vercel URL.

---

## 5 · Verify it's actually working

```bash
curl https://your-app.up.railway.app/health
```

Expect `"db": {"kind": "postgres"}` and `"auth": {"privy": "enabled"}`. If you see
`pglite` or `guest-only`, an environment variable didn't take.

Then in the browser:

- Load the site — the skyline should animate with live prices
- Enter the city, walk, lease a floor, watch the window light
- Log in with an email; confirm your progress carries over and a wallet appears
- Open in a second browser and confirm you see each other
- Check the leaderboard populates within a minute

---

## 6 · Before the token — the part that isn't technical

Everything above is safe: free to play, no deposits, no way for anyone to lose
money. **Two gates stand between that and a real token, and neither is mine to
clear.**

### Security audit
An external firm must audit the contracts before mainnet. There are 25 passing
tests and the daily emission cap is enforced on-chain, but **tests are not an
audit** and I will not represent them as one.

### Legal review
A token whose payouts vary with the movement of real securities can be
characterised as a derivative by a regulator, regardless of the pixel art around
it. The design pushes back deliberately — payouts are bucketed into four coarse
volatility tiers rather than tracking price smoothly, they are direction-neutral,
and they reference volatility rather than price. **That reduces exposure. It does
not remove it, and none of it is legal advice.**

Get a lawyer in the relevant jurisdictions before $BLOCK is transferable for
outside value or listed anywhere, including Pons.

### My recommendation on sequencing
Ship steps 1–5 and let people play with no token at all. Measure whether they come
back on day two. A launchpad brings speculators, not players — if the token
arrives first, it pumps, dumps, and the game looks dead exactly when it needed to
look alive. You get one launch narrative; spending it on a token means you cannot
spend it on the game.

---

## Your credentials checklist

Six values, and I have never seen any of them:

- [ ] Supabase `DATABASE_URL`
- [ ] Privy App ID *(also goes in Vercel as `VITE_PRIVY_APP_ID`)*
- [ ] Privy App Secret *(server only — never in a `VITE_` variable)*
- [ ] Railway domain → Vercel's `VITE_SERVER_URL`
- [ ] Vercel domain → Railway's `ALLOWED_ORIGIN` + Privy allowed domains
- [ ] `DEBUG_TOKEN` — any long random string

Anything prefixed `VITE_` is **compiled into the browser bundle and is public**.
The Privy App Secret and the database URL must never be given that prefix.

The contract deploy key from earlier lives in `contracts/.env`, is gitignored, and
its address is `0x8bf3Fbb7A87CeF0A8Ce40BB7B0fB49b60d1a82d1`. It is only needed for
step 6.

---

## Two things still worth doing

Not blockers, but the highest-value work left:

1. **An `og.png`** (1200×630) in `client/public/`. It's what renders when your
   link is posted to X or Telegram, and right now that preview is blank.
2. **The three social links** in `client/src/site/links.ts` — currently
   placeholders that render as dimmed, non-clickable icons.

---

## Running it locally

Unchanged, and needs no credentials at all:

```bash
cd server && npm install && npm run dev    # PGlite + guest play
cd client && npm install && npm run dev    # http://localhost:5173
```

With `DATABASE_URL` unset the server uses PGlite — real PostgreSQL compiled to
WASM — so local development runs the exact SQL that runs on Supabase, with
nothing to install. With Privy unset, the game runs guest-only. Both are
deliberate: a fresh checkout should just run.

```bash
cd server && npm run test:db    # migrations, ledger integrity, leaderboards
cd contracts && npx hardhat test
```
