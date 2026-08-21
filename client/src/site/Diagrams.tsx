import type { ReactNode } from "react";
import { useReveal } from "./motion";

/**
 * Animated explanatory diagrams.
 *
 * Each one draws a mechanism rather than labelling a concept: the arrows carry
 * verbs, and the animation exists to show direction of flow — not decoration.
 * All motion is CSS-driven (dash offset, transform) so it costs nothing, and
 * everything freezes under prefers-reduced-motion.
 */

function Figure({
  caption,
  children,
  wide,
}: {
  caption: string;
  children: ReactNode;
  wide?: boolean;
}) {
  const { ref, shown } = useReveal(0.25);
  return (
    <figure className={`dg ${wide ? "dg-wide" : ""} ${shown ? "dg-in" : ""}`} ref={ref}>
      <div className="dg-canvas">{children}</div>
      <figcaption>{caption}</figcaption>
    </figure>
  );
}

/** Shared arrowhead + flowing-dash definitions. */
function Defs() {
  return (
    <defs>
      <marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
        <path d="M0 0 L10 5 L0 10 z" fill="currentColor" />
      </marker>
      <marker id="ah-amber" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
        <path d="M0 0 L10 5 L0 10 z" fill="#ffb347" />
      </marker>
      <marker id="ah-cyan" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
        <path d="M0 0 L10 5 L0 10 z" fill="#22e8ff" />
      </marker>
      <marker id="ah-green" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
        <path d="M0 0 L10 5 L0 10 z" fill="#3bff8f" />
      </marker>
    </defs>
  );
}

/* ------------------------------------------------------------------ */
/* 1 · The earning loop                                                */
/* ------------------------------------------------------------------ */

export function EarnLoopDiagram() {
  return (
    <Figure
      wide
      caption="Energy converts to currency through shifts; currency converts to floors; floors produce currency without further input. Storms feed the crafting branch and cost nothing to enter."
    >
      <svg viewBox="0 0 760 300" role="img" aria-label="The earning loop: CHARGE powers shifts which pay BLOCK, BLOCK buys floors which pay BLOCK passively, and storms yield shards which craft signs.">
        <Defs />

        {/* CHARGE */}
        <g className="node">
          <rect x="16" y="112" width="118" height="56" rx="3" className="n-box n-amber" />
          <text x="75" y="136" className="n-title">CHARGE</text>
          <text x="75" y="153" className="n-sub">+1 / 5 min</text>
        </g>

        {/* arrow → shift */}
        <path d="M138 140 L206 140" className="flow flow-amber" markerEnd="url(#ah-amber)" />
        <text x="172" y="130" className="e-label">spend 12</text>

        {/* SHIFT */}
        <g className="node">
          <rect x="210" y="104" width="132" height="72" rx="3" className="n-box n-cyan" />
          <text x="276" y="132" className="n-title">Work a shift</text>
          <text x="276" y="149" className="n-sub">timing minigame</text>
          <text x="276" y="164" className="n-sub">scored server-side</text>
        </g>

        {/* arrow → block */}
        <path d="M346 140 L420 140" className="flow flow-green" markerEnd="url(#ah-green)" />
        <text x="383" y="130" className="e-label">earns</text>

        {/* BLOCK */}
        <g className="node">
          <rect x="424" y="112" width="112" height="56" rx="3" className="n-box n-green" />
          <text x="480" y="136" className="n-title">$BLOCK</text>
          <text x="480" y="153" className="n-sub">currency</text>
        </g>

        {/* arrow → floor */}
        <path d="M540 140 L612 140" className="flow flow-amber" markerEnd="url(#ah-amber)" />
        <text x="576" y="130" className="e-label">buys</text>

        {/* FLOOR */}
        <g className="node">
          <rect x="616" y="104" width="128" height="72" rx="3" className="n-box n-amber" />
          <text x="680" y="132" className="n-title">Lease a floor</text>
          <text x="680" y="149" className="n-sub">lights one window</text>
          <text x="680" y="164" className="n-sub">permanently</text>
        </g>

        {/* feedback loop: floor → block */}
        <path
          d="M680 180 L680 236 L480 236 L480 174"
          className="flow flow-green"
          markerEnd="url(#ah-green)"
        />
        <text x="580" y="252" className="e-label e-green">pays continuously, while the feed is live</text>

        {/* storms branch */}
        <g className="node">
          <rect x="210" y="14" width="132" height="60" rx="3" className="n-box n-magenta" />
          <text x="276" y="38" className="n-title">Run a storm</text>
          <text x="276" y="55" className="n-sub">free · first touch</text>
        </g>
        <path d="M276 78 L276 100" className="flow flow-cyan" markerEnd="url(#ah-cyan)" />
        <text x="316" y="94" className="e-label">shards</text>

        <path d="M346 44 L612 44" className="flow flow-cyan" markerEnd="url(#ah-cyan)" />
        <text x="479" y="34" className="e-label">8 shards + 120 $BLOCK</text>
        <g className="node">
          <rect x="616" y="14" width="128" height="60" rx="3" className="n-box n-cyan" />
          <text x="680" y="38" className="n-title">Mount a sign</text>
          <text x="680" y="55" className="n-sub">earns from traffic</text>
        </g>
      </svg>
    </Figure>
  );
}

/* ------------------------------------------------------------------ */
/* 2 · Height derivation — linear vs log                               */
/* ------------------------------------------------------------------ */

export function HeightScaleDiagram() {
  const tickers = [
    { s: "GME", p: 24 },
    { s: "NVDA", p: 224 },
    { s: "SPY", p: 772 },
    { s: "ETH", p: 1881 },
    { s: "BTC", p: 63613 },
  ];
  const maxP = Math.max(...tickers.map((t) => t.p));
  const logs = tickers.map((t) => Math.log10(t.p));
  const lMin = Math.min(...logs);
  const lMax = Math.max(...logs);

  return (
    <Figure
      wide
      caption="Left: raw price as height. Bitcoin is 2,650× GameStop, so everything else flattens to nothing. Right: the logarithmic scale actually used, which keeps every tower readable while preserving order."
    >
      <svg viewBox="0 0 760 260" role="img" aria-label="Comparison of linear and logarithmic height scaling across five tickers.">
        <Defs />

        <text x="14" y="20" className="dg-head">LINEAR: unusable</text>
        <text x="410" y="20" className="dg-head dg-head-on">LOGARITHMIC: what we use</text>

        {/* linear group */}
        <line x1="14" y1="220" x2="368" y2="220" className="axis" />
        {tickers.map((t, i) => {
          const h = (t.p / maxP) * 150;
          return (
            <g key={t.s}>
              <rect
                x={30 + i * 66}
                y={220 - h}
                width="34"
                height={h}
                className="bar bar-dim grow"
                style={{ ["--h" as string]: `${h}px`, animationDelay: `${i * 70}ms` }}
              />
              <text x={47 + i * 66} y="236" className="b-label">{t.s}</text>
            </g>
          );
        })}

        {/* log group */}
        <line x1="410" y1="220" x2="748" y2="220" className="axis" />
        {tickers.map((t, i) => {
          const h = 28 + ((logs[i] - lMin) / (lMax - lMin)) * 140;
          return (
            <g key={t.s}>
              <rect
                x={424 + i * 64}
                y={220 - h}
                width="34"
                height={h}
                className="bar bar-live grow"
                style={{ ["--h" as string]: `${h}px`, animationDelay: `${i * 70}ms` }}
              />
              <text x={441 + i * 64} y="236" className="b-label">{t.s}</text>
              <text x={441 + i * 64} y="250" className="b-price">${t.p >= 1000 ? `${Math.round(t.p / 1000)}k` : t.p}</text>
            </g>
          );
        })}
      </svg>
    </Figure>
  );
}

/* ------------------------------------------------------------------ */
/* 3 · The trading day                                                 */
/* ------------------------------------------------------------------ */

export function MarketDayDiagram() {
  return (
    <Figure
      wide
      caption="The city's state follows the feeds, not a timer. Between 09:30 and 16:00 New York time everything runs; outside it the equity feeds hold their last value and most of the map goes idle."
    >
      <svg viewBox="0 0 760 210" role="img" aria-label="Timeline of a trading day showing pre-market, open session, and after hours, and what changes in each.">
        <Defs />

        {/* track */}
        <rect x="14" y="60" width="732" height="34" rx="2" className="tl-track" />
        {/* open band */}
        <rect x="244" y="60" width="290" height="34" rx="2" className="tl-open sweep" />

        {/* markers */}
        <line x1="244" y1="46" x2="244" y2="108" className="tl-mark" />
        <line x1="534" y1="46" x2="534" y2="108" className="tl-mark" />

        <text x="20" y="40" className="tl-time">04:00</text>
        <text x="244" y="40" className="tl-time tl-key" textAnchor="middle">09:30 · BELL</text>
        <text x="534" y="40" className="tl-time tl-key" textAnchor="middle">16:00 · CLOSE</text>
        <text x="740" y="40" className="tl-time" textAnchor="end">20:00</text>

        <text x="128" y="82" className="tl-label" textAnchor="middle">pre-market</text>
        <text x="389" y="82" className="tl-label tl-on" textAnchor="middle">market open</text>
        <text x="640" y="82" className="tl-label" textAnchor="middle">after hours</text>

        {/* what changes */}
        <g className="tl-notes">
          <text x="128" y="132" textAnchor="middle" className="n-sub">skyline frozen</text>
          <text x="128" y="148" textAnchor="middle" className="n-sub">floors idle</text>
          <text x="128" y="164" textAnchor="middle" className="n-sub">fog, low light</text>

          <text x="389" y="132" textAnchor="middle" className="n-sub n-sub-on">towers move</text>
          <text x="389" y="148" textAnchor="middle" className="n-sub n-sub-on">storms can fire</text>
          <text x="389" y="164" textAnchor="middle" className="n-sub n-sub-on">floors pay full</text>

          <text x="640" y="132" textAnchor="middle" className="n-sub">skyline frozen</text>
          <text x="640" y="148" textAnchor="middle" className="n-sub">floors idle</text>
          <text x="640" y="164" textAnchor="middle" className="n-sub">Crypto Alley stays live</text>
        </g>

        <text x="380" y="196" textAnchor="middle" className="e-label">
          Crypto feeds run 24/7. That district never sleeps
        </text>
      </svg>
    </Figure>
  );
}

/* ------------------------------------------------------------------ */
/* 4 · Architecture                                                    */
/* ------------------------------------------------------------------ */

export function ArchitectureDiagram() {
  return (
    <Figure
      wide
      caption="Anything that must feel instant stays on the game server. Only ownership and value reach the chain, and they travel in batches. Price data flows the other way, and reading it is free."
    >
      <svg viewBox="0 0 760 300" role="img" aria-label="Architecture: browser talks to game server at 20Hz; game server settles to Robinhood Chain in batches and reads prices from it every 20 seconds.">
        <Defs />

        {/* browser */}
        <g className="node">
          <rect x="16" y="96" width="150" height="104" rx="3" className="n-box n-cyan" />
          <text x="91" y="126" className="n-title">Your browser</text>
          <text x="91" y="146" className="n-sub">renders the city</text>
          <text x="91" y="162" className="n-sub">predicts movement</text>
          <text x="91" y="178" className="n-sub">no wallet needed</text>
        </g>

        {/* inputs / state */}
        <path d="M170 130 L286 130" className="flow flow-cyan" markerEnd="url(#ah-cyan)" />
        <text x="228" y="120" className="e-label">inputs</text>
        <path d="M286 166 L170 166" className="flow flow-cyan" markerEnd="url(#ah-cyan)" />
        <text x="228" y="184" className="e-label">state · 20×/sec</text>

        {/* server */}
        <g className="node">
          <rect x="290" y="80" width="168" height="136" rx="3" className="n-box n-strong" />
          <text x="374" y="110" className="n-title">Game server</text>
          <text x="374" y="132" className="n-sub">authoritative</text>
          <text x="374" y="148" className="n-sub">movement · chat</text>
          <text x="374" y="164" className="n-sub">weather · minigames</text>
          <text x="374" y="180" className="n-sub">shard collection</text>
          <text x="374" y="200" className="n-sub n-sub-on">never onchain</text>
        </g>

        {/* settle */}
        <path d="M462 122 L596 122" className="flow flow-amber" markerEnd="url(#ah-amber)" />
        <text x="529" y="112" className="e-label">settles in batches</text>

        {/* prices back */}
        <path d="M596 176 L462 176" className="flow flow-green" markerEnd="url(#ah-green)" />
        <text x="529" y="194" className="e-label e-green">prices · every 20s · free</text>

        {/* chain */}
        <g className="node">
          <rect x="600" y="80" width="146" height="136" rx="3" className="n-box n-amber" />
          <text x="673" y="110" className="n-title">Robinhood Chain</text>
          <text x="673" y="132" className="n-sub">floor deeds</text>
          <text x="673" y="148" className="n-sub">$BLOCK balances</text>
          <text x="673" y="164" className="n-sub">Chainlink feeds</text>
          <text x="673" y="200" className="n-sub">permanent</text>
        </g>

        <text x="380" y="262" textAnchor="middle" className="e-label">
          You never wait for a confirmation to walk, talk, or play
        </text>
      </svg>
    </Figure>
  );
}

/* ------------------------------------------------------------------ */
/* 5 · Storm lifecycle                                                 */
/* ------------------------------------------------------------------ */

export function StormDiagram() {
  return (
    <Figure
      wide
      caption="Nothing in the code schedules a storm. Volatility crossing its threshold is the trigger, which is why they can't be predicted or farmed on a timer."
    >
      <svg viewBox="0 0 760 190" role="img" aria-label="Storm lifecycle: volatility crosses a threshold, shards spawn for three minutes, players race, first touch claims.">
        <Defs />

        {[
          ["01", "Volatility rises", "computed from a", "rolling price window"],
          ["02", "Threshold crossed", "storm fires at", "that tower"],
          ["03", "12–20 shards spawn", "scattered in the", "surrounding streets"],
          ["04", "First touch wins", "resolved on the", "server, once only"],
        ].map(([n, title, l1, l2], i) => (
          <g key={n} className="node">
            <rect x={14 + i * 190} y="54" width="160" height="88" rx="3" className="n-box n-magenta" />
            <text x={24 + i * 190} y="76" className="n-step">{n}</text>
            <text x={94 + i * 190} y="96" className="n-title">{title}</text>
            <text x={94 + i * 190} y="114" className="n-sub">{l1}</text>
            <text x={94 + i * 190} y="130" className="n-sub">{l2}</text>
            {i < 3 && (
              <path
                d={`M${174 + i * 190} 98 L${200 + i * 190} 98`}
                className="flow flow-cyan"
                markerEnd="url(#ah-cyan)"
              />
            )}
          </g>
        ))}

        <text x="380" y="176" textAnchor="middle" className="e-label">
          about three minutes, start to finish · free to join
        </text>
      </svg>
    </Figure>
  );
}

/* ------------------------------------------------------------------ */
/* 6 · Floor anatomy                                                   */
/* ------------------------------------------------------------------ */

export function FloorDiagram() {
  const rows = 9;
  const owned = new Set([1, 2, 4, 7]);

  return (
    <Figure
      caption="Floor count comes from the tower's height, which comes from the price. Each leased floor lights one window for everyone, ownership is readable from the street with no interface at all."
    >
      <svg viewBox="0 0 420 280" role="img" aria-label="A tower cross-section showing how leased floors render as lit windows.">
        <Defs />

        {/* tower */}
        <rect x="150" y="34" width="120" height="210" className="tw-body" />
        <rect x="150" y="30" width="120" height="6" className="tw-roof" />

        {Array.from({ length: rows }).map((_, i) => {
          const y = 46 + i * 22;
          const isOwned = owned.has(i);
          return (
            <g key={i}>
              {[0, 1, 2].map((c) => (
                <rect
                  key={c}
                  x={164 + c * 34}
                  y={y}
                  width="22"
                  height="13"
                  className={isOwned ? "win win-on flick" : "win"}
                  style={{ animationDelay: `${(i * 3 + c) * 90}ms` }}
                />
              ))}
              {isOwned && (
                <>
                  <path d={`M300 ${y + 7} L282 ${y + 7}`} className="flow flow-amber" markerEnd="url(#ah-amber)" />
                  <text x="308" y={y + 11} className="e-label e-left">leased floor</text>
                </>
              )}
            </g>
          );
        })}

        <path d="M120 60 L142 60" className="flow flow-cyan" markerEnd="url(#ah-cyan)" />
        <text x="112" y="64" className="e-label" textAnchor="end">roof = price</text>

        <text x="210" y="262" textAnchor="middle" className="n-sub">4 of 9 floors leased</text>
      </svg>
    </Figure>
  );
}
