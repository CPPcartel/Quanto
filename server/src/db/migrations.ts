import type { Db } from "./db.js";

/**
 * Schema migrations.
 *
 * Ordered, append-only, and each one idempotent. A redeploy re-runs this and
 * must never destroy player data — so every statement is CREATE IF NOT EXISTS
 * or ADD COLUMN IF NOT EXISTS. To change the schema, add a new migration; never
 * edit an existing one, because it has already run on the production database.
 */

interface Migration {
  id: string;
  sql: string;
}

const MIGRATIONS: Migration[] = [
  {
    id: "001_core",
    sql: `
      CREATE TABLE IF NOT EXISTS players (
        id              bigserial PRIMARY KEY,
        device_id       text UNIQUE NOT NULL,
        wallet          text UNIQUE,
        name            text NOT NULL DEFAULT '',
        color           text NOT NULL DEFAULT '#4F4DC4',
        block           numeric(20,4) NOT NULL DEFAULT 0,
        charge          numeric(10,4) NOT NULL DEFAULT 100,
        shards          integer NOT NULL DEFAULT 0,
        lifetime_earned numeric(20,4) NOT NULL DEFAULT 0,
        x               real NOT NULL DEFAULT 0,
        z               real NOT NULL DEFAULT 0,
        created_at      timestamptz NOT NULL DEFAULT now(),
        last_seen_at    timestamptz NOT NULL DEFAULT now()
      );

      CREATE INDEX IF NOT EXISTS idx_players_wallet ON players(wallet) WHERE wallet IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_players_block ON players(block DESC);

      /*
        Floors as rows, not a JSON blob. This is the change that makes
        leaderboards, per-tower occupancy and ownership audits expressible in
        SQL at all — the previous serialised column could not be indexed,
        aggregated or ranked.
      */
      CREATE TABLE IF NOT EXISTS floors (
        player_id  bigint NOT NULL REFERENCES players(id) ON DELETE CASCADE,
        symbol     text   NOT NULL,
        count      integer NOT NULL DEFAULT 0 CHECK (count >= 0),
        PRIMARY KEY (player_id, symbol)
      );

      CREATE INDEX IF NOT EXISTS idx_floors_symbol ON floors(symbol);

      CREATE TABLE IF NOT EXISTS signs (
        id         text PRIMARY KEY,
        player_id  bigint NOT NULL REFERENCES players(id) ON DELETE CASCADE,
        symbol     text NOT NULL,
        text       text NOT NULL,
        color      text NOT NULL,
        floor      integer NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE INDEX IF NOT EXISTS idx_signs_symbol ON signs(symbol);
    `,
  },

  {
    id: "002_ledger",
    sql: `
      /*
        Append-only record of every movement of currency.

        Balances become a replayable consequence of recorded events rather than
        a number somebody mutated: each unit is explainable after the fact, a
        replayed request carrying the same ref pays nothing, and when $BLOCK
        eventually settles on-chain this table is already the batch source.
      */
      CREATE TABLE IF NOT EXISTS ledger (
        id            bigserial PRIMARY KEY,
        player_id     bigint NOT NULL REFERENCES players(id) ON DELETE CASCADE,
        kind          text NOT NULL,
        amount        numeric(20,4) NOT NULL,
        balance_after numeric(20,4) NOT NULL,
        ref           text UNIQUE,
        meta          jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at    timestamptz NOT NULL DEFAULT now()
      );

      CREATE INDEX IF NOT EXISTS idx_ledger_player ON ledger(player_id, id DESC);
      CREATE INDEX IF NOT EXISTS idx_ledger_created ON ledger(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_ledger_kind ON ledger(kind);
    `,
  },

  {
    id: "003_seasons",
    sql: `
      CREATE TABLE IF NOT EXISTS seasons (
        id        bigserial PRIMARY KEY,
        label     text NOT NULL,
        starts_at timestamptz NOT NULL,
        ends_at   timestamptz NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_seasons_window ON seasons(starts_at, ends_at);

      CREATE TABLE IF NOT EXISTS season_stats (
        season_id        bigint NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
        player_id        bigint NOT NULL REFERENCES players(id) ON DELETE CASCADE,
        shards_collected integer NOT NULL DEFAULT 0,
        block_earned     numeric(20,4) NOT NULL DEFAULT 0,
        floors_bought    integer NOT NULL DEFAULT 0,
        PRIMARY KEY (season_id, player_id)
      );

      CREATE INDEX IF NOT EXISTS idx_season_shards
        ON season_stats(season_id, shards_collected DESC);
      CREATE INDEX IF NOT EXISTS idx_season_earned
        ON season_stats(season_id, block_earned DESC);
    `,
  },

  {
    id: "004_leaderboards",
    sql: `
      /*
        Precomputed rankings. Refreshed on a timer rather than per request, so
        a busy board costs one aggregate query a minute instead of one per
        viewer.
      */
      CREATE TABLE IF NOT EXISTS leaderboard (
        board       text NOT NULL,
        season_id   bigint REFERENCES seasons(id) ON DELETE CASCADE,
        rank        integer NOT NULL,
        player_id   bigint NOT NULL REFERENCES players(id) ON DELETE CASCADE,
        name        text NOT NULL,
        wallet      text,
        score       numeric(20,4) NOT NULL,
        detail      text NOT NULL DEFAULT '',
        computed_at timestamptz NOT NULL DEFAULT now()
      );

      /*
        All-time boards carry a NULL season_id, and Postgres forbids NULL in a
        primary key — so uniqueness is enforced by an expression index that
        folds NULL to 0 instead.
      */
      CREATE UNIQUE INDEX IF NOT EXISTS idx_leaderboard_unique
        ON leaderboard(board, COALESCE(season_id, 0), rank);

      CREATE INDEX IF NOT EXISTS idx_leaderboard_lookup ON leaderboard(board, season_id, rank);
    `,
  },

  {
    id: "005_leaderboard_nullable_season",
    sql: `
      /*
        Repairs databases created by the first version of 004, which made
        (board, season_id, rank) the primary key. Postgres implicitly marks
        primary key columns NOT NULL, so all-time boards — which carry a NULL
        season_id — could not be written at all.

        This is why an applied migration must never be edited in place: the
        corrected 004 only helps a database that has never seen the original.
        Everything else needs a forward fix, which is this.
      */
      ALTER TABLE leaderboard DROP CONSTRAINT IF EXISTS leaderboard_pkey;
      ALTER TABLE leaderboard ALTER COLUMN season_id DROP NOT NULL;

      CREATE UNIQUE INDEX IF NOT EXISTS idx_leaderboard_unique
        ON leaderboard(board, COALESCE(season_id, 0), rank);
    `,
  },

  {
    id: "006_privy_identity",
    sql: `
      /*
        Privy becomes the account system.

        A Privy DID is the durable identity — it survives browsers, devices and
        wallet changes, which device_id never could. device_id stays as the
        guest identity so people can still play without an account, and logging
        in attaches the DID to whichever row they were already using.

        Wallets are recorded separately: a Privy user may have an embedded
        wallet created for them plus external ones they linked, and we want the
        embedded address without a round trip to Privy's API on every join.
      */
      ALTER TABLE players ADD COLUMN IF NOT EXISTS privy_did      text;
      ALTER TABLE players ADD COLUMN IF NOT EXISTS email          text;
      ALTER TABLE players ADD COLUMN IF NOT EXISTS embedded_wallet text;
      ALTER TABLE players ADD COLUMN IF NOT EXISTS login_method   text;
      ALTER TABLE players ADD COLUMN IF NOT EXISTS is_guest       boolean NOT NULL DEFAULT true;

      CREATE UNIQUE INDEX IF NOT EXISTS idx_players_privy
        ON players(privy_did) WHERE privy_did IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_players_email
        ON players(email) WHERE email IS NOT NULL;

      /*
        Login audit. Useful for support ("which account is this?") and for
        answering how many real accounts exist versus guest sessions, which is
        the only honest way to read the player numbers.
      */
      CREATE TABLE IF NOT EXISTS logins (
        id         bigserial PRIMARY KEY,
        player_id  bigint NOT NULL REFERENCES players(id) ON DELETE CASCADE,
        privy_did  text NOT NULL,
        method     text,
        at         timestamptz NOT NULL DEFAULT now()
      );

      CREATE INDEX IF NOT EXISTS idx_logins_player ON logins(player_id, at DESC);
    `,
  },

  {
    id: "007_social",
    sql: `
      /*
        Crews pool holdings for tower control only — the floors themselves, and
        their yield, stay individually owned. Pooling ownership outright would
        create an exit problem (who gets what when somebody leaves) that nobody
        wants to arbitrate.
      */
      CREATE TABLE IF NOT EXISTS crews (
        id         bigserial PRIMARY KEY,
        name       text NOT NULL,
        tag        text NOT NULL UNIQUE,
        color      text NOT NULL DEFAULT '#22e8ff',
        leader_id  bigint NOT NULL REFERENCES players(id) ON DELETE CASCADE,
        created_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS crew_members (
        crew_id   bigint NOT NULL REFERENCES crews(id) ON DELETE CASCADE,
        player_id bigint NOT NULL REFERENCES players(id) ON DELETE CASCADE,
        role      text NOT NULL DEFAULT 'member',
        joined_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (player_id)
      );
      CREATE INDEX IF NOT EXISTS idx_crew_members_crew ON crew_members(crew_id);

      /*
        Player-to-player floor sales. sold_at being null is what makes a
        listing active; rows are kept after sale as trade history.
      */
      CREATE TABLE IF NOT EXISTS listings (
        id         bigserial PRIMARY KEY,
        seller_id  bigint NOT NULL REFERENCES players(id) ON DELETE CASCADE,
        symbol     text NOT NULL,
        price      numeric(20,4) NOT NULL CHECK (price > 0),
        created_at timestamptz NOT NULL DEFAULT now(),
        buyer_id   bigint REFERENCES players(id) ON DELETE SET NULL,
        sold_at    timestamptz
      );
      CREATE INDEX IF NOT EXISTS idx_listings_active
        ON listings(symbol, price) WHERE sold_at IS NULL;
      CREATE INDEX IF NOT EXISTS idx_listings_seller ON listings(seller_id);

      /* You cannot moderate what you did not record. */
      CREATE TABLE IF NOT EXISTS chat_log (
        id        bigserial PRIMARY KEY,
        device_id text NOT NULL,
        name      text NOT NULL,
        channel   text NOT NULL,
        text      text NOT NULL,
        x         real NOT NULL DEFAULT 0,
        z         real NOT NULL DEFAULT 0,
        at        timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_chat_at ON chat_log(at DESC);
      CREATE INDEX IF NOT EXISTS idx_chat_device ON chat_log(device_id, at DESC);

      /* The landlord query runs every 30 seconds against this. */
      CREATE INDEX IF NOT EXISTS idx_floors_symbol_count ON floors(symbol, count DESC);
    `,
  },

  {
    id: "008_nft",
    sql: `
      /*
        Snapshot of the Quanto Residents collection.

        The contract is deployed by OpenSea Studio, so we do not own it and
        cannot extend it. Ownership is read live from chain; what a token *is*
        lives in metadata, which is immutable once revealed — so it is copied
        here once and read locally forever after. Putting an HTTP fetch from a
        gateway we do not control into the join path would make a slow IPFS
        node look like a login outage.

        token_id is text, not bigint: ERC-721 ids are uint256 and a large one
        does not survive a round trip through a JS number.
      */
      CREATE TABLE IF NOT EXISTS nft_tokens (
        token_id   text PRIMARY KEY,
        tier       text NOT NULL DEFAULT 'resident',
        /* Six base36 digits; see config/traits.ts. */
        traits     text NOT NULL DEFAULT '000010',
        /* Penthouse only: the ticker whose top floor this token holds. */
        tower      text,
        fetched_at timestamptz NOT NULL DEFAULT now()
      );

      /* Resolving "who is the landlord" consults the penthouses by tower. */
      CREATE INDEX IF NOT EXISTS idx_nft_tower ON nft_tokens(tower) WHERE tower IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_nft_tier ON nft_tokens(tier);

      /*
        Chartered crews are founded by a Landlord-tier holder and may grow to 50
        rather than 20. The flag lives on the crew, not on the founder: selling
        the token must not evict members from a crew that already exists.
      */
      ALTER TABLE crews ADD COLUMN IF NOT EXISTS chartered boolean NOT NULL DEFAULT false;

      /*
        The penthouse a player holds, cached from chain.

        Tower control is resolved from this database every 30 seconds, but NFT
        ownership lives on-chain — so the resolved token is written here when the
        player connects and their wallet is proved.

        penthouse_at is what stops a seller keeping control forever. Territory
        only counts a penthouse verified recently, so somebody who sells the token
        and never logs in again loses the weight within a day rather than holding
        a tower indefinitely.

        (No backticks in this comment: the whole migration is a template literal,
        so a backtick here would close the string mid-SQL.)
      */
      ALTER TABLE players ADD COLUMN IF NOT EXISTS penthouse    text;
      ALTER TABLE players ADD COLUMN IF NOT EXISTS penthouse_at timestamptz;
      ALTER TABLE players ADD COLUMN IF NOT EXISTS nft_tier     text NOT NULL DEFAULT 'none';

      CREATE INDEX IF NOT EXISTS idx_players_penthouse
        ON players(penthouse) WHERE penthouse IS NOT NULL;
    `,
  },

  {
    id: "009_messaging",
    sql: `
      /*
        Which crew a message belonged to.

        Every crew message was already being logged, but without this column the
        table could not answer "what did MY crew say?" — the data was on disk and
        unqueryable. Crew history is the one channel people expect scrollback
        from, because it is about who you are with rather than where you stand.
      */
      ALTER TABLE chat_log ADD COLUMN IF NOT EXISTS crew_tag text;
      CREATE INDEX IF NOT EXISTS idx_chat_crew
        ON chat_log(crew_tag, at DESC) WHERE crew_tag IS NOT NULL;

      /*
        Direct messages.

        These need storage in a way proximity chat does not: a DM to somebody who
        is offline has to still be there when they return, or it is not a DM.

        Addressed by device id, which the SERVER resolves. Device ids are never
        sent to clients — a device id is the guest identity, so leaking one would
        let anyone join as that player.
      */
      CREATE TABLE IF NOT EXISTS direct_messages (
        id          bigserial PRIMARY KEY,
        from_device text NOT NULL,
        to_device   text NOT NULL,
        from_name   text NOT NULL,
        text        text NOT NULL,
        at          timestamptz NOT NULL DEFAULT now(),
        read_at     timestamptz
      );

      CREATE INDEX IF NOT EXISTS idx_dm_inbox ON direct_messages(to_device, at DESC);
      CREATE INDEX IF NOT EXISTS idx_dm_thread
        ON direct_messages(to_device, from_device, at DESC);
      CREATE INDEX IF NOT EXISTS idx_dm_unread
        ON direct_messages(to_device) WHERE read_at IS NULL;

      /*
        Blocks.

        Built now rather than added after the first incident. Proximity chat is
        self-limiting because the sender has to be present; a DM reaches anyone,
        which is how harassment arrives. Enforced server-side on send, so a
        blocked message is never written and never delivered.
      */
      CREATE TABLE IF NOT EXISTS blocks (
        device_id      text NOT NULL,
        blocked_device text NOT NULL,
        at             timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (device_id, blocked_device)
      );
    `,
  },
  {
    id: "010_wallets",
    sql: `
      /*
        Linked wallets, one row per address.

        Holdings and identity are different questions with different lifetimes,
        and they were sharing a single players.wallet column. Identity is the
        Privy account: durable, survives devices, decides which save loads.
        Holdings are "which addresses actually hold the tokens" — a set that
        changes as people connect and disconnect wallets, and that says nothing
        about who somebody is.

        Conflating them produced a silent bug. An embedded wallet Privy created
        on login was preferred over a signature-verified address and rewritten on
        every login, so a paying holder kept their tier for one session and lost
        it on the next.

        address is the PRIMARY KEY, not (player_id, address). That is the whole
        uniqueness rule: one wallet belongs to one account. Without it two
        accounts could each prove the same wallet and both claim the penthouse it
        holds. Privy enforced this for wallets it linked; nothing enforces it for
        wallets we verify ourselves, so the database has to.
      */
      CREATE TABLE IF NOT EXISTS player_wallets (
        address   text   PRIMARY KEY,
        player_id bigint NOT NULL REFERENCES players(id) ON DELETE CASCADE,
        linked_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE INDEX IF NOT EXISTS idx_player_wallets_player ON player_wallets(player_id);

      /*
        Carry across whatever players.wallet already held.

        DISTINCT ON keeps the lowest player id when the same address sits on two
        rows — exactly the duplicate the new primary key forbids, and exactly the
        kind of row that could have been written before it existed.

        Embedded wallets are deliberately not filtered out. An address already on
        the row is one this player is associated with, and reading an empty
        wallet's holdings simply returns nothing. Guessing which historical
        addresses were embedded would be less accurate than asking the chain.
      */
      INSERT INTO player_wallets (address, player_id)
      SELECT DISTINCT ON (wallet) wallet, id
        FROM players
       WHERE wallet IS NOT NULL AND wallet <> ''
       ORDER BY wallet, id
      ON CONFLICT (address) DO NOTHING;
    `,
  },

  {
    id: "011_season_results",
    sql: `
      /*
        Final standings, frozen at the season boundary.

        The live leaderboard table is a rolling snapshot: it is deleted and
        rewritten every refresh, so it answers "who is winning" and cannot
        answer "who won". Those are different questions, and only the second one
        can decide a prize.

        The distinction was harmless while nothing rode on it. It stops being
        harmless the moment a season result is worth money, because the rolling
        snapshot is only ever as fresh as the last refresh — a player who takes
        the lead in the final seconds of a season would be ranked by whatever
        the board happened to hold up to a minute earlier.

        Rows here are written once, at the boundary, and never updated. The
        primary key is the guard: a restart mid-roll retries the insert and the
        conflict is ignored, so a frozen result cannot be silently rewritten by
        a later run.
      */
      CREATE TABLE IF NOT EXISTS season_results (
        season_id bigint NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
        board     text   NOT NULL,
        rank      integer NOT NULL,
        player_id bigint REFERENCES players(id) ON DELETE SET NULL,
        name      text   NOT NULL,
        wallet    text,
        score     numeric(20,4) NOT NULL,
        detail    text   NOT NULL DEFAULT '',
        frozen_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (season_id, board, rank)
      );

      CREATE INDEX IF NOT EXISTS idx_season_results_board
        ON season_results(season_id, board, rank);

      /*
        player_id is ON DELETE SET NULL rather than CASCADE, unlike every other
        table referencing players. A result is a historical fact about a
        competition that already happened; deleting an account should not
        rewrite the standings of a season it took part in, and the name is
        already denormalised here precisely so the row survives.
      */

      /*
        When the season actually closed. NULL means still open.

        Distinct from ends_at, which is when it was *scheduled* to close. If the
        server is down over a boundary the two differ, and a prize dispute is
        exactly the moment somebody needs to know which one applied.
      */
      ALTER TABLE seasons ADD COLUMN IF NOT EXISTS closed_at timestamptz;
    `,
  },

  {
    id: "012_season_payouts",
    sql: `
      /*
        Payment, recorded against the result it paid.

        A prize competition has two halves that must both be auditable: who won,
        and whether they were actually paid. Frozen standings answer the first.
        Without these columns the second lives in somebody's inbox, which is
        where double payments come from — a winner asks again, nobody can prove
        it was already settled, and the safe-looking answer is to pay.

        paid_at is the guard rather than a bookkeeping nicety. The route that
        records a payout only writes where paid_at IS NULL, so marking a result
        paid is idempotent and a second attempt reports the existing transaction
        instead of overwriting it.

        payout_tx is public on purpose. The chain already shows the transfer;
        publishing which result it settled is what lets anyone check the prize
        was paid to the player the frozen standings named.
      */
      ALTER TABLE season_results ADD COLUMN IF NOT EXISTS paid_at   timestamptz;
      ALTER TABLE season_results ADD COLUMN IF NOT EXISTS payout_tx text;
      ALTER TABLE season_results ADD COLUMN IF NOT EXISTS payout_to text;
      ALTER TABLE season_results ADD COLUMN IF NOT EXISTS payout_note text;

      CREATE INDEX IF NOT EXISTS idx_season_results_unpaid
        ON season_results(season_id, board) WHERE paid_at IS NULL;
    `,
  },

  {
    id: "013_profiles",
    sql: `
      /*
        Usernames, and the appearance a player chose.

        "name" was a display string with no constraints: two players could hold
        the same one, and nothing recorded whether a player had ever picked it or
        was still carrying the Trader#### the server invented. Neither mattered
        while a name was decoration. Both matter once a name identifies somebody
        on a leaderboard that pays out.

        name_claimed separates "chose this" from "was given this", which is what
        the claim screen keys off. Existing players are treated as unclaimed:
        their current name was assigned by the server or taken from an email
        address, and they should get the same chance to pick one as anybody new.

        name_set_at drives the rename cooldown.

        avatar_traits is nullable, and null means "use the NFT, or the default".
        A holder who customises and later wants their token's look back sets it
        back to null rather than trying to remember six indices.
      */
      ALTER TABLE players ADD COLUMN IF NOT EXISTS name_claimed  boolean NOT NULL DEFAULT false;
      ALTER TABLE players ADD COLUMN IF NOT EXISTS name_set_at   timestamptz;
      ALTER TABLE players ADD COLUMN IF NOT EXISTS avatar_traits text;

      /*
        Deduplicate before adding the constraint, or the migration fails on any
        database that has ever been played on.

        Collisions are near-certain: Trader#### is four random digits, and every
        email-derived name is the part before the @. The lowest player id keeps
        the bare name because it was there first; everyone else gets their id
        appended, which is ugly and unique and which they can change on their
        next login anyway.
      */
      UPDATE players p
         SET name = p.name || '_' || p.id
       WHERE EXISTS (
         SELECT 1 FROM players q
          WHERE lower(q.name) = lower(p.name) AND q.id < p.id
       );

      /*
        Case-insensitive, because "Alice" and "alice" being different accounts is
        an impersonation vector rather than a feature. A functional index is the
        only way to say that in Postgres.
      */
      CREATE UNIQUE INDEX IF NOT EXISTS idx_players_username
        ON players (lower(name));
    `,
  },

];

/**
 * Every migration id, in order.
 *
 * Exported so tests can assert "all of them ran" rather than hardcoding a count
 * that goes stale the moment a migration is added — which is exactly what
 * happened: adding 008 failed the suite for a schema change that was entirely
 * correct.
 */
export const MIGRATION_IDS: readonly string[] = MIGRATIONS.map((m) => m.id);

/**
 * Apply any migrations this database hasn't seen. Safe to call on every boot.
 */
export async function migrate(db: Db): Promise<string[]> {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id         text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    );
  `);

  const done = await db.query<{ id: string }>("SELECT id FROM schema_migrations");
  const applied = new Set(done.map((r) => r.id));
  const ran: string[] = [];

  for (const migration of MIGRATIONS) {
    if (applied.has(migration.id)) continue;

    // Each migration is its own transaction: a failure leaves the database at
    // the last good version rather than half-migrated.
    await db.begin(async (tx) => {
      await tx.exec(migration.sql);
      await tx.query("INSERT INTO schema_migrations (id) VALUES ($1)", [migration.id]);
    });

    ran.push(migration.id);
  }

  return ran;
}

/**
 * Ensure a season row covers `now`, creating one if the previous has ended.
 * Seasons run Monday to Monday in UTC.
 */
export async function ensureSeason(db: Db): Promise<{ id: number; label: string }> {
  const existing = await db.query<{ id: number; label: string }>(
    "SELECT id, label FROM seasons WHERE starts_at <= now() AND ends_at > now() ORDER BY id DESC LIMIT 1"
  );
  if (existing[0]) return existing[0];

  const now = new Date();
  const start = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  );
  // Rewind to Monday (getUTCDay: 0 = Sunday).
  const dow = (start.getUTCDay() + 6) % 7;
  start.setUTCDate(start.getUTCDate() - dow);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 7);

  const label = `Week of ${start.toISOString().slice(0, 10)}`;
  const created = await db.query<{ id: number; label: string }>(
    "INSERT INTO seasons (label, starts_at, ends_at) VALUES ($1, $2, $3) RETURNING id, label",
    [label, start.toISOString(), end.toISOString()]
  );

  return created[0];
}
