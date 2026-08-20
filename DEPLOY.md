# Deploying Quanto

## The constraint that decides the architecture

**The game server cannot run on Vercel.** Vercel is serverless: functions start on a request,
die shortly after, share no memory, and have no persistent disk. This server is the opposite of
all three — it holds the whole city in memory, runs a 20Hz simulation loop continuously, keeps
long-lived WebSocket connections open, and writes to a database file.

So the split is:

| Part | Host | Why |
|---|---|---|
| **Client** (static build) | **Vercel** | It's just files. Free, global CDN, instant. |
| **Server** (Colyseus) | **Railway** | Long-lived process + persistent volume. |

Both on Railway also works fine and is one less dashboard. Vercel is only better for the client
because of the CDN.

---

## 1 · Server on Railway

```bash
cd server
```

1. **New Project → Deploy from GitHub repo**, root directory `server/`. Railway detects the
   `Dockerfile` automatically.
2. **Add a Volume** and mount it at `/data`. This is the step people skip: without it, every
   redeploy silently wipes every player's floors, balance and signs, because a container's own
   filesystem does not survive a restart.
3. **Variables:**

   | Variable | Value |
   |---|---|
   | `DATA_DIR` | `/data` |
   | `ALLOWED_ORIGIN` | your Vercel URL, e.g. `https://quanto.vercel.app` |
   | `MAX_PLAYERS` | `150` |

   Don't set `PORT` — Railway injects it.
4. **Generate a domain** (Settings → Networking). Railway serves it over TLS, so your WebSocket
   URL is `wss://…`, not `ws://`.

Health check is already wired to `/health` in `railway.json`.

---

## 2 · Client on Vercel

```bash
cd client
```

1. **Import the repo**, root directory `client/`. Framework preset: Vite.
2. **Environment variable:**

   | Variable | Value |
   |---|---|
   | `VITE_SERVER_URL` | `wss://your-server.up.railway.app` |

   It must be `wss://`. A page served over https cannot open an insecure `ws://` socket — the
   browser blocks it as mixed content, and the symptom is a game that loads but never connects.
3. Deploy.

Then go back and set Railway's `ALLOWED_ORIGIN` to the real Vercel URL.

---

## 3 · Verify

```bash
curl https://your-server.up.railway.app/health
```

Expect `"ok": true`, `"tickers": 38`, and a recent `lastPollAt`. If tickers is 0, the server
can't reach the Robinhood RPC.

Then open the client, and check the diagnostics panel (top right): **city built: yes** with
non-zero fps means the whole chain is working.

---

## Scaling to 100+ players

At this size you need **one instance**, and that's genuinely fine — but know the ceilings:

**Everyone must share one room.** `MAX_PLAYERS` defaults to 150. When a room fills, Colyseus
opens a second one, and players in different rooms *cannot see each other* — the world silently
splits in two. That's the failure mode to watch for, and it looks like "the city is empty" rather
than an error.

**Bandwidth is the real limit, not CPU.** Every client receives position deltas for every other
player at 20Hz. That scales quadratically. Past roughly 200 concurrent you need interest
management — only replicating players near you — which is a real piece of work, not a config
change.

**Do not set `numReplicas` above 1.** PGlite is a local file and the game state lives in one
process's memory. Two replicas means two separate cities and two divergent databases. Scaling
horizontally requires Redis presence + driver (Colyseus supports this) and Postgres instead of
PGlite.

**The oracle doesn't scale with players.** It's one multicall every 20 seconds regardless of
whether 5 or 500 people are online, so RPC cost stays flat. That part is already right.

### If you outgrow one instance

In rough order:
1. Interest management (biggest win, no infra change)
2. Postgres instead of PGlite — replace `server/src/game/store.ts`, nothing else
3. Redis presence + driver, then multiple replicas behind sticky sessions

---

## Cost, honestly

Railway's hobby tier runs about $5/month and comfortably handles this at 100 players. Vercel's
free tier covers the client. The public Robinhood RPC is free but rate-limited — if the oracle
starts failing under load, move to a dedicated RPC provider and set it in
`server/src/oracle/ChainlinkPoller.ts`.

---

## Before you launch publicly

- [ ] Volume mounted at `/data`, or you *will* lose player data on the first redeploy
- [ ] `ALLOWED_ORIGIN` set to the real client URL, not `*`
- [ ] `VITE_SERVER_URL` uses `wss://`
- [ ] Test a redeploy and confirm your floors survive it
- [ ] Two browsers, two different networks, confirm you can see each other
- [ ] Set `DEBUG_TOKEN` on Railway, or anyone can summon storms on your live server
      (`POST /debug/storm/NVDA?token=…`)
