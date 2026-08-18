import { useEffect, useState } from "react";

/**
 * In-game help. Opens over the city rather than navigating away, so a new
 * player can read the rules without losing their session.
 */
export function Docs({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<"play" | "earn" | "control" | "market" | "wallet">("play");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="overlay docs-overlay" onClick={onClose}>
      <div className="docs" onClick={(e) => e.stopPropagation()}>
        <header className="docs-head">
          <div>
            <p className="wallet-label">HANDBOOK</p>
            <h2>Candlestick City</h2>
          </div>
          <button className="link" onClick={onClose}>
            close (esc)
          </button>
        </header>

        <nav className="docs-tabs">
          {(
            [
              ["play", "How to play"],
              ["earn", "Making money"],
              ["control", "Turf & trading"],
              ["market", "The market"],
              ["wallet", "Wallet"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              className={`docs-tab ${tab === id ? "on" : ""}`}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </nav>

        <div className="docs-body">
          {tab === "play" && (
            <>
              <p className="lede">
                Every tower in this city is a real company, and its height is that company's
                real, live share price. You're not looking at a chart — you're standing in one.
              </p>

              <h3>Controls</h3>
              <table className="docs-table">
                <tbody>
                  <tr>
                    <td>
                      <kbd>W</kbd> <kbd>A</kbd> <kbd>S</kbd> <kbd>D</kbd>
                    </td>
                    <td>Walk</td>
                  </tr>
                  <tr>
                    <td>
                      <kbd>Shift</kbd>
                    </td>
                    <td>Run</td>
                  </tr>
                  <tr>
                    <td>scroll</td>
                    <td>Zoom, from street level out to the whole city</td>
                  </tr>
                  <tr>
                    <td>
                      <kbd>M</kbd>
                    </td>
                    <td>Snap between street and map view</td>
                  </tr>
                  <tr>
                    <td>click</td>
                    <td>Inspect a tower from anywhere</td>
                  </tr>
                  <tr>
                    <td>
                      <kbd>Space</kbd>
                    </td>
                    <td>During a shift, hit the green band</td>
                  </tr>
                </tbody>
              </table>

              <h3>The four districts</h3>
              <ul>
                <li>
                  <b>Tech Row</b> — Apple, NVIDIA, Microsoft. Tall and volatile.
                </li>
                <li>
                  <b>Crypto Alley</b> — Bitcoin, Ethereum. The only district that never sleeps.
                </li>
                <li>
                  <b>Moonshot Mile</b> — Tesla, GameStop, quantum and rockets. Wildest swings.
                </li>
                <li>
                  <b>Index Plaza</b> — broad funds and metals. Low, steady, dependable.
                </li>
              </ul>
            </>
          )}

          {tab === "earn" && (
            <>
              <p className="lede">
                Three ways to earn, and they feed each other. <b>CHARGE</b> is energy — it
                refills on its own, one point every five minutes.
              </p>

              <h3>1 · Work a shift</h3>
              <p>
                Walk up to a tower and clock in. A marker sweeps a bar; hit <kbd>Space</kbd>{" "}
                inside the green band three times. Pays more for accuracy, and more again if
                that company is having a volatile day. Costs 12 CHARGE.
              </p>
              <p className="dim small">
                Needs nothing but time, so a new player always has a way to earn.
              </p>

              <h3>2 · Lease a floor</h3>
              <p>
                Buy a floor and <b>one window lights up</b> on that tower — permanently, for
                everyone. It then earns you $BLOCK forever, with no effort.
              </p>
              <p className="dim small">
                Every lit window in the skyline is a floor a real player owns. The city's glow
                is the player economy.
              </p>

              <h3>3 · Run a storm</h3>
              <p>
                When a real company gets genuinely volatile, a storm breaks over its tower and
                shards scatter through the streets for three minutes. Run over them to collect.
                First touch wins. Free to join.
              </p>

              <h3>4 · Mount a neon sign</h3>
              <p>
                Once you own a floor somewhere, craft a sign — five characters, your colour —
                and hang it on that building. Everyone sees it, and it earns a cut from
                passers-by. Costs 8 shards, 120 $BLOCK and 20 CHARGE.
              </p>
            </>
          )}

          {tab === "control" && (
            <>
              <p className="lede">
                Floors aren't just income — they're territory. Whoever holds the most floors in
                a tower puts their name on it, and takes a cut of everyone else's earnings
                there.
              </p>

              <h3>Becoming a landlord</h3>
              <p>
                Hold the largest share of a tower's floors <b>and</b> at least <b>25%</b> of the
                whole building. Below that threshold the tower has no landlord at all — one
                floor in a building nobody wants shouldn't make you its owner.
              </p>
              <p>
                Your name appears above the building, in your crew's colour. Walk down a street
                and you can read who runs it.
              </p>

              <h3>Royalties</h3>
              <p>
                A landlord takes <b>10%</b> of what other owners earn in that tower. It's paid
                from the yield as it's calculated, so you collect whether or not you're online —
                and it's the reason a tower is worth fighting over.
              </p>
              <p className="dim small">
                Crew-controlled towers pay no royalty. Taking a building together is its own
                reward; taxing your own crewmates isn't.
              </p>

              <h3>Crews</h3>
              <p>
                A crew pools its members' floors <b>for control only</b> — every floor, and
                every coin it earns, stays with whoever bought it. That means joining a crew
                costs you nothing and leaving takes nothing from you.
              </p>
              <p>
                Control goes to whichever is larger: the biggest individual holding, or the
                biggest crew total. A group of small holders can take a tower off someone who
                outspent all of them.
              </p>

              <h3>The floor market</h3>
              <p>
                List any floor you own at your own price, and buy from other players. Prices
                here are set by people, not by the volatility formula — the market panel shows
                each asking price against what the tower itself would charge, so you can tell a
                bargain from a fleecing.
              </p>
              <p>
                A listed floor keeps earning until it sells, and either side can be offline. The
                floor and the money move together or not at all.
              </p>

              <h3>Parks</h3>
              <p>
                The green lots and the fountain plaza aren't only scenery. Stand in one and
                your <b>CHARGE refills three times faster</b> — and CHARGE is what gates
                everything active you can do, so a park is somewhere to actually go, not
                just somewhere to look at.
              </p>
              <p>
                Resting costs nothing and earns no $BLOCK. It only speeds up a bar that was
                always going to refill, which is why you can do it as long as you like.
              </p>
              <p className="dim small">
                During a volatility storm, shards prefer open ground — so parks and the
                central plaza are where the good runs are.
              </p>

              <h3>Talking</h3>
              <p>
                Press <b>Enter</b> to chat. You're heard by players standing near you, or by
                everyone in your district on the district channel. There's no city-wide channel
                — a place where every word reaches everyone stops feeling like a place.
              </p>
            </>
          )}

          {tab === "market" && (
            <>
              <p className="lede">
                The city reads live prices from Chainlink on Robinhood Chain, every 20 seconds.
                Those feeds are only live when the US stock market is open.
              </p>

              <h3>Market open</h3>
              <p>
                Weekdays, 9:30am–4pm New York time. Towers move, storms can break, floors pay
                full rate, shifts pay best.
              </p>

              <h3>After hours</h3>
              <p>
                The skyline freezes at the last price, fog rolls in, the city dims. Most floors
                stop earning entirely — but Crypto Alley keeps running, because crypto trades
                around the clock.
              </p>

              <h3>Why that matters</h3>
              <p>
                Floors in Crypto Alley earn all week but swing harder. Floors in Index Plaza
                are dependable but idle two-thirds of the time. That trade-off comes from real
                market structure, not a designer's dial.
              </p>

              <h3>Yield tiers</h3>
              <p>
                Payouts are bucketed by how volatile a company currently is —{" "}
                <span className="tier tier-calm">calm</span>,{" "}
                <span className="tier tier-normal">normal</span>,{" "}
                <span className="tier tier-hot">hot</span>,{" "}
                <span className="tier tier-extreme">extreme</span> — at 1× up to 3.5×. Nothing
                pays more for a stock going up than down.
              </p>
            </>
          )}

          {tab === "wallet" && (
            <>
              <p className="lede">
                You can play the entire game as a guest. Connecting a wallet is optional, and
                only matters when you want ownership to be real.
              </p>

              <h3>What connecting does</h3>
              <p>
                You sign one message proving the wallet is yours. It <b>costs no gas</b> and{" "}
                <b>authorises no transactions</b>. Your guest progress carries over — and if
                that wallet has played from another browser, its save is restored instead.
              </p>

              <h3>What's on the blockchain, and what isn't</h3>
              <p>
                Walking, chat, weather and minigames run on the game server many times a second
                and never touch the chain. Only ownership and money settle on-chain, in
                batches. That's why nothing here makes you wait for a confirmation.
              </p>
              <p className="dim small">
                Reading prices is free — displaying this entire living city costs nothing
                on-chain, which is why it works with no wallet at all.
              </p>

              <h3>Not connected yet?</h3>
              <p>
                You'll need a browser wallet such as MetaMask. The game will offer to add
                Robinhood Chain automatically if your wallet doesn't know it.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
