import type { Db } from "../db/db.js";
import type { CityState } from "../rooms/schema/CityState.js";
import { floorsFor } from "./floors.js";

/**
 * Tower control.
 *
 * Whoever holds the most floors in a tower is its landlord: their name goes on
 * the building, they get the primary sign slot, and they take a cut of everyone
 * else's yield there.
 *
 * Control is resolved from the database rather than from room state, because a
 * landlord who logs off must keep their tower — `Player.floors` only exists for
 * players who are currently connected.
 */

/** Share of the tower a claimant must hold before control is granted. */
export const CONTROL_THRESHOLD = 0.25;
/** Cut of other owners' yield paid to the landlord. */
export const ROYALTY_RATE = 0.1;

export interface Landlord {
  symbol: string;
  /** Device id of the individual owner, or "" for a crew. */
  deviceId: string;
  name: string;
  color: string;
  held: number;
  isCrew: boolean;
}

interface HolderRow {
  symbol: string;
  device_id: string;
  name: string;
  held: number;
  crew_id: string | number | null;
  crew_tag: string | null;
  crew_color: string | null;
}

export class TerritoryService {
  /** symbol -> current landlord, or absent when uncontrolled. */
  private landlords = new Map<string, Landlord>();

  constructor(private db: Db) {}

  get(symbol: string): Landlord | undefined {
    return this.landlords.get(symbol);
  }

  /**
   * Recompute control for every tower.
   *
   * One query for all towers rather than one per tower: at ~38 towers the
   * per-tower version would be 38 round trips every 30 seconds for no reason.
   */
  async refresh(state: CityState): Promise<void> {
    const rows = await this.db.query<HolderRow>(`
      SELECT f.symbol,
             p.device_id,
             p.name,
             /*
               A Penthouse NFT counts as two floors toward control.

               It is a thumb on the scale, not an income stream — nothing here
               pays out, it only makes the holder harder to displace in the one
               tower their token names. Only a penthouse verified within the last
               day counts, so selling the token and vanishing loses the weight.
             */
             (f.count + CASE
               WHEN p.penthouse = f.symbol
                AND p.penthouse_at > now() - interval '1 day'
               THEN 1 ELSE 0
             END)::int AS held,
             c.id   AS crew_id,
             c.tag  AS crew_tag,
             c.color AS crew_color
      FROM floors f
      JOIN players p ON p.id = f.player_id
      LEFT JOIN crew_members m ON m.player_id = p.id
      LEFT JOIN crews c ON c.id = m.crew_id
      WHERE f.count > 0
    `);

    // Best individual and best crew per tower, decided in one pass.
    const bestIndividual = new Map<string, Landlord>();
    const crewTotals = new Map<string, Map<string, Landlord>>();

    for (const row of rows) {
      const held = Number(row.held);

      const current = bestIndividual.get(row.symbol);
      if (!current || held > current.held) {
        bestIndividual.set(row.symbol, {
          symbol: row.symbol,
          deviceId: row.device_id,
          name: row.name || "Trader",
          color: row.crew_color ?? "",
          held,
          isCrew: false,
        });
      }

      if (row.crew_id && row.crew_tag) {
        let perTower = crewTotals.get(row.symbol);
        if (!perTower) {
          perTower = new Map();
          crewTotals.set(row.symbol, perTower);
        }
        const key = String(row.crew_id);
        const existing = perTower.get(key);
        if (existing) {
          existing.held += held;
        } else {
          perTower.set(key, {
            symbol: row.symbol,
            deviceId: "",
            name: row.crew_tag,
            color: row.crew_color ?? "#22e8ff",
            held,
            isCrew: true,
          });
        }
      }
    }

    this.landlords.clear();

    state.tickers.forEach((ticker, symbol) => {
      const total = floorsFor(ticker.height);
      const minimum = Math.max(1, Math.ceil(total * CONTROL_THRESHOLD));

      const individual = bestIndividual.get(symbol);
      let bestCrew: Landlord | undefined;
      const crews = crewTotals.get(symbol);
      if (crews) {
        for (const candidate of crews.values()) {
          if (!bestCrew || candidate.held > bestCrew.held) bestCrew = candidate;
        }
      }

      // A crew only takes the tower if it genuinely out-holds the best
      // individual; ties go to the individual, who got there on their own.
      let winner: Landlord | undefined = individual;
      if (bestCrew && (!individual || bestCrew.held > individual.held)) winner = bestCrew;

      // The threshold is what makes control worth contesting. Without it,
      // one floor in an ignored tower would make somebody its landlord.
      if (!winner || winner.held < minimum) {
        ticker.landlordName = "";
        ticker.landlordHeld = 0;
        ticker.landlordIsCrew = false;
        ticker.landlordColor = "";
        return;
      }

      this.landlords.set(symbol, winner);
      ticker.landlordName = winner.isCrew ? `[${winner.name}]` : winner.name;
      ticker.landlordHeld = winner.held;
      ticker.landlordIsCrew = winner.isCrew;
      ticker.landlordColor = winner.color;
    });
  }

  /**
   * Split a yield payment between the owner and the tower's landlord.
   *
   * Returns the two legs rather than moving anything, so both reach the ledger
   * through the normal path and the balance-equals-ledger invariant holds.
   * A landlord never pays royalty to themselves.
   */
  split(
    symbol: string,
    earnerDeviceId: string,
    amount: number
  ): { toEarner: number; royalty: number; landlord?: Landlord } {
    const landlord = this.landlords.get(symbol);
    if (!landlord || landlord.deviceId === earnerDeviceId) {
      return { toEarner: amount, royalty: 0 };
    }

    // A crew landlord has no single account to pay, so the cut is simply not
    // taken — the reward there is control and identity, not rent.
    if (landlord.isCrew) return { toEarner: amount, royalty: 0 };

    const royalty = amount * ROYALTY_RATE;
    return { toEarner: amount - royalty, royalty, landlord };
  }
}
