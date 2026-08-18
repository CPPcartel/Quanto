import { useEffect, useState, type ReactElement } from "react";
import { linkProps, navigate, type Route } from "./router";
import { LINKS, isConfigured } from "./links";
import { connectOnly, currentAccount, shortAddress, watchWallet, hasWallet } from "../net/wallet";

/** Site header. Sticky, hairline, terminal-grade. */
export function Nav({ route }: { route: Route }) {
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const items: Array<[Route, string]> = [
    ["/", "Home"],
    ["/docs", "Docs"],
  ];

  return (
    <header className={`nav ${scrolled ? "nav-solid" : ""}`}>
      <a className="brand" {...linkProps("/")}>
        <Mark />
        <span>CANDLESTICK<em>CITY</em></span>
      </a>

      <nav className={`nav-links ${menuOpen ? "open" : ""}`}>
        {items.map(([to, label]) => (
          <a
            key={to}
            className={route === to ? "on" : ""}
            {...linkProps(to)}
            onClick={(e) => {
              linkProps(to).onClick(e);
              setMenuOpen(false);
            }}
          >
            {label}
          </a>
        ))}

        {/*
          Points at the HTML viewer, not the .pdf — a direct file link gets
          grabbed by download managers before the browser ever renders it.
        */}
        <a
          href="/whitepaper"
          target="_blank"
          rel="noreferrer noopener"
          onClick={() => setMenuOpen(false)}
        >
          Whitepaper
          <svg className="ext" viewBox="0 0 12 12" width="9" height="9" aria-hidden="true">
            <path
              d="M4.5 1.5h6v6M10.5 1.5L5 7M8 10.5H1.5V4"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </a>

        <span className="nav-sep" />
        <Social />
      </nav>

      <div className="nav-right">
        <WalletButton />
        <button className="enter" onClick={() => navigate("/play")}>
          Enter the city
        </button>
        <button
          className="burger"
          aria-label="Menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((v) => !v)}
        >
          <span />
          <span />
        </button>
      </div>
    </header>
  );
}

/** A candlestick that is also a building — the identity in one glyph. */
export function Mark({ size = 22 }: { size?: number }) {
  return (
    <svg
      className="mark"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      role="img"
      aria-label="Candlestick City"
    >
      <line x1="7" y1="2" x2="7" y2="22" stroke="currentColor" strokeWidth="1.2" opacity="0.55" />
      <rect x="4" y="7" width="6" height="12" fill="currentColor" />
      <rect x="5.4" y="9" width="1.4" height="1.6" fill="#08090D" />
      <rect x="7.8" y="9" width="1.4" height="1.6" fill="#08090D" />
      <rect x="5.4" y="12.4" width="1.4" height="1.6" fill="#08090D" />
      <rect x="7.8" y="12.4" width="1.4" height="1.6" fill="#08090D" />

      <line x1="17" y1="5" x2="17" y2="22" stroke="currentColor" strokeWidth="1.2" opacity="0.55" />
      <rect x="14" y="11" width="6" height="8" fill="currentColor" opacity="0.75" />
      <rect x="15.4" y="13" width="1.4" height="1.6" fill="#08090D" />
      <rect x="17.8" y="13" width="1.4" height="1.6" fill="#08090D" />
    </svg>
  );
}

function WalletButton() {
  const [address, setAddress] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    currentAccount().then(setAddress);
    return watchWallet((next) => setAddress(next));
  }, []);

  const connect = async () => {
    setBusy(true);
    setError("");
    try {
      setAddress(await connectOnly());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setTimeout(() => setError(""), 4000);
    } finally {
      setBusy(false);
    }
  };

  if (address) {
    return (
      <span className="wallet-pill" title={address}>
        <span className="dot" />
        {shortAddress(address)}
      </span>
    );
  }

  return (
    <span className="wallet-slot">
      <button className="ghost" onClick={connect} disabled={busy}>
        {busy ? "Connecting…" : hasWallet() ? "Connect wallet" : "Get a wallet"}
      </button>
      {error && <span className="wallet-error">{error}</span>}
    </span>
  );
}

export function Social({ compact = false }: { compact?: boolean }) {
  const entries: Array<[string, string, ReactElement]> = [
    [
      "X",
      LINKS.x,
      <path
        key="x"
        d="M2 2 L8.6 11 L2.3 18 H4.2 L9.5 12.2 L13.8 18 H18 L11 8.5 L16.9 2 H15 L10.1 7.4 L6.2 2 Z"
        fill="currentColor"
      />,
    ],
    [
      "Telegram",
      LINKS.telegram,
      <path
        key="tg"
        d="M18.4 2.5 L1.9 8.9 c-1 .4-1 1.3 .1 1.6 l4.2 1.3 1.6 4.9 c.2 .6 .5 .8 1 .4 l2.4-1.9 4.1 3 c.8 .4 1.3 .2 1.5-.7 L19.6 3.6 c.2-1-.4-1.4-1.2-1.1 Z M7.6 12.1 l8.2-5.1 c.4-.2 .7 0 .4 .3 l-6.7 6 -.3 3 Z"
        fill="currentColor"
      />,
    ],
  ];

  return (
    <span className={`social ${compact ? "compact" : ""}`}>
      {entries.map(([label, url, path]) => {
        const live = isConfigured(url);
        return live ? (
          <a
            key={label}
            href={url}
            target="_blank"
            rel="noreferrer noopener"
            aria-label={label}
            title={label}
          >
            <svg viewBox="0 0 20 20" width="15" height="15" aria-hidden="true">
              {path}
            </svg>
          </a>
        ) : (
          <span key={label} className="social-off" title={`${label} — link not set yet`}>
            <svg viewBox="0 0 20 20" width="15" height="15" aria-hidden="true">
              {path}
            </svg>
          </span>
        );
      })}
    </span>
  );
}

export function Footer() {
  return (
    <footer className="site-foot">
      <div className="foot-grid">
        <div>
          <a className="brand" {...linkProps("/")}>
            <Mark size={18} />
            <span>CANDLESTICK<em>CITY</em></span>
          </a>
          <p className="foot-note">
            A city built from live market data, on Robinhood Chain.
          </p>
          <Social />
        </div>

        <div>
          <h4>Play</h4>
          <a {...linkProps("/play")}>Enter the city</a>
          <a {...linkProps("/docs")}>How it works</a>
        </div>

        <div>
          <h4>Read</h4>
          <a href="/whitepaper" target="_blank" rel="noreferrer noopener">
            Whitepaper
          </a>
          <a {...linkProps("/docs")}>Documentation</a>
        </div>

        <div>
          <h4>Chain</h4>
          <a href="https://robinhoodchain.blockscout.com" target="_blank" rel="noreferrer noopener">
            Explorer
          </a>
          <a href="https://docs.robinhood.com/chain/" target="_blank" rel="noreferrer noopener">
            Robinhood Chain
          </a>
        </div>
      </div>

      <div className="foot-legal">
        <span>Chain 4663 · price data by Chainlink</span>
        <span>
          Not investment advice. $BLOCK is an in-game currency with no cash value.
        </span>
      </div>
    </footer>
  );
}
