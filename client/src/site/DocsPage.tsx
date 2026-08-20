import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { linkProps } from "./router";
import { LINKS } from "./links";
import {
  EarnLoopDiagram,
  HeightScaleDiagram,
  MarketDayDiagram,
  ArchitectureDiagram,
  StormDiagram,
  FloorDiagram,
} from "./Diagrams";

/**
 * Full documentation.
 *
 * One long scrollable document with a sticky contents rail that tracks
 * position, rather than tabs — reference material is read by scanning and
 * searching, and tabs hide most of the page from both.
 */

interface Section {
  id: string;
  title: string;
  body: ReactNode;
}

export function DocsPage() {
  const [active, setActive] = useState("start");

  const sections = useSections();

  // Highlight whichever heading is currently nearest the top of the viewport.
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive(visible[0].target.id);
      },
      { rootMargin: "-15% 0px -70% 0px", threshold: 0 }
    );

    sections.forEach((s) => {
      const el = document.getElementById(s.id);
      if (el) observer.observe(el);
    });
    return () => observer.disconnect();
  }, [sections]);

  const jump = (id: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    const top = el.getBoundingClientRect().top + window.scrollY - 86;
    window.scrollTo({ top, behavior: "smooth" });
  };

  return (
    <main className="site doc-page">
      <header className="doc-head">
        <p className="sect-num">documentation</p>
        <h1>How Quanto works</h1>
        <p className="lede">
          The complete reference: the world, the economy, the architecture, and every number
          that governs play. If you'd rather just try it, <a {...linkProps("/play")}>the city is
          open</a>.
        </p>
      </header>

      <div className="doc-body">
        <nav className="doc-nav" aria-label="Contents">
          <p className="doc-nav-title">Contents</p>
          {sections.map((s) => (
            <button
              key={s.id}
              className={active === s.id ? "on" : ""}
              onClick={() => jump(s.id)}
            >
              {s.title}
            </button>
          ))}
          <span className="doc-nav-sep" />
          <a className="doc-nav-ext" href="/whitepaper" target="_blank" rel="noreferrer noopener">
            Whitepaper ↗
          </a>
        </nav>

        <article className="doc-content">
          {sections.map((s) => (
            <section key={s.id} id={s.id} className="doc-section">
              <h2>{s.title}</h2>
              {s.body}
            </section>
          ))}
        </article>
      </div>
    </main>
  );
}

function useSections(): Section[] {
  return [
    {
      id: "start",
      title: "Getting started",
      body: (
        <>
          <p className="doc-lede">
            Quanto runs in the browser. No download, no signup, and no wallet — click{" "}
            <a {...linkProps("/play")}>Enter the city</a> and you're in.
          </p>
          <p>
            You spawn in the central plaza with <b>500 $BLOCK</b> and a full <b>CHARGE</b> bar.
            Every tower around you is a real company, and its height is that company's live
            share price. Walk up to any of them and the panel in the bottom-right tells you what
            it is, what a floor costs, and what it pays.
          </p>

          <Callout tone="do" title="The fastest way to understand the game">
            Walk to any tower, click <b>Lease a floor</b>, then look up. One window is now lit —
            and it's lit for everyone else in the city too. That's the whole idea in one action.
          </Callout>

          <h3>Controls</h3>
          <table className="kv">
            <tbody>
              <tr><td><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd></td><td>Walk</td></tr>
              <tr><td><kbd>Shift</kbd></td><td>Run</td></tr>
              <tr><td>Scroll</td><td>Zoom — street level out to the whole city</td></tr>
              <tr><td><kbd>M</kbd></td><td>Snap between street view and map view</td></tr>
              <tr><td>Click a tower</td><td>Inspect it from anywhere, no need to walk over</td></tr>
              <tr><td><kbd>E</kbd></td><td>Clock in for a shift when near a tower</td></tr>
              <tr><td><kbd>Space</kbd></td><td>During a shift, hit the green band</td></tr>
              <tr><td><kbd>?</kbd></td><td>Open the in-game handbook</td></tr>
            </tbody>
          </table>

          <h3>What you're looking at</h3>
          <ul className="doc-list">
            <li><b>Top centre</b> — your wallet: $BLOCK, shards and the CHARGE bar.</li>
            <li><b>Top strip</b> — a live tape of every tracked feed.</li>
            <li><b>Top right</b> — minimap, zoom level, and a render diagnostics panel.</li>
            <li><b>Bottom right</b> — the inspector for whichever tower you're near or have clicked.</li>
            <li><b>Bottom centre</b> — the leaderboard of the brightest towers.</li>
          </ul>
        </>
      ),
    },

    {
      id: "world",
      title: "The world",
      body: (
        <>
          <p className="doc-lede">
            About thirty-eight companies are tracked. Each one is a tower, and each tower's
            height is read from a Chainlink price feed on Robinhood Chain every twenty seconds.
          </p>

          <h3>Why height uses a log scale</h3>
          <p>
            Using the raw price as height doesn't work. Bitcoin trades around $63,000 and
            GameStop around $24 — a linear mapping makes one tower 2,650 times taller than the
            other, and every building in between collapses into an unreadable smear at the
            bottom of the screen.
          </p>

          <HeightScaleDiagram />

          <p>
            So height comes from a logarithmic transform of the price, then gets modulated by
            recent movement. Expensive companies are still visibly taller; nothing disappears;
            and a price change still reads as the building growing or shrinking.
          </p>

          <h3>The four districts</h3>
          <table className="kv">
            <tbody>
              <tr>
                <td>Tech Row</td>
                <td>NVIDIA, Apple, Microsoft, Alphabet, ASML and friends. Tall, dense and the most active skyline in the city.</td>
              </tr>
              <tr>
                <td>Crypto Alley</td>
                <td>Bitcoin, Ethereum, Chainlink, plus crypto-adjacent equities. The only district that stays live around the clock.</td>
              </tr>
              <tr>
                <td>Moonshot Mile</td>
                <td>Tesla, GameStop, quantum computing, rockets. Highest volatility, biggest payouts, longest quiet spells.</td>
              </tr>
              <tr>
                <td>Index Plaza</td>
                <td>Broad funds and metals. Low, steady and dependable — the safe entry point.</td>
              </tr>
            </tbody>
          </table>

          <Callout tone="note" title="District choice is a real decision">
            Crypto Alley earns all week but swings hard. Index Plaza is reliable but idle
            two-thirds of the time. That trade-off comes from actual market structure, not from
            a designer balancing numbers.
          </Callout>
        </>
      ),
    },

    {
      id: "loop",
      title: "The economy",
      body: (
        <>
          <p className="doc-lede">
            Two resources drive everything. <b>$BLOCK</b> is money. <b>CHARGE</b> is energy — it
            refills on its own at one point every five minutes, capped at 100.
          </p>
          <p>
            Energy gating is deliberate: it makes the best strategy checking in a few times a day
            rather than leaving something running overnight, which favours people over scripts.
          </p>

          <EarnLoopDiagram />

          <h3>Where money comes from, and where it goes</h3>
          <table className="kv">
            <tbody>
              <tr><td>Shifts</td><td>Source — one-off payout, scaled by volatility tier and your accuracy</td></tr>
              <tr><td>Floors</td><td>Source — continuous, but only while the feed is live</td></tr>
              <tr><td>Signs</td><td>Source — small trickle from passing players</td></tr>
              <tr><td>Buying floors</td><td>Sink — the currency is destroyed, not pooled</td></tr>
              <tr><td>Crafting signs</td><td>Sink — consumes both shards and $BLOCK</td></tr>
            </tbody>
          </table>
          <p>
            Floor purchases being a <b>sink</b> matters: it stops earnings compounding into
            themselves as the city fills up. An economy whose only sink is speculation isn't an
            economy.
          </p>
        </>
      ),
    },

    {
      id: "floors",
      title: "Floors",
      body: (
        <>
          <p className="doc-lede">
            The core mechanic. Buy a floor and one window lights up on that tower — permanently,
            visible to every player in the city.
          </p>

          <FloorDiagram />

          <h3>How many floors a tower has</h3>
          <p>
            Floor count is derived from the tower's height, bounded between 6 and 40. More
            valuable companies are taller, so they have more inventory to lease. Because height
            tracks price, a tower's available floors can change over time.
          </p>

          <h3>What a floor costs</h3>
          <p>
            Price scales with both the company's price level and its current volatility.
            Expensive, volatile towers cost more because they earn more; cheap, stable ones are
            accessible starting positions with modest returns.
          </p>

          <h3>What a floor earns</h3>
          <p>
            Yield accrues continuously — but <b>only while that company's feed is live</b>. A
            frozen feed pays nothing at all. This is what gives the closing bell real weight
            rather than being a lighting change: at 16:00 New York time, most of the city's
            income simply stops.
          </p>

          <Callout tone="warn" title="Floors are not an investment">
            $BLOCK is an in-game currency with no cash value and no way to convert it to money.
            Leasing floors is a game mechanic, not a financial position, and there is nothing to
            deposit or lose.
          </Callout>
        </>
      ),
    },

    {
      id: "tiers",
      title: "Volatility tiers",
      body: (
        <>
          <p className="doc-lede">
            Almost every payout in the game is scaled by how much its company is currently
            moving — not by which direction it moves.
          </p>
          <p>
            The server measures realised volatility from a rolling window of observed prices,
            then sorts each tower into one of four buckets:
          </p>

          <table className="kv tier-table">
            <tbody>
              <tr><td><span className="tier tier-calm">calm</span></td><td>1.0× — barely moving. Predictable, low return.</td></tr>
              <tr><td><span className="tier tier-normal">normal</span></td><td>1.6× — ordinary trading activity.</td></tr>
              <tr><td><span className="tier tier-hot">hot</span></td><td>2.4× — something is happening.</td></tr>
              <tr><td><span className="tier tier-extreme">extreme</span></td><td>3.5× — storm territory.</td></tr>
            </tbody>
          </table>

          <Callout tone="note" title="Why buckets and not a smooth curve">
            Two reasons. Coarse tiers make decisions legible — you can reason about "this tower
            is hot" without modelling a payoff curve. And a four-step, direction-neutral function
            is deliberately far from anything that behaves like a financial derivative. Nothing
            pays more for a stock going up than for the same stock going down.
          </Callout>
        </>
      ),
    },

    {
      id: "shifts",
      title: "Shift work",
      body: (
        <>
          <p className="doc-lede">
            The way to earn with no capital at all. Walk to any tower, press <kbd>E</kbd>, and
            play a ten-second timing game.
          </p>
          <p>
            A marker sweeps back and forth across a bar. Press <kbd>Space</kbd> when it's inside
            the green band, three times. Your payout is the base rate multiplied by that tower's
            volatility tier and by how accurate you were.
          </p>

          <table className="kv">
            <tbody>
              <tr><td>Cost</td><td>12 CHARGE, taken when you clock in</td></tr>
              <tr><td>Cooldown</td><td>30 minutes, per building</td></tr>
              <tr><td>Rounds</td><td>3</td></tr>
              <tr><td>Scoring</td><td>Server-side, from your input timings</td></tr>
            </tbody>
          </table>

          <p>
            The per-building cooldown exists so one lucrative tower can't be farmed all day — to
            keep earning you have to move around the city, which is also how you end up
            somewhere when a storm breaks.
          </p>
        </>
      ),
    },

    {
      id: "storms",
      title: "Volatility storms",
      body: (
        <>
          <p className="doc-lede">
            The only genuinely unpredictable thing in the game, because the market decides when
            it happens.
          </p>

          <StormDiagram />

          <p>
            When a tower's realised volatility crosses its threshold, shards scatter through the
            surrounding streets for about three minutes and a warning goes out city-wide. Walk
            over them to collect. <b>First touch wins</b>, resolved on the server, so there's no
            way to claim one twice and no way to buy your way to the front of the queue.
          </p>

          <Callout tone="do" title="Storms are free">
            No energy cost, no ownership requirement. They're designed to pull everyone online
            into the same street at the same moment — the thing that makes a world feel
            populated rather than merely multiplayer.
          </Callout>

          <p>
            Shards are the crafting currency, and signs are currently the only thing that
            consumes them.
          </p>
        </>
      ),
    },

    {
      id: "signs",
      title: "Neon signs",
      body: (
        <>
          <p className="doc-lede">
            The only way to write something of your own onto the shared skyline.
          </p>
          <p>
            Once you own at least one floor in a tower, you can craft a sign — up to five
            characters, in a colour of your choice — and mount it on that tower's facade. It
            glows and flickers there for every player in the city, and earns a small amount each
            time somebody walks past.
          </p>

          <table className="kv">
            <tbody>
              <tr><td>Cost</td><td>8 shards + 120 $BLOCK + 20 CHARGE</td></tr>
              <tr><td>Requirement</td><td>At least one leased floor in that tower</td></tr>
              <tr><td>Limit</td><td>6 signs per tower, first come first served</td></tr>
              <tr><td>Earnings</td><td>Per unique passer-by; your own presence doesn't count</td></tr>
            </tbody>
          </table>

          <p>
            A sign on a busy street corner is genuinely worth more than one somewhere quiet,
            which makes location a real consideration rather than a cosmetic one.
          </p>
        </>
      ),
    },

    {
      id: "hours",
      title: "Market hours",
      body: (
        <>
          <p className="doc-lede">
            The city keeps the same hours as the US stock market, because it's reading the same
            feeds.
          </p>

          <MarketDayDiagram />

          <p>
            Robinhood's equity feeds publish 24/5. Outside market hours they hold their last
            price — they don't fail, they just stop changing. Rather than hide that, the game is
            built on it: the skyline freezes, fog rolls in, the light drops, and floors stop
            paying.
          </p>
          <p>
            Crypto feeds are genuinely continuous, so Crypto Alley keeps running all night and
            all weekend. During off-hours it's the only part of the city still earning.
          </p>

          <Callout tone="note" title="How the game knows">
            Two signals, both required. Feed staleness alone isn't enough, because some feeds
            keep publishing during extended-hours trading. The calendar alone isn't enough,
            because a feed can be degraded during normal hours. The server checks both.
          </Callout>
        </>
      ),
    },

    {
      id: "architecture",
      title: "Architecture",
      body: (
        <>
          <p className="doc-lede">
            Most onchain games feel bad because they put everything on the chain. Walking becomes
            a transaction; every action costs money and waits for confirmation. This one draws a
            hard line.
          </p>

          <ArchitectureDiagram />

          <h3>What never touches the chain</h3>
          <p>
            Movement, chat, weather, minigames and shard collection all run on the game server at
            twenty updates a second. Your client sends <em>inputs</em>, never positions, and
            predicts the result locally so movement feels instant despite the server having the
            final say.
          </p>

          <h3>What does</h3>
          <p>
            Ownership and value: floor deeds, $BLOCK balances, and settled earnings. These go in
            batches rather than one transaction per action, which is why nothing in normal play
            makes you wait.
          </p>

          <h3>Reading is free</h3>
          <p>
            Consuming data from a blockchain requires no transaction, no wallet and no gas. That
            single fact is why the entire living city renders for someone who has never connected
            a wallet — and why the landing page can show live prices with no backend at all.
          </p>
        </>
      ),
    },

    {
      id: "wallet",
      title: "Wallets",
      body: (
        <>
          <p className="doc-lede">
            Optional. The whole game is playable as a guest, and your progress saves against your
            browser.
          </p>

          <h3>What connecting actually does</h3>
          <p>
            You sign one message proving the wallet is yours. It <b>costs no gas</b> and{" "}
            <b>authorises no transactions</b> — a signature is not a transaction. The server
            checks it against a single-use code that expires in five minutes, so a captured
            signature can't be replayed.
          </p>

          <h3>What happens to your progress</h3>
          <ul className="doc-list">
            <li>Guest progress is carried over to the wallet, not reset.</li>
            <li>If that wallet has played from another browser, its existing save is restored instead.</li>
            <li>Your floors, balance and shards follow the wallet from then on.</li>
          </ul>

          <Callout tone="note" title="Don't have a wallet?">
            You don't need one to play. If you want one, MetaMask is the common choice. The game
            will offer to add Robinhood Chain automatically — you don't have to configure
            anything by hand.
          </Callout>
        </>
      ),
    },

    {
      id: "faq",
      title: "Questions & troubleshooting",
      body: (
        <>
          <div className="faq">
            <Faq q="Does any of this cost money?">
              No. Playing is free, reading prices from the chain is free, and there's no way to
              deposit. $BLOCK is an in-game currency with no cash value.
            </Faq>
            <Faq q="Are the prices real?">
              Yes, and you can verify it. The strip under the hero on the home page shows the
              block number the prices were read at. Every feed is a public Chainlink aggregator
              on Robinhood Chain, readable by anyone.
            </Faq>
            <Faq q="Why is the city dark and foggy?">
              The US market is closed. Equity feeds are frozen at their last price, so the city
              is idle. Head to Crypto Alley — those feeds run 24/7 and that district stays live.
            </Faq>
            <Faq q="Why does every tower say 'calm'?">
              Volatility is measured from a rolling window of prices, so after a server restart
              it takes several twenty-second polls to build up enough history. Tiers populate
              within a few minutes.
            </Faq>
            <Faq q="Nothing is rendering — the screen is black.">
              Check the diagnostics panel in the top right. If <b>city built</b> says no but
              towers shows 38, the renderer failed. If towers shows 0, the game server isn't
              reachable.
            </Faq>
            <Faq q="Can I lose my floors?">
              No. Once leased, a floor is yours. Even if a company's feed were discontinued, the
              tower would freeze rather than be removed, and your deed would remain valid.
            </Faq>
            <Faq q="Is $BLOCK tradeable?">
              Not today. The contracts are written and tested but not deployed, and making the
              token transferable is gated behind an external security audit and legal review.
              This is deliberate — see the whitepaper.
            </Faq>
            <Faq q="Where's the full technical detail?">
              The{" "}
              <a href="/whitepaper" target="_blank" rel="noreferrer noopener">
                whitepaper
              </a>{" "}
              covers the architecture, economy, threat model and risks in about five thousand
              words.
            </Faq>
          </div>
        </>
      ),
    },
  ];
}

function Callout({
  tone,
  title,
  children,
}: {
  tone: "note" | "do" | "warn";
  title: string;
  children: ReactNode;
}) {
  return (
    <div className={`doc-callout ${tone}`}>
      <p className="dc-title">{title}</p>
      <p className="dc-body">{children}</p>
    </div>
  );
}

function Faq({ q, children }: { q: string; children: ReactNode }) {
  return (
    <details className="faq-item">
      <summary>
        {q}
        <span className="faq-plus" aria-hidden="true" />
      </summary>
      <p>{children}</p>
    </details>
  );
}

export { LINKS };
