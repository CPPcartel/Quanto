import { useState, useEffect, useSyncExternalStore, useMemo } from "react";
import { world, subscribeUi, getUiVersion } from "../net/world";
import {
  listFloor,
  cancelListing,
  buyListing,
  onMarketResult,
  type MarketOutcome,
} from "../net/connection";

/**
 * Floor market.
 *
 * Prices here are set by players, not by the volatility formula — that is the
 * whole point of the feature, so the panel puts the asking price next to what
 * the tower would charge you directly. Without that comparison a listing is
 * just a number and nobody can tell a bargain from a fleecing.
 *
 * The Buy button never settles anything locally. Ownership, balance and whether
 * the listing still exists are all decided inside one server transaction; the
 * client only asks and reports what came back.
 */

export function MarketPanelBody({ onClose }: { onClose: () => void }) {
  useSyncExternalStore(subscribeUi, getUiVersion);

  const [tab, setTab] = useState<"browse" | "sell">("browse");
  const [symbol, setSymbol] = useState("");
  const [price, setPrice] = useState("");
  const [flash, setFlash] = useState<MarketOutcome | null>(null);
  /** Listings we've asked about, so the button can't be mashed mid-round-trip. */
  const [pending, setPending] = useState<number | null>(null);

  useEffect(
    () =>
      onMarketResult((r) => {
        setFlash(r);
        setPending(null);
      }),
    []
  );

  useEffect(() => {
    if (!flash) return;
    const id = setTimeout(() => setFlash(null), 4500);
    return () => clearTimeout(id);
  }, [flash]);

  const listings = world.listings;
  const mine = listings.filter((l) => l.mine);
  const theirs = listings.filter((l) => !l.mine);

  /** Towers where the player actually holds a floor — the only sellable ones. */
  const sellable = useMemo(
    () => [...world.tickers.values()].filter((t) => t.myFloors > 0).sort((a, b) => a.symbol.localeCompare(b.symbol)),
    // Recomputed on every UI notification; myFloors lives outside React state.
    [getUiVersion()]
  );

  const askFor = (l: (typeof listings)[number]) => {
    const tower = world.tickers.get(l.symbol);
    if (!tower || !tower.floorPrice) return null;
    const delta = ((l.price - tower.floorPrice) / tower.floorPrice) * 100;
    return { direct: tower.floorPrice, delta };
  };

  return (
    <>
        <div className="crew-head">
          <span className="wallet-label">FLOOR MARKET</span>
          <button className="link tiny" onClick={onClose}>
            close
          </button>
        </div>

        <div className="board-tabs">
          <button className={tab === "browse" ? "on" : ""} onClick={() => setTab("browse")}>
            Browse ({theirs.length})
          </button>
          <button className={tab === "sell" ? "on" : ""} onClick={() => setTab("sell")}>
            Sell ({mine.length})
          </button>
        </div>

        {tab === "browse" ? (
          theirs.length === 0 ? (
            <p className="dim tiny">
              Nothing for sale. List one of your own floors and name your price.
            </p>
          ) : (
            <div className="listings">
              {theirs.map((l) => {
                const ask = askFor(l);
                const affordable = world.block >= l.price;
                return (
                  <div className="listing-row" key={l.id}>
                    <div className="listing-main">
                      <span className="mono listing-sym">{l.symbol}</span>
                      <span className="dim tiny">{l.sellerName}</span>
                    </div>
                    <div className="listing-price">
                      <span className="mono">{l.price} $B</span>
                      {ask && (
                        <span className={`tiny ${ask.delta <= 0 ? "ok" : "dim"}`}>
                          {ask.delta <= 0 ? "" : "+"}
                          {ask.delta.toFixed(0)}% vs tower
                        </span>
                      )}
                    </div>
                    <button
                      className="primary-btn tiny-btn"
                      disabled={!affordable || pending === l.id}
                      title={affordable ? undefined : "Not enough $BLOCK"}
                      onClick={() => {
                        setPending(l.id);
                        buyListing(l.id);
                      }}
                    >
                      {pending === l.id ? "…" : "Buy"}
                    </button>
                  </div>
                );
              })}
            </div>
          )
        ) : (
          <>
            {mine.length > 0 && (
              <div className="listings">
                {mine.map((l) => (
                  <div className="listing-row" key={l.id}>
                    <div className="listing-main">
                      <span className="mono listing-sym">{l.symbol}</span>
                      <span className="dim tiny">your listing</span>
                    </div>
                    <div className="listing-price">
                      <span className="mono">{l.price} $B</span>
                    </div>
                    <button className="ghost-btn tiny-btn" onClick={() => cancelListing(l.id)}>
                      Cancel
                    </button>
                  </div>
                ))}
              </div>
            )}

            {sellable.length === 0 ? (
              <p className="dim tiny">
                You don't own a floor yet. Walk up to a tower and lease one first.
              </p>
            ) : (
              <>
                <label className="field-label dim tiny">Tower</label>
                <select
                  className="text-input mono"
                  value={symbol}
                  onChange={(e) => setSymbol(e.target.value)}
                  onKeyDown={(e) => e.stopPropagation()}
                >
                  <option value="">select…</option>
                  {sellable.map((t) => (
                    <option key={t.symbol} value={t.symbol}>
                      {t.symbol}. You hold {t.myFloors}
                    </option>
                  ))}
                </select>

                <label className="field-label dim tiny">
                  Asking price
                  {symbol && world.tickers.get(symbol)?.floorPrice
                    ? ` (tower charges ${world.tickers.get(symbol)!.floorPrice})`
                    : ""}
                </label>
                <input
                  className="text-input mono"
                  inputMode="numeric"
                  value={price}
                  placeholder="120"
                  onChange={(e) => setPrice(e.target.value.replace(/[^0-9]/g, ""))}
                  onKeyDown={(e) => e.stopPropagation()}
                />

                <button
                  className="primary-btn"
                  disabled={!symbol || Number(price) < 1}
                  onClick={() => {
                    listFloor(symbol, Number(price));
                    setPrice("");
                  }}
                >
                  List floor
                </button>
                <p className="dim tiny crew-note">
                  A listed floor keeps earning until it sells.
                </p>
              </>
            )}
          </>
        )}

        {flash && (
          <p className={`flash tiny ${flash.ok ? "ok" : "bad"}`}>
            {flash.ok ? flash.message : flash.reason}
          </p>
        )}
    </>
  );
}
