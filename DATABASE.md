# Database, economy and leaderboards

## The short version

The game server is the **only** thing that writes to the database. Clients never
hold credentials and never write — anything a client can write, a determined player
can forge.

Balances are not mutable numbers. Every movement of currency is an **append-only
ledger entry**, and `players.block` is a materialised cache of that ledger. There is
an endpoint that proves the two agree.

Writes never touch the game loop. They queue in memory and flush in one batched
transaction every five seconds.

---

## Running it

**Locally you need nothing.** With no `DATABASE_URL`, the server runs
[PGlite](https://pglite.dev) — real PostgreSQL 18 compiled to WASM — from
`server/data/pg`. Same SQL as production, no Docker, no setup.

```bash
cd server && npm run dev
```

### Connecting Supabase

1. Create a project at [supabase.com](https://supabase.com).
2. **Project Settings → Database → Connection string → Transaction pooler**
   (port `6543`, *not* 5432 — see below).
3. Set it on the server:

```bash
DATABASE_URL=postgresql://postgres.PROJECT:PASSWORD@aws-0-REGION.pooler.supabase.com:6543/postgres
```

Migrations run automatically on boot. Nothing else to do.

> **Use the transaction pooler, not the direct connection.** The client is
> configured with `prepare: false`, which is required for transaction-mode pooling
> — a pooled connection isn't guaranteed to be the same one twice, so prepared
> statements break. `DB_POOL` defaults to 10, which is ample: the game server is the
> only database client, so player count doesn't drive connection count.

### Bringing existing saves across

```bash
cd server && npm run import        # reads data/city.db
```

Idempotent — matches on `device_id` and updates rather than duplicating. Balances
arrive as one opening ledger entry each, so the audit invariant holds immediately
rather than being broken from the start.

---

## Schema

| Table | Purpose |
|---|---|
| `players` | Identity, balance, energy, position |
| `floors` | **One row per player per tower.** Not a JSON blob |
| `signs` | Placed neon signs |
| `ledger` | Append-only record of every currency movement |
| `seasons` / `season_stats` | Weekly windows and per-player totals |
| `leaderboard` | Precomputed rankings, refreshed on a timer |

### Why floors are rows

They used to be a serialised JSON column, which meant ownership couldn't be indexed,
aggregated or ranked — the "most floors" leaderboard was impossible to express in SQL,
and startup read and parsed every player row that had ever existed. As rows it's a
single `GROUP BY`.

### Why a ledger

Balances become a replayable consequence of recorded events rather than a number
somebody mutated:

- Every unit of currency is explainable after the fact.
- A replayed request carrying the same `ref` pays nothing (idempotency).
- When $BLOCK eventually settles on-chain, this table is already the batch source.

`Ledger.post()` is deliberately the only way to change a balance. The game services
(`floors.ts`, `shifts.ts`, `signs.ts`) return what is *owed* and no longer touch
balances themselves, so the in-memory value and the record cannot drift.

---

## Write path

```
action → post() applies balance in memory + queues entry
       → flusher drains every 5s in ONE transaction
       → players upserted, ledger inserted, floors + season updated
```

Crash exposure is bounded by the flush interval (~5s), and `SIGTERM` drains the queue,
so a graceful deploy loses nothing.

This replaced a synchronous PGlite store that wrote from the game loop and iterated
*every* player once a minute — at 150 players that stalled the simulation.

---

## Leaderboards

Five boards, refreshed every 60s into a snapshot table, so a board with many viewers
costs one aggregate query a minute rather than one per viewer.

| Board | Ranked by |
|---|---|
| `floors` | Total floors owned |
| `wealth` | Current $BLOCK |
| `earned` | Lifetime earnings |
| `runners` | Shards collected **this season** |
| `season_earned` | $BLOCK earned **this season** |

Seasons run Monday–Monday UTC and roll automatically. The top 10 of each board is
pushed into game state, so the in-game panel is live with no extra request.

```
GET /leaderboard?board=floors&limit=25
```

---

## Verifying it

```bash
cd server && npm run test:db
```

22 checks against real PostgreSQL: migrations apply and are idempotent, seasons are
stable within a week, ledger entries write, **balances equal the sum of the ledger**,
replayed refs insert nothing, floors round-trip and aggregate, wallet linking keeps
the original save, and every board ranks correctly.

The integrity check is also live:

```bash
curl localhost:2567/audit
# {"ok":true,"checked":"sum(ledger.amount) == players.block","drifting":0}
```

Any drift means a balance changed without being recorded — the one bug class this
design exists to make impossible. Treat a non-zero `drifting` as a serious defect.

`GET /health` reports the backend in use, pending queued writes, the active season,
and population counts.

---

## Migrations

Ordered, append-only, tracked in `schema_migrations`, each in its own transaction.
Every statement is `IF NOT EXISTS` or `IF EXISTS`, so a redeploy re-runs them safely.

**Never edit a migration that has already run.** `004` was edited during development
after it had applied locally, and the corrected version silently never ran — the fix
had to ship as `005`. That is the whole reason the rule exists.

---

## Scaling notes

Current target: ~1000 registered, 50–150 concurrent, one shared world.

- **Bandwidth is the ceiling, not CPU.** Every client receives deltas for every other
  player. At 150 that's roughly 75 KB/s down per client. Colyseus's `@view()` /
  `StateView` (present in the installed `@colyseus/schema`) filters to nearby players
  and cuts it to about 20 KB/s — worth adding before you exceed ~150.
- **A single shared room lives in one process** and cannot be split across machines.
  Vertical scaling plus interest management carries you to a few hundred concurrent;
  beyond that means sharding the world or instancing streets, both of which change
  what the game is.
- **The oracle doesn't scale with players** — one multicall every 20 seconds
  regardless of population.
- **Do not run more than one replica** until state moves to Redis presence and the
  world is shardable. Two replicas today means two divergent cities.
