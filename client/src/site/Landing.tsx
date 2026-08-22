import type { ReactNode } from "react";
import { useChainFeeds, formatPrice, FEEDS } from "./feeds";
import { Skyline } from "./Skyline";
import { navigate, linkProps } from "./router";
import { LINKS } from "./links";
import { MarketClock } from "./MarketClock";
import { DistrictExplorer, FloorDemo, Stat } from "./Interactive";
import { useReveal, useElementProgress } from "./motion";

/**
 * The landing page, structured as one trading day.
 *
 * Scrolling is time passing: you arrive before dawn, the bell rings a fifth of
 * the way down, volatility breaks in the afternoon, and the city goes dark at
 * the close. The MarketClock in the corner reads out where you are. That gives
 * the page a spine — each section is a moment in a session rather than an
 * entry in a feature list — and it's the same rhythm the game itself runs on.
 */
export function Landing() {
  const chain = useChainFeeds();

  const movers = [...chain.readings]
    .sort((a, b) => Math.abs(b.drift) - Math.abs(a.drift))
    .slice(0, 6);

  const frozen = chain.readings.filter((r) => r.frozen).length;

  return (
    <main className="site">
      <MarketClock />

      {/* ============ HERO ============ */}
      <section className="hero">
        <Skyline readings={chain.readings} live={chain.live} />

        <div className="hero-copy">
          <p className="eyebrow">
            <span className={chain.marketOpen ? "pip open" : "pip closed"} />
            {chain.marketOpen
              ? "US market open · the city is awake"
              : "after hours · the city sleeps"}
          </p>

          <h1>
            The skyline
            <br />
            <span className="is">is</span> the chart.
          </h1>

          <p className="lede">
            Every tower is a real company. Its height is that company's live share price, read
            from Chainlink on Robinhood Chain. Walk through a market instead of looking at one.
          </p>

          <div className="cta-row">
            <button className="primary" onClick={() => navigate("/play")}>
              Enter the city
              <span className="free">free · no wallet needed</span>
            </button>
            <a className="secondary" {...linkProps("/docs")}>
              How it works
            </a>
          </div>

          <p className="scroll-hint">
            <span className="scroll-line" />
            scroll. The page runs a trading day
          </p>
        </div>

        <ChainStrip
          block={chain.blockNumber}
          feeds={chain.readings.length}
          live={chain.live}
          open={chain.marketOpen}
        />
      </section>

      {/* ============ TAPE ============ */}
      <section className="tape-band" aria-label="Live prices">
        <div className="tape-inner">
          {[...chain.readings, ...chain.readings].map((r, i) => (
            <span className="tick" key={`${r.symbol}-${i}`}>
              <b>{r.symbol}</b>
              <span className="px">${formatPrice(r.price)}</span>
              <span className={r.frozen ? "flat" : r.drift >= 0 ? "up" : "down"}>
                {r.frozen ? "◆" : `${r.drift >= 0 ? "▲" : "▼"}${Math.abs(r.drift).toFixed(2)}%`}
              </span>
            </span>
          ))}
        </div>
      </section>

      {/* ============ 04:00 PREMISE ============ */}
      <Band time="04:00" tag="pre-market" title="Markets are drawn as charts. Nobody lives in a chart.">
        <div className="two-col">
          <div>
            <p>
              A price is an abstraction you read at arm's length. A city is somewhere you stand.
              Quanto is the second thing wearing the first: about forty companies,
              each one a tower, each tower's height its live share price.
            </p>
            <p>
              When NVIDIA runs, the tower beside you grows. When the tape turns red, it rains.
              When Wall Street closes, the lights go out and fog rolls down the street.
            </p>
            <p className="muted">
              This hasn't been buildable before. It needs a chain that carries real equity price
              feeds as a native primitive, and until Robinhood Chain there wasn't one.
            </p>
          </div>

          <Panel title="Why it couldn't exist" >
            <ul className="reasons">
              <li>
                <b>Price feeds</b>: most chains carry crypto pairs only. Equities are the hard
                part, and they're the whole idea here.
              </li>
              <li>
                <b>Reads are free</b>: the city renders from on-chain data without a wallet, a
                transaction, or a cent of gas.
              </li>
              <li>
                <b>Fair ordering</b>: Robinhood Chain sequences first-come-first-served, so
                contested actions resolve on arrival, not on who bids highest.
              </li>
            </ul>
          </Panel>
        </div>
      </Band>

      {/* ============ 09:30 THE BELL ============ */}
      <BellSection open={chain.marketOpen} />

      {/* ============ 10:00 DISTRICTS ============ */}
      <Band time="10:04" tag="the grid" title="Four districts, grouped the way the market groups.">
        <p className="band-lede">
          Pick one. These are live prices, right now, from the same feeds the game reads.
        </p>
        <DistrictExplorer readings={chain.readings} />
      </Band>

      {/* ============ 11:20 FLOORS ============ */}
      <Band
        time="11:20"
        tag="ownership"
        title="Every lit window is somebody."
        alt
      >
        <div className="two-col">
          <div>
            <p>
              Buy a floor in a tower and one window lights up, permanently, visible to every
              other player in the city. A dark building means nobody owns it. A blazing one is
              contested real estate somebody paid for.
            </p>
            <p>
              That floor earns while its company's feed is live, at a rate set by how volatile
              that company currently is. Calm blue chips pay steadily. Wild names pay more and
              go quiet more often.
            </p>
            <p className="muted">
              The skyline's glow isn't decoration. It's the player economy, rendered: readable
              from three streets away without opening a single menu.
            </p>
          </div>
          <FloorDemo />
        </div>
      </Band>

      {/* ============ 12:40 THE LOOP ============ */}
      <Band time="12:40" tag="the loop" title="Three ways to earn. They feed each other.">
        <div className="verbs">
          <Verb
            n="01"
            title="Work a shift"
            body="Clock in at any tower and hit a ten-second timing game. Scored on the server, paid out against that company's volatility tier."
            cost="costs energy · needs no capital"
          />
          <Verb
            n="02"
            title="Run a storm"
            body="When a real ticker spikes, shards scatter through the streets for three minutes. First touch wins. Everyone online drops what they're doing."
            cost="free · unpredictable by design"
          />
          <Verb
            n="03"
            title="Lease a floor"
            body="Spend once, earn continuously. Your window stays lit whether you're online or not, as long as that market is open."
            cost="the endgame · passive income"
          />
        </div>

        <div className="energy-note">
          <span className="en-k">CHARGE</span>
          <p>
            Energy regenerates at one point every five minutes, capped at 100. It gates the
            active verbs, so the loop rewards checking in a few times a day rather than leaving
            a script running overnight.
          </p>
        </div>
      </Band>

      {/* ============ 14:15 STORM ============ */}
      <StormSection movers={movers} />

      {/* ============ 16:00 CLOSE ============ */}
      <Band
        time="16:00"
        tag="the close"
        title="At four o'clock, the city goes dark."
        alt
      >
        <div className="two-col reverse">
          <div>
            <p>
              Robinhood's equity feeds publish 24/5. When Wall Street shuts they hold their last
              price, so the skyline freezes with them, fog closes in, and floors stop paying.
            </p>
            <p>
              Crypto Alley stays lit, because crypto genuinely doesn't sleep. That's a real
              strategic asymmetry, and it comes from market structure rather than a designer
              turning a dial.
            </p>
            <p className="muted">
              Right now:{" "}
              <b className={chain.marketOpen ? "up" : "down"}>
                {chain.marketOpen
                  ? "open: towers are moving"
                  : `closed: ${frozen} of ${chain.readings.length} feeds frozen`}
              </b>
            </p>
          </div>

          <Panel title={chain.marketOpen ? "Live now" : "Frozen at last close"}>
            <div className="movers">
              {movers.length === 0 && <p className="muted small">Waiting for the tape…</p>}
              {movers.map((r) => (
                <div className="mover" key={r.symbol}>
                  <b>{r.symbol}</b>
                  <span className="muted">{r.name}</span>
                  <span className="px">${formatPrice(r.price)}</span>
                  <span className={r.frozen ? "flat" : r.drift >= 0 ? "up" : "down"}>
                    {r.frozen ? "frozen" : `${r.drift >= 0 ? "+" : ""}${r.drift.toFixed(3)}%`}
                  </span>
                </div>
              ))}
            </div>
          </Panel>
        </div>
      </Band>

      {/* ============ 17:30 THE STACK ============ */}
      <Band time="17:30" tag="the stack" title="Built so nothing makes you wait.">
        <p className="band-lede">
          Most onchain games are unpleasant because they put everything on chain. Walking becomes
          a transaction. This one draws a hard line.
        </p>

        <div className="stack">
          <div className="stack-col">
            <h4 className="s-off">Game server · 20× a second</h4>
            <ul>
              <li>Walking and running</li>
              <li>Chat and nameplates</li>
              <li>Weather and day/night</li>
              <li>The shift minigame</li>
              <li>Grabbing storm shards</li>
            </ul>
            <span className="s-tag">instant · free · never onchain</span>
          </div>

          <div className="stack-mid" aria-hidden="true">
            <span className="s-arrow">settles in batches →</span>
            <span className="s-arrow rev">← prices, every 20s</span>
          </div>

          <div className="stack-col">
            <h4 className="s-on">Robinhood Chain</h4>
            <ul>
              <li>Floor deeds you own</li>
              <li>Your $BLOCK balance</li>
              <li>Earnings, settled</li>
              <li>Trades between players</li>
              <li>Live prices (reading is free)</li>
            </ul>
            <span className="s-tag">permanent · verifiable</span>
          </div>
        </div>
      </Band>

      {/* ============ NUMBERS ============ */}
      <section className="band numbers-band">
        <div className="band-inner">
          <div className="stats">
            <Stat value={FEEDS.length} label="live price feeds" sub="read every 20 seconds" />
            <Stat value={4} label="districts" sub="grouped as the market groups" />
            <Stat value={20} label="server ticks / sec" sub="movement is never onchain" />
            <Stat value={0} label="gas to play" sub="reading a chain is free" />
          </div>
        </div>
      </section>

      {/* ============ FAQ ============ */}
      <Band time="19:00" tag="questions" title="The things people ask first." alt>
        <div className="faq">
          <Faq q="Do I need a wallet?">
            No. An email is enough, and one is created for you in seconds. A wallet only
            matters if you hold a Quanto Residents NFT and want the city to know about it,
            which unlocks holder traits and the door to The Vault.
          </Faq>
          <Faq q="Does it cost anything?">
            No. Playing is free, and reading prices from the chain costs nothing, no
            transaction, no gas. If you connect a wallet, signing in is a signature, not a
            transaction.
          </Faq>
          <Faq q="Are the prices actually real?">
            Yes, and you can check. The strip under the hero shows the block number these prices
            were read at; every feed is a public Chainlink aggregator on Robinhood Chain.
          </Faq>
          <Faq q="Is $BLOCK a real token I can trade?">
            Not today. It's an in-game currency with no cash value. The contracts are written and
            tested but undeployed, and making it transferable is gated behind an external
            security audit and legal review.
          </Faq>
          <Faq q="What happens at the weekend?">
            The equity feeds freeze, so most of the city does too. It becomes building and
            crafting time rather than earning time. Crypto Alley stays live all week.
          </Faq>
          <Faq q="Can I lose money?">
            There's nothing to lose. There's no deposit, no purchase, and no way to put real
            money in.
          </Faq>
        </div>
      </Band>

      {/* ============ CLOSE ============ */}
      <section className="band close">
        <div className="band-inner">
          <p className="sect-num">20:00, and the city is still open</p>
          <h2>
            Everything above is live.
            <br />
            Go and stand in it.
          </h2>
          <p className="muted">
            No download, no wallet, no cost. Sign in with an email, pick a name, and you
            are standing in it.
          </p>
          <button className="primary big" onClick={() => navigate("/play")}>
            Enter the city
          </button>
          <p className="close-links">
            <a {...linkProps("/docs")}>Documentation</a>
            <span>·</span>
            <a href="/whitepaper" target="_blank" rel="noreferrer noopener">
              Whitepaper
            </a>
          </p>
        </div>
      </section>
    </main>
  );
}

/* ------------------------------------------------------------------ */
/* Section primitives                                                  */
/* ------------------------------------------------------------------ */

function Band({
  time,
  tag,
  title,
  children,
  alt,
}: {
  time: string;
  tag: string;
  title: string;
  children: ReactNode;
  alt?: boolean;
}) {
  const { ref, shown } = useReveal();
  return (
    <section className={`band ${alt ? "alt" : ""}`}>
      <div className={`band-inner reveal ${shown ? "in" : ""}`} ref={ref}>
        <p className="sect-num">
          <span className="sect-time">{time}</span>
          <span className="sect-rule" />
          {tag}
        </p>
        <h2>{title}</h2>
        {children}
      </div>
    </section>
  );
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="panel-box">
      <h4>{title}</h4>
      <div className="panel-body">{children}</div>
    </div>
  );
}

function Verb({ n, title, body, cost }: { n: string; title: string; body: string; cost: string }) {
  const { ref, shown } = useReveal(0.3);
  return (
    <article className={`reveal ${shown ? "in" : ""}`} ref={ref}>
      <span className="v-num">{n}</span>
      <h3>{title}</h3>
      <p>{body}</p>
      <span className="v-cost">{cost}</span>
    </article>
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

/**
 * The opening bell. The one section that animates on its own — a hard cut from
 * dark to lit as it enters view, mirroring what the city actually does at 9:30.
 */
function BellSection({ open }: { open: boolean }) {
  const { ref, progress } = useElementProgress<HTMLDivElement>();
  // Light rises through the first half of the section's travel.
  const lit = Math.min(1, Math.max(0, (progress - 0.15) / 0.35));

  return (
    <section className="band bell" ref={ref}>
      <div
        className="bell-wash"
        style={{ opacity: lit * 0.55 }}
        aria-hidden="true"
      />
      <div className="band-inner">
        <p className="sect-num">
          <span className="sect-time">09:30</span>
          <span className="sect-rule" />
          the opening bell
        </p>

        <h2 className="bell-title" style={{ opacity: 0.35 + lit * 0.65 }}>
          Then the bell rings,
          <br />
          and the whole city wakes at once.
        </h2>

        <div className="bell-grid">
          <p>
            At 9:30 New York time the feeds start publishing again. Every tower recalculates,
            the fog lifts, floors begin paying, and storms become possible. It's the same moment
            every weekday, and it's the city's loudest.
          </p>
          <p className="muted">
            Nothing schedules this. There's no timer in the code. The game is simply watching
            real feeds, and real feeds wake up when the market does.
          </p>
        </div>

        <div className="bell-meter" aria-hidden="true">
          {Array.from({ length: 40 }).map((_, i) => (
            <span
              key={i}
              className="bm"
              style={{
                opacity: lit > i / 40 ? 1 : 0.12,
                background: lit > i / 40 ? (i > 30 ? "#3bff8f" : "#22e8ff") : "#2b3040",
              }}
            />
          ))}
        </div>
        <p className="bell-status">
          {open ? "the bell has rung, market is open right now" : "the market is currently closed"}
        </p>
      </div>
    </section>
  );
}

/** Volatility storms, with shards that scatter as the section enters view. */
function StormSection({ movers }: { movers: Array<{ symbol: string; drift: number }> }) {
  const { ref, shown } = useReveal(0.25);
  const top = movers[0];

  return (
    <section className="band storm-band">
      <div className={`band-inner reveal ${shown ? "in" : ""}`} ref={ref}>
        <p className="sect-num">
          <span className="sect-time">14:15</span>
          <span className="sect-rule" />
          volatility storm
        </p>
        <h2>Something spikes. The street fills up.</h2>

        <div className="two-col">
          <div>
            <p>
              When a company's realised volatility crosses a threshold, a storm breaks over its
              tower. Shards scatter through the surrounding streets for about three minutes and
              a warning goes out city-wide.
            </p>
            <p>
              First touch wins, resolved on the server, so there's no way to claim one twice and
              no way to buy your way to the front. Free to join, which is the point. It pulls
              everyone outdoors at the same moment.
            </p>
            <p className="muted">
              Nobody schedules these either. The market does.
            </p>
          </div>

          <div className="storm-vis" aria-hidden="true">
            <div className="storm-tower">
              <span className="st-roof" />
              {top && <span className="st-label">{top.symbol}</span>}
            </div>
            {Array.from({ length: 14 }).map((_, i) => (
              <span
                key={i}
                className={`shard ${shown ? "fly" : ""}`}
                style={{
                  left: `${8 + ((i * 37) % 84)}%`,
                  top: `${18 + ((i * 53) % 66)}%`,
                  animationDelay: `${(i % 7) * 0.18}s`,
                }}
              />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function ChainStrip({
  block,
  feeds,
  live,
  open,
}: {
  block: number | null;
  feeds: number;
  live: boolean;
  open: boolean;
}) {
  return (
    <div className="chain-strip">
      <div>
        <span className="k">network</span>
        <span className="v">Robinhood Chain · 4663</span>
      </div>
      <div>
        <span className="k">block</span>
        <span className="v mono">{block ? block.toLocaleString() : "-"}</span>
      </div>
      <div>
        <span className="k">feeds</span>
        <span className="v mono">{feeds}</span>
      </div>
      <div>
        <span className="k">session</span>
        <span className={`v ${open ? "up" : "down"}`}>{open ? "OPEN" : "CLOSED"}</span>
      </div>
      <div>
        <span className="k">source</span>
        <span className="v">{live ? "Chainlink, onchain" : "connecting…"}</span>
      </div>
    </div>
  );
}
