import type { Db } from "../db/db.js";
import { sanitise } from "./chat.js";

/**
 * Crews.
 *
 * Holdings pool for tower control only — the floors themselves, and their
 * yield, stay individually owned. Pooling ownership outright would create an
 * exit problem (who gets which floors when somebody leaves) that nobody wants
 * to arbitrate, and it would make joining a crew a financial decision rather
 * than a social one.
 *
 * A player belongs to at most one crew; the primary key on crew_members is
 * what enforces that, rather than a check that could race.
 */

export interface CrewInfo {
  id: number;
  name: string;
  tag: string;
  color: string;
  leaderDevice: string;
  members: number;
  /** Total floors held by everyone in the crew, across all towers. */
  floors: number;
  /** Founded by a Landlord-tier holder: member cap 50 rather than 20. */
  chartered: boolean;
}

export type CrewResult =
  | { ok: true; crew: CrewInfo }
  | { ok: false; reason: string };

export const CREW_COLORS = ["#22e8ff", "#ff2d95", "#ffb347", "#3bff8f", "#a855f7", "#ff6b6b"];

const TAG_PATTERN = /^[A-Z0-9]{2,5}$/;

/**
 * Members an ordinary crew may hold.
 *
 * A chartered crew — one founded by a Landlord-tier NFT holder — raises this.
 * The cap is checked at join time against the crew's own charter flag, so a
 * founder who sells their token does not retroactively evict anybody: the crew
 * keeps the size it was chartered at, it simply cannot be founded again.
 */
const MAX_MEMBERS = 20;
export const MAX_MEMBERS_CHARTERED = 50;

export class CrewService {
  constructor(private db: Db) {}

  /** The crew a player belongs to, or null. */
  async forDevice(deviceId: string): Promise<CrewInfo | null> {
    const rows = await this.db.query<CrewRow>(
      `SELECT c.id, c.name, c.tag, c.color,
              c.chartered,
              lead.device_id AS leader_device,
              (SELECT COUNT(*) FROM crew_members m2 WHERE m2.crew_id = c.id)::int AS members,
              COALESCE((
                SELECT SUM(f.count) FROM floors f
                JOIN crew_members m3 ON m3.player_id = f.player_id
                WHERE m3.crew_id = c.id
              ), 0)::int AS floors
       FROM crew_members m
       JOIN players p   ON p.id = m.player_id
       JOIN crews c     ON c.id = m.crew_id
       JOIN players lead ON lead.id = c.leader_id
       WHERE p.device_id = $1`,
      [deviceId]
    );
    return rows[0] ? toInfo(rows[0]) : null;
  }

  async create(
    deviceId: string,
    rawName: string,
    rawTag: string,
    color: string,
    /** Set by the room from the founder's verified NFT tier — never by a client. */
    chartered = false
  ): Promise<CrewResult> {
    const existing = await this.forDevice(deviceId);
    if (existing) return { ok: false, reason: `You're already in [${existing.tag}].` };

    const name = sanitise(String(rawName ?? "")).slice(0, 24);
    const tag = sanitise(String(rawTag ?? "")).toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 5);

    if (name.length < 3) return { ok: false, reason: "Crew name needs at least 3 characters." };
    if (!TAG_PATTERN.test(tag)) return { ok: false, reason: "Tag must be 2–5 letters or digits." };

    const player = await this.playerId(deviceId);
    if (!player) return { ok: false, reason: "Play a little before founding a crew." };

    const chosen = CREW_COLORS.includes(color) ? color : CREW_COLORS[0];

    try {
      const created = await this.db.begin(async (tx) => {
        const rows = await tx.query<{ id: string | number }>(
          "INSERT INTO crews (name, tag, color, leader_id, chartered) VALUES ($1,$2,$3,$4,$5) RETURNING id",
          [name, tag, chosen, player, chartered]
        );
        const id = Number(rows[0].id);
        await tx.query("INSERT INTO crew_members (crew_id, player_id, role) VALUES ($1,$2,'leader')", [
          id,
          player,
        ]);
        return id;
      });
      void created;
    } catch (err) {
      // The unique index on tag is the real guard; catching it is simpler and
      // race-free compared to checking first and inserting after.
      if (/unique|duplicate/i.test((err as Error)?.message ?? "")) {
        return { ok: false, reason: `Tag [${tag}] is taken.` };
      }
      throw err;
    }

    const crew = await this.forDevice(deviceId);
    return crew ? { ok: true, crew } : { ok: false, reason: "Could not create the crew." };
  }

  async join(deviceId: string, rawTag: string): Promise<CrewResult> {
    const existing = await this.forDevice(deviceId);
    if (existing) return { ok: false, reason: `Leave [${existing.tag}] first.` };

    const tag = String(rawTag ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 5);
    const rows = await this.db.query<{ id: string | number; members: number; chartered: boolean }>(
      `SELECT c.id, c.chartered,
              (SELECT COUNT(*) FROM crew_members m WHERE m.crew_id = c.id)::int AS members
       FROM crews c WHERE c.tag = $1`,
      [tag]
    );
    if (!rows[0]) return { ok: false, reason: `No crew with tag [${tag}].` };
    const cap = rows[0].chartered ? MAX_MEMBERS_CHARTERED : MAX_MEMBERS;
    if (Number(rows[0].members) >= cap) return { ok: false, reason: "That crew is full." };

    const player = await this.playerId(deviceId);
    if (!player) return { ok: false, reason: "Play a little before joining a crew." };

    await this.db.query("INSERT INTO crew_members (crew_id, player_id) VALUES ($1,$2)", [
      Number(rows[0].id),
      player,
    ]);

    const crew = await this.forDevice(deviceId);
    return crew ? { ok: true, crew } : { ok: false, reason: "Could not join." };
  }

  /**
   * Leave, handling the leader case.
   *
   * A leader leaving promotes the longest-serving member rather than
   * dissolving the crew under everyone — and only the last person out disbands
   * it, which also cleans up the tag for reuse.
   */
  async leave(deviceId: string): Promise<{ ok: boolean; reason?: string; disbanded?: boolean }> {
    const crew = await this.forDevice(deviceId);
    if (!crew) return { ok: false, reason: "You're not in a crew." };

    const player = await this.playerId(deviceId);
    if (!player) return { ok: false, reason: "Unknown player." };

    return this.db.begin(async (tx) => {
      await tx.query("DELETE FROM crew_members WHERE player_id = $1", [player]);

      const left = await tx.query<{ n: number }>(
        "SELECT COUNT(*)::int AS n FROM crew_members WHERE crew_id = $1",
        [crew.id]
      );

      if (Number(left[0].n) === 0) {
        await tx.query("DELETE FROM crews WHERE id = $1", [crew.id]);
        return { ok: true, disbanded: true };
      }

      if (crew.leaderDevice === deviceId) {
        const next = await tx.query<{ player_id: string | number }>(
          "SELECT player_id FROM crew_members WHERE crew_id = $1 ORDER BY joined_at ASC LIMIT 1",
          [crew.id]
        );
        if (next[0]) {
          await tx.query("UPDATE crews SET leader_id = $1 WHERE id = $2", [
            Number(next[0].player_id),
            crew.id,
          ]);
          await tx.query(
            "UPDATE crew_members SET role = 'leader' WHERE crew_id = $1 AND player_id = $2",
            [crew.id, Number(next[0].player_id)]
          );
        }
      }

      return { ok: true, disbanded: false };
    });
  }

  /** Crews ranked by pooled holdings, for the leaderboard. */
  async ranking(limit = 10): Promise<Array<{ tag: string; name: string; color: string; floors: number; members: number }>> {
    const rows = await this.db.query<{
      tag: string;
      name: string;
      color: string;
      floors: number;
      members: number;
    }>(
      `SELECT c.tag, c.name, c.color,
              COALESCE(SUM(f.count), 0)::int AS floors,
              COUNT(DISTINCT m.player_id)::int AS members
       FROM crews c
       JOIN crew_members m ON m.crew_id = c.id
       LEFT JOIN floors f ON f.player_id = m.player_id
       GROUP BY c.id, c.tag, c.name, c.color
       ORDER BY floors DESC, members DESC
       LIMIT $1`,
      [limit]
    );
    return rows.map((r) => ({
      tag: r.tag,
      name: r.name,
      color: r.color,
      floors: Number(r.floors),
      members: Number(r.members),
    }));
  }

  private async playerId(deviceId: string): Promise<number | null> {
    const rows = await this.db.query<{ id: string | number }>(
      "SELECT id FROM players WHERE device_id = $1",
      [deviceId]
    );
    return rows[0] ? Number(rows[0].id) : null;
  }
}

interface CrewRow {
  id: string | number;
  name: string;
  tag: string;
  color: string;
  chartered: boolean;
  leader_device: string;
  members: number;
  floors: number;
}

function toInfo(row: CrewRow): CrewInfo {
  return {
    id: Number(row.id),
    name: row.name,
    tag: row.tag,
    color: row.color,
    leaderDevice: row.leader_device,
    members: Number(row.members),
    floors: Number(row.floors),
    chartered: Boolean(row.chartered),
  };
}
