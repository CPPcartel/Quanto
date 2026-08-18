import { useState } from "react";
import { formatPrice, type Reading } from "./feeds";
import { useReveal, useCountUp } from "./motion";

/**
 * Interactive sections.
 *
 * Both of these let the visitor operate a piece of the game rather than read
 * about it — the district explorer runs on the same live prices as the hero,
 * and the floor demo is the ownership mechanic reduced to something you can
 * click.
 */

const DISTRICTS = [
  {
    id: "tech",
    name: "Tech Row",
    tint: "#22e8ff",
    blurb: "Tall, glassy, volatile. The skyline that moves most.",
    symbols: ["NVDA", "AAPL", "MSFT", "GOOGL", "AMZN", "META", "AMD", "ORCL", "INTC", "MU", "ASML", "TSM"],
  },
  {
    id: "crypto",
    name: "Crypto Alley",
    tint: "#ffb347",
    blurb: "Never sleeps. The only district lit through the weekend.",
    symbols: ["BTC", "ETH", "LINK", "COIN", "MSTR", "CRCL"],
  },
  {
    id: "moonshot",
    name: "Moonshot Mile",
    tint: "#ff2d95",
    blurb: "Meme stocks and rockets. Wildest swings in the city.",
    symbols: ["TSLA", "GME", "PLTR"],
  },
  {
    id: "index",
    name: "Index Plaza",
    tint: "#3bff8f",
    blurb: "Broad funds and metals. Low, stately, dependable.",
    symbols: ["SPY", "QQQ"],
  },
] as const;

export function DistrictExplorer({ readings }: { readings: Reading[] }) {
  const [active, setActive] = useState<string>("tech");
  const { ref, shown } = useReveal();
  const district = DISTRICTS.find((d) => d.id === active) ?? DISTRICTS[0];
  const byId = new Map(readings.map((r) => [r.symbol, r]));
  const towers = district.symbols.map((s) => byId.get(s)).filter(Boolean) as Reading[];

  return (
    <div className={`districts reveal ${shown ? "in" : ""}`} ref={ref}>
      <div className="district-tabs" role="tablist">
        {DISTRICTS.map((d) => (
          <button
            key={d.id}
            role="tab"
            aria-selected={active === d.id}
            className={active === d.id ? "on" : ""}
            style={active === d.id ? { color: d.tint, borderColor: d.tint } : undefined}
            onClick={() => setActive(d.id)}
          >
            <span className="d-dot" style={{ background: d.tint }} />
            {d.name}
          </button>
        ))}
      </div>

      <div className="district-body">
        <p className="district-blurb" style={{ color: district.tint }}>
          {district.blurb}
        </p>

        <div className="district-grid">
          {towers.map((t) => {
            // Bar height is relative within the district, so each one reads.
            const max = Math.max(...towers.map((x) => Math.log10(Math.max(1, x.price))));
            const min = Math.min(...towers.map((x) => Math.log10(Math.max(1, x.price))));
            const span = max - min || 1;
            const h = 26 + ((Math.log10(Math.max(1, t.price)) - min) / span) * 74;

            return (
              <div className="d-tower" key={t.symbol} title={`${t.name} · $${formatPrice(t.price)}`}>
                <div className="d-bar-wrap">
                  <div
                    className="d-bar"
                    style={{
                      height: shown ? `${h}%` : "0%",
                      background: t.frozen ? "#39415a" : district.tint,
                      boxShadow: t.frozen ? "none" : `0 0 14px ${district.tint}55`,
                    }}
                  />
                </div>
                <span className="d-sym">{t.symbol}</span>
                <span className="d-px">${formatPrice(t.price)}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/**
 * The ownership mechanic, clickable. Every window you light is a floor you'd
 * own; the readout updates as you go. Deliberately not connected to anything —
 * it's a demonstration, not a purchase.
 */
export function FloorDemo() {
  const ROWS = 11;
  const COLS = 6;
  const TOTAL = ROWS * COLS;
  // A few floors start owned, so the building never reads as abandoned.
  const [lit, setLit] = useState<Set<number>>(() => new Set([14, 15, 20, 27, 33, 44, 50, 51]));
  const { ref, shown } = useReveal();

  const toggle = (i: number) => {
    setLit((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  };

  const pct = Math.round((lit.size / TOTAL) * 100);

  return (
    <div className={`floor-demo reveal ${shown ? "in" : ""}`} ref={ref}>
      <div className="fd-tower">
        <div className="fd-roof" />
        <div className="fd-grid">
          {Array.from({ length: TOTAL }).map((_, i) => (
            <button
              key={i}
              className={lit.has(i) ? "fd-w on" : "fd-w"}
              onClick={() => toggle(i)}
              aria-label={`${lit.has(i) ? "Vacate" : "Lease"} floor ${ROWS - Math.floor(i / COLS)}`}
              style={{ transitionDelay: shown ? `${(i % COLS) * 18 + Math.floor(i / COLS) * 12}ms` : "0ms" }}
            />
          ))}
        </div>
      </div>

      <div className="fd-readout">
        <p className="fd-hint">Click the windows.</p>
        <div className="fd-stat">
          <span className="fd-num">{lit.size}</span>
          <span className="fd-lab">floors leased</span>
        </div>
        <div className="fd-stat">
          <span className="fd-num">{pct}%</span>
          <span className="fd-lab">occupancy</span>
        </div>
        <p className="fd-note">
          In the city these are real, owned by real players, and visible from three streets away.
        </p>
      </div>
    </div>
  );
}

/** A single animated statistic. */
export function Stat({
  value,
  suffix = "",
  decimals = 0,
  label,
  sub,
}: {
  value: number;
  suffix?: string;
  decimals?: number;
  label: string;
  sub?: string;
}) {
  const { ref, display } = useCountUp(value);
  return (
    <div className="stat">
      <span className="stat-value" ref={ref}>
        {display.toLocaleString("en-US", {
          minimumFractionDigits: decimals,
          maximumFractionDigits: decimals,
        })}
        {suffix}
      </span>
      <span className="stat-label">{label}</span>
      {sub && <span className="stat-sub">{sub}</span>}
    </div>
  );
}
