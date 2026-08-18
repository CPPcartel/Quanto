/**
 * Database access.
 *
 * One SQL dialect everywhere. Queries are plain parameterised Postgres strings
 * ($1, $2 …) behind a tiny interface, so the same statements run against
 * Supabase in production and against PGlite — real PostgreSQL compiled to
 * WASM — locally. That means no Docker for development, and no chance of the
 * two environments diverging because they speak different SQL.
 *
 * Deliberately not an ORM: the schema is small, the queries are the
 * interesting part, and aggregation for leaderboards is far clearer written
 * out than assembled by a query builder.
 */

export interface Db {
  /** Run a single parameterised statement and return rows. */
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
  /**
   * Run a script that may contain several statements, with no parameters.
   *
   * Kept separate from `query` on purpose: parameterised queries go through the
   * extended wire protocol, which accepts exactly one statement — passing a
   * multi-statement migration to it fails with "cannot insert multiple commands
   * into a prepared statement".
   */
  exec(text: string): Promise<void>;
  /** Run `fn` inside a transaction; rolls back if it throws. */
  begin<T>(fn: (tx: Db) => Promise<T>): Promise<T>;
  close(): Promise<void>;
  /** Which backend is in use — surfaced on /health. */
  readonly kind: "postgres" | "pglite";
}

// ---------------------------------------------------------------------------
// Supabase / Postgres
// ---------------------------------------------------------------------------

async function createPostgres(url: string): Promise<Db> {
  const { default: postgres } = await import("postgres");

  const sql = postgres(url, {
    // The game server is the only database client, so a small pool is plenty.
    // Supavisor transaction mode does the multiplexing on its side.
    max: Number(process.env.DB_POOL ?? 10),
    idle_timeout: 30,
    connect_timeout: 15,
    // Supabase requires TLS; `prepare: false` is required for transaction-mode
    // pooling, where a connection is not guaranteed to be the same one twice.
    prepare: false,
    onnotice: () => {},
  });

  const wrap = (client: typeof sql): Db => ({
    kind: "postgres",
    async query<T>(text: string, params: unknown[] = []) {
      return (await client.unsafe(text, params as never[])) as unknown as T[];
    },
    async exec(text: string) {
      // No parameters means postgres.js uses the simple protocol, which does
      // accept several statements in one round trip.
      await client.unsafe(text);
    },
    async begin<T>(fn: (tx: Db) => Promise<T>) {
      return (await client.begin(async (tx) => fn(wrap(tx as never)))) as T;
    },
    async close() {
      await client.end({ timeout: 5 });
    },
  });

  return wrap(sql);
}

// ---------------------------------------------------------------------------
// PGlite (local development)
// ---------------------------------------------------------------------------

async function createPglite(dir: string): Promise<Db> {
  const { PGlite } = await import("@electric-sql/pglite");

  let pg: Awaited<ReturnType<typeof PGlite.create>>;
  try {
    pg = await PGlite.create(dir);
  } catch (err) {
    /**
     * PGlite reports a corrupt or locked data directory as a bare WASM
     * `Aborted()` with no indication of the cause, which is impossible to act
     * on. The usual trigger is the process being force-killed while the
     * database was open, leaving a stale postmaster.pid behind.
     *
     * Local development only — Supabase has no equivalent failure.
     */
    const message = (err as Error)?.message ?? String(err);
    if (/abort/i.test(message)) {
      /**
       * Point at the project's own reset script rather than `rm -rf`.
       *
       * That instruction was wrong twice over: `rm -rf` is not a command on
       * Windows, where this is developed, and it bypasses `db:reset` — which
       * refuses to run when DATABASE_URL is set, so it cannot be pointed at a
       * remote database by mistake. Recovery advice that does not run on the
       * reader's machine is not recovery advice.
       */
      throw new Error(
        `Local database at ${dir} could not be opened.\n\n` +
          `  This usually means the server was force-killed while it was open.\n` +
          `  PGlite is strictly single-process and cannot survive that.\n\n` +
          `  Recover with:\n\n` +
          `      npm run db:reset\n\n` +
          `  (That only ever touches the local database — it refuses to run\n` +
          `   when DATABASE_URL is set.)\n\n` +
          `  (Original error: ${message})`
      );
    }
    throw err;
  }

  const wrap = (client: {
    query: (t: string, p?: unknown[]) => Promise<{ rows: unknown[] }>;
    exec?: (t: string) => Promise<unknown>;
    transaction?: (fn: (tx: never) => Promise<unknown>) => Promise<unknown>;
    close?: () => Promise<void>;
  }): Db => ({
    kind: "pglite",
    async query<T>(text: string, params: unknown[] = []) {
      const res = await client.query(text, params);
      return res.rows as T[];
    },
    async exec(text: string) {
      // PGlite's exec() runs a multi-statement script; query() cannot.
      if (client.exec) await client.exec(text);
      else await client.query(text);
    },
    async begin<T>(fn: (tx: Db) => Promise<T>) {
      if (!client.transaction) return fn(wrap(client));
      return (await client.transaction(async (tx) => fn(wrap(tx as never)))) as T;
    },
    async close() {
      await client.close?.();
    },
  });

  return wrap(pg as never);
}

// ---------------------------------------------------------------------------

let instance: Db | null = null;

/**
 * Open the database. Uses DATABASE_URL when present (Supabase in production),
 * otherwise falls back to an on-disk PGlite database so a fresh checkout runs
 * with no configuration at all.
 */
export async function openDb(): Promise<Db> {
  if (instance) return instance;

  const url = process.env.DATABASE_URL;
  if (url) {
    instance = await createPostgres(url);
    console.log("[db] connected to Postgres");
  } else {
    const dir = process.env.DATA_DIR ?? "./data";
    // PGlite creates its own leaf directory but not the parents, so a custom
    // DATA_DIR that doesn't exist yet fails with a bare ENOENT stack trace.
    // Anyone setting DATA_DIR is doing so precisely because the path is new.
    const { mkdir } = await import("node:fs/promises");
    await mkdir(dir, { recursive: true });
    instance = await createPglite(`${dir}/pg`);
    console.log(`[db] no DATABASE_URL — using local PGlite at ${dir}/pg`);
  }

  return instance;
}

export async function closeDb() {
  if (!instance) return;
  await instance.close();
  instance = null;
}

/** Test helper: an isolated in-memory database, discarded when closed. */
export async function openMemoryDb(): Promise<Db> {
  return createPglite("memory://");
}
