import type { Db } from "../db/db.js";
import { ensureSeason } from "../db/migrations.js";

/**
 * Leaderboards.
 *
 * Rankings are precomputed into a snapshot table on a timer rather than
 * calculated per request: a board with a thousand viewers then costs one
 * aggregate query a minute instead of a thousand. The snapshot is also what
 * the in-game panel reads, so opening it is free.
 */

export type BoardId = "floors" | "wealth" | "earned" | "runners" | "season_earned" | "crews";

export interface BoardRow {
  rank: number;
  name: string;
  wallet: string | null;
  score: number;
  detail: string;
}

export const BOARDS: Array<{ id: BoardId; label: string; seasonal: boolean; unit: string }> = [
  { id: "floors", label: "Most floors", seasonal: false, unit: "floors" },
  { id: "wealth", label: "Richest", seasonal: false, unit: "$BLOCK" },
  { id: "earned", label: "Most earned", seasonal: false, unit: "$BLOCK" },
  { id: "runners", label: "Storm runners", seasonal: true, unit: "shards" },
  { id: "season_earned", label: "This week", seasonal: true, unit: "$BLOCK" },
  { id: "crews", label: "Crews", seasonal: false, unit: "floors" },
];

const TOP_N = 100;

/**
 * The queries behind each board.
 *
 * `floors` is the headline ranking and only works because floors are stored as
 * rows — the previous JSON column could not be summed in SQL at all.
 */
const QUERIES: Record<BoardId, string> = {
  floors: `
    SELECT p.id, p.name, p.wallet,
           COALESCE(SUM(f.count), 0)::float8 AS score,
           COUNT(DISTINCT f.symbol)::int     AS towers
    FROM players p
    JOIN floors f ON f.player_id = p.id
    GROUP BY p.id, p.name, p.wallet
    HAVING COALESCE(SUM(f.count), 0) > 0
    ORDER BY score DESC, p.id ASC
    LIMIT $1
  `,

  wealth: `
    SELECT p.id, p.name, p.wallet, p.block::float8 AS score, 0 AS towers
    FROM players p
    WHERE p.block > 0
    ORDER BY score DESC, p.id ASC
    LIMIT $1
  `,

  earned: `
    SELECT p.id, p.name, p.wallet, p.lifetime_earned::float8 AS score, 0 AS towers
    FROM players p
    WHERE p.lifetime_earned > 0
    ORDER BY score DESC, p.id ASC
    LIMIT $1
  `,

  runners: `
    SELECT p.id, p.name, p.wallet, s.shards_collected::float8 AS score, 0 AS towers
    FROM season_stats s
    JOIN players p ON p.id = s.player_id
    WHERE s.season_id = $2 AND s.shards_collected > 0
    ORDER BY score DESC, p.id ASC
    LIMIT $1
  `,

  season_earned: `
    SELECT p.id, p.name, p.wallet, s.block_earned::float8 AS score, s.floors_bought::int AS towers
    FROM season_stats s
    JOIN players p ON p.id = s.player_id
    WHERE s.season_id = $2 AND s.block_earned > 0
    ORDER BY score DESC, p.id ASC
    LIMIT $1
  `,

  /**
   * Crews ranked by pooled holdings — the same total that decides tower control.
   *
   * `id` is the leader's player id rather than the crew's: the snapshot table's
   * player_id is NOT NULL and references players(id), so a crew id there would
   * violate the foreign key. The leader is the meaningful player to point at.
   */
  crews: `
    SELECT c.leader_id AS id,
           '[' || c.tag || '] ' || c.name AS name,
           c.color                        AS wallet,
           COALESCE(SUM(f.count), 0)::float8      AS score,
           COUNT(DISTINCT m.player_id)::int       AS towers
    FROM crews c
    JOIN crew_members m ON m.crew_id = c.id
    LEFT JOIN floors f  ON f.player_id = m.player_id
    GROUP BY c.id, c.leader_id, c.tag, c.name, c.color
    ORDER BY score DESC, c.id ASC
    LIMIT $1
  `,
};

/**
 * Turn query rows into ranked board rows.
 *
 * Shared by the live refresh and the season freeze on purpose. These two must
 * agree exactly: if the frozen standings were ranked or labelled even slightly
 * differently from the board people watched all week, the results would
 * contradict the thing everyone had been looking at.
 */
function rank(board: BoardId, rows: RawRow[]): BoardRow[] {
  return rows.map((r, i) => ({
    rank: i + 1,
    name: r.name || "Trader",
    wallet: r.wallet,
    score: Number(r.score),
    detail:
      board === "floors"
        ? `${r.towers} tower${r.towers === 1 ? "" : "s"}`
        : board === "season_earned"
          ? `${r.towers} floor${r.towers === 1 ? "" : "s"} bought`
          : board === "crews"
            ? `${r.towers} member${r.towers === 1 ? "" : "s"}`
            : "",
  }));
}

interface RawRow {
  id: string | number;
  name: string;
  wallet: string | null;
  score: number;
  towers: number;
}

export class Leaderboards {
  private cache = new Map<BoardId, BoardRow[]>();
  private timer?: NodeJS.Timeout;
  private seasonId = 0;
  private seasonLabel = "";
  private refreshing = false;

  constructor(private db: Db) {}

  async start(intervalMs = 60_000) {
    await this.rollSeason();
    await this.refresh();
    this.timer = setInterval(() => {
      this.refresh().catch((err) =>
        console.error("[leaderboards] refresh failed:", err?.message ?? err)
      );
    }, intervalMs);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
  }

  get currentSeason() {
    return { id: this.seasonId, label: this.seasonLabel };
  }

  /** Cached rows for a board. Top slice only; the full list is `all()`. */
  top(board: BoardId, limit = 10): BoardRow[] {
    return (this.cache.get(board) ?? []).slice(0, limit);
  }

  all(board: BoardId): BoardRow[] {
    return this.cache.get(board) ?? [];
  }

  /**
   * Open a new season if the current one has ended, freezing the old one first.
   *
   * The order is the whole point. This used to adopt the new season and then let
   * the caller recompute the boards, which meant the outgoing season's final
   * standings were never computed at all — the most recent rolling snapshot,
   * taken up to a refresh interval earlier, was as close as anyone got. A player
   * who took the lead in the last thirty seconds of a season simply did not
   * appear to have won it.
   *
   * That was survivable while the standings were bragging rights. It is not
   * survivable once they decide a prize, so the freeze happens here rather than
   * in `refresh`: any caller that rolls a season gets correct results, whether
   * or not it remembers to ask for them.
   */
  async rollSeason() {
    const season = await ensureSeason(this.db);
    const nextId = Number(season.id);
    const previousId = this.seasonId;

    // previousId 0 is a cold start, not a rollover: there is no outgoing season
    // to freeze, and the one we are adopting may have been running for days.
    if (previousId !== 0 && nextId !== previousId) {
      await this.freezeSeason(previousId).catch((err) =>
        // Deliberately non-fatal. Failing to freeze must not wedge the season
        // roll and take the live boards down with it; the results are
        // recoverable from season_stats, the running game is not.
        console.error("[leaderboards] freeze failed:", (err as Error)?.message ?? err)
      );
    }

    this.seasonId = nextId;
    this.seasonLabel = season.label;
    if (nextId !== previousId) {
      console.log(`[leaderboards] season: ${this.seasonLabel} (#${this.seasonId})`);
    }
    return this.seasonId;
  }

  /**
   * Write the closing standings for a season, once and permanently.
   *
   * Computed against the outgoing season id, so it reflects every point earned
   * right up to the boundary rather than up to the last refresh.
   *
   * Inserts ignore conflicts. A crash between writing the rows and stamping
   * `closed_at` leaves the next boot retrying, and the retry must not be able
   * to rewrite a result somebody has already been paid on.
   */
  private async freezeSeason(seasonId: number) {
    for (const board of BOARDS) {
      if (!board.seasonal) continue;

      const rows = await this.db.query<RawRow>(QUERIES[board.id], [TOP_N, seasonId]);
      const ranked = rank(board.id, rows);

      for (let i = 0; i < ranked.length; i++) {
        const row = ranked[i];
        await this.db.query(
          `INSERT INTO season_results
             (season_id, board, rank, player_id, name, wallet, score, detail)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
           ON CONFLICT (season_id, board, rank) DO NOTHING`,
          [
            seasonId,
            board.id,
            row.rank,
            Number(rows[i].id),
            row.name,
            row.wallet,
            row.score,
            row.detail,
          ]
        );
      }
    }

    // Only stamped once, for the same reason the rows are only inserted once.
    await this.db.query(
      "UPDATE seasons SET closed_at = now() WHERE id = $1 AND closed_at IS NULL",
      [seasonId]
    );

    console.log(`[leaderboards] froze final standings for season #${seasonId}`);
  }

  /** The frozen standings for a closed season. Empty while a season is open. */
  async resultsFor(seasonId: number, board?: BoardId) {
    const rows = await this.db.query<{
      board: string;
      rank: number;
      name: string;
      wallet: string | null;
      score: number;
      detail: string;
      frozen_at: string;
    }>(
      board
        ? `SELECT board, rank, name, wallet, score::float8 AS score, detail, frozen_at
             FROM season_results WHERE season_id = $1 AND board = $2 ORDER BY rank`
        : `SELECT board, rank, name, wallet, score::float8 AS score, detail, frozen_at
             FROM season_results WHERE season_id = $1 ORDER BY board, rank`,
      board ? [seasonId, board] : [seasonId]
    );

    /**
     * player_id is deliberately not selected. Nothing identifying beyond the
     * display name and the wallet the player already chose to show may leave
     * the server on a public route.
     */
    return rows.map((r) => ({
      board: r.board,
      rank: Number(r.rank),
      name: r.name,
      wallet: r.wallet,
      score: Number(r.score),
      detail: r.detail,
      frozenAt: r.frozen_at,
    }));
  }

  async refresh() {
    if (this.refreshing) return;
    this.refreshing = true;

    try {
      await this.rollSeason();

      for (const board of BOARDS) {
        const params: unknown[] = board.seasonal ? [TOP_N, this.seasonId] : [TOP_N];
        const rows = await this.db.query<RawRow>(QUERIES[board.id], params);

        const ranked = rank(board.id, rows);

        this.cache.set(board.id, ranked);
        await this.persist(board.id, board.seasonal ? this.seasonId : null, rows, ranked);
      }
    } finally {
      this.refreshing = false;
    }
  }

  /** Write the snapshot so a restart serves a warm board immediately. */
  private async persist(
    board: BoardId,
    seasonId: number | null,
    raw: RawRow[],
    ranked: BoardRow[]
  ) {
    await this.db.begin(async (tx) => {
      // Snapshots are replaced wholesale — partial updates would leave stale
      // ranks behind when somebody drops off the board entirely.
      await tx.query(
        seasonId === null
          ? "DELETE FROM leaderboard WHERE board = $1 AND season_id IS NULL"
          : "DELETE FROM leaderboard WHERE board = $1 AND season_id = $2",
        seasonId === null ? [board] : [board, seasonId]
      );

      for (let i = 0; i < ranked.length; i++) {
        const row = ranked[i];
        await tx.query(
          `INSERT INTO leaderboard (board, season_id, rank, player_id, name, wallet, score, detail)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [
            board,
            seasonId,
            row.rank,
            Number(raw[i].id),
            row.name,
            row.wallet,
            row.score,
            row.detail,
          ]
        );
      }
    });
  }
}

/**
 * Integrity check: a player's materialised balance must equal the sum of their
 * ledger. Any drift means a balance was changed without being recorded, which
 * is the one bug class this whole design exists to prevent.
 */
export async function auditBalances(
  db: Db,
  tolerance = 0.01
): Promise<Array<{ deviceId: string; block: number; ledger: number; drift: number }>> {
  const rows = await db.query<{
    device_id: string;
    block: number;
    ledger_sum: number;
  }>(`
    SELECT p.device_id,
           p.block::float8 AS block,
           COALESCE(SUM(l.amount), 0)::float8 AS ledger_sum
    FROM players p
    LEFT JOIN ledger l ON l.player_id = p.id
    GROUP BY p.id, p.device_id, p.block
  `);

  return rows
    .map((r) => ({
      deviceId: r.device_id,
      block: Number(r.block),
      ledger: Number(r.ledger_sum),
      drift: Number(r.block) - Number(r.ledger_sum),
    }))
    .filter((r) => Math.abs(r.drift) > tolerance);
}
