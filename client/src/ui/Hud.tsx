import { useSyncExternalStore, useEffect, useState, useRef } from "react";
import { world, subscribeUi, getUiVersion, type TickerView } from "../net/world";
import {
  setName,
  buyFloor,
  onBuyResult,
  startShift,
  placeSign,
  onSignResult,
  onShardsCollected,
  type BuyOutcome,
} from "../net/connection";
import { formatPrice, formatAge } from "./format";
import { clockLabel } from "../pixi/daylight";
import { isTyping } from "./keyboard";
import { ShiftGame } from "./Shift";
import { Minimap } from "./Minimap";
import { WalletPanel } from "./Wallet";
import { AccountPanel } from "./Account";
import { privyEnabled } from "../auth/PrivyGate";
import { Docs } from "./Docs";
import { ChatPanel } from "./Chat";
import { Dock, type DockHandle } from "./Dock";
import { ClubBanner, ClubDoor, ClubAudioToggle } from "./Club";

const SIGN_COLORS = ["#22E8FF", "#FF2D95", "#FFB347", "#3BFF8F", "#A855F7"];

/** Re-renders only when the coalesced UI notifier fires (~5Hz), never per frame. */
function useWorld() {
  useSyncExternalStore(subscribeUi, getUiVersion);
  return world;
}

export function Hud() {
  const w = useWorld();
  const dock = useRef<DockHandle>(null);

  if (w.debug.fatal) {
    return (
      <div className="overlay center">
        <div className="panel error-panel">
          <h2>Renderer failed to start</h2>
          <p className="mono small">{w.debug.fatal}</p>
          <p className="dim small">
            This is a graphics problem, not a network one. Your browser may be blocking WebGL.
          </p>
        </div>
      </div>
    );
  }

  if (w.conn === "error") {
    return (
      <div className="overlay center">
        <div className="panel error-panel">
          <h2>Can't reach the city</h2>
          <p>{w.error}</p>
          <p className="dim">
            Start the game server with <code>npm run dev</code> in the <code>server</code> folder,
            then reload.
          </p>
        </div>
      </div>
    );
  }

  if (w.conn === "connecting") {
    return (
      <div className="overlay center">
        <div className="panel">
          <h2>Entering Quanto…</h2>
          <p className="dim">Connecting to the game server</p>
        </div>
      </div>
    );
  }

  return (
    <>
      <TickerTape />
      <TopLeft />
      <Wallet />
      <Inspector />
      <Controls />
      <ZoomIndicator />
      <DebugReadout />
      <ShiftGame />
      <StormBanner />
      <ShardToast />
      <Minimap />
      {/* Privy replaces the raw wallet flow when configured; the older
          sign-a-message panel remains the fallback for guest-only builds. */}
      {privyEnabled ? <AccountPanel /> : <WalletPanel />}
      <Leaderboard />
      <Dock ref={dock} />
      <ClubBanner />
      <ClubDoor />
      <ClubAudioToggle />
      {/* Clicking a name in chat opens a conversation with them in the dock,
          rather than adding a fifth floating panel to the middle of the screen. */}
      <ChatPanel onWhisper={(session, name) => dock.current?.whisper(session, name)} />
      <HelpButton />
    </>
  );
}

/** Opens the handbook over the city. New players land here first. */
function HelpButton() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping()) return;
      if (e.key === "?" || e.code === "F1") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <>
      <div className="hud help-button">
        <button className="help" onClick={() => setOpen(true)} title="Handbook (?)">
          ?
        </button>
      </div>
      {open && <Docs onClose={() => setOpen(false)} />}
    </>
  );
}

/**
 * Rankings. Player boards come from the server's cached snapshot; the towers
 * tab is derived locally from ticker state, since that one is about the city
 * rather than the players and is the clearest expression of the lit-window
 * mechanic.
 */
const TABS: Array<{ id: string; label: string; unit: string; seasonal?: boolean }> = [
  { id: "floors", label: "Floors", unit: "" },
  { id: "wealth", label: "Richest", unit: "$B" },
  { id: "runners", label: "Runners", unit: "◆", seasonal: true },
  { id: "season_earned", label: "Weekly", unit: "$B", seasonal: true },
  { id: "crews", label: "Crews", unit: "" },
  { id: "towers", label: "Towers", unit: "" },
];

function Leaderboard() {
  const w = useWorld();
  // Open by default: collapsed, this was a thin unlabelled bar at the bottom of
  // the screen that nobody would think to click.
  const [open, setOpen] = useState(true);
  const [tab, setTab] = useState("floors");

  const towerRows = [...w.tickers.values()]
    .filter((t) => t.ownedFloors > 0)
    .sort((a, b) => b.ownedFloors - a.ownedFloors)
    .slice(0, 8);

  const playerRows = w.boards.filter((b) => b.board === tab).slice(0, 8);
  const active = TABS.find((t) => t.id === tab);
  const maxScore = Math.max(1, ...playerRows.map((r) => r.score));

  return (
    <div className="hud leaderboard">
      <div className="panel compact">
        <button className="board-toggle" onClick={() => setOpen((v) => !v)}>
          <span className="wallet-label">LEADERBOARD</span>
          <span className="dim tiny">{open ? "hide" : "show"}</span>
        </button>

        {open && (
          <>
            <div className="board-tabs">
              {TABS.map((t) => (
                <button
                  key={t.id}
                  className={tab === t.id ? "on" : ""}
                  onClick={() => setTab(t.id)}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {active?.seasonal && w.seasonLabel && (
              <p className="board-season mono tiny">{w.seasonLabel}</p>
            )}

            <div className="board">
              {tab === "towers" ? (
                towerRows.length === 0 ? (
                  <p className="dim tiny">Nobody owns a floor yet. Be first.</p>
                ) : (
                  towerRows.map((t, i) => (
                    <div className="board-row" key={t.symbol}>
                      <span className="board-rank mono">{i + 1}</span>
                      <span className="mono">{t.symbol}</span>
                      <span className="board-bar">
                        <span
                          className="board-fill"
                          style={{
                            width: `${t.totalFloors ? (t.ownedFloors / t.totalFloors) * 100 : 0}%`,
                          }}
                        />
                      </span>
                      <span className="mono tiny dim">
                        {t.ownedFloors}/{t.totalFloors}
                      </span>
                    </div>
                  ))
                )
              ) : playerRows.length === 0 ? (
                <p className="dim tiny">
                  No entries yet — boards refresh about once a minute.
                </p>
              ) : (
                playerRows.map((r) => (
                  <div className="board-row" key={`${r.board}-${r.rank}`}>
                    <span className="board-rank mono">{r.rank}</span>
                    {/* On the crews board the `wallet` column carries the crew
                        colour rather than an address, so it tints the row
                        instead of becoming a tooltip full of hex. */}
                    <span
                      className={`board-name mono ${
                        tab !== "crews" && r.name === w.localName ? "me" : ""
                      }`}
                      title={tab === "crews" ? undefined : r.wallet || undefined}
                      style={tab === "crews" && r.wallet ? { color: r.wallet } : undefined}
                    >
                      {r.name}
                    </span>
                    <span className="board-bar">
                      <span
                        className="board-fill"
                        style={{ width: `${(r.score / maxScore) * 100}%` }}
                      />
                    </span>
                    <span className="mono tiny dim">
                      {formatScore(r.score)}
                      {active?.unit}
                      {/* Crews carry their member count in `detail`; for player
                          boards it's already implied by the name. */}
                      {tab === "crews" && r.detail ? ` · ${r.detail}` : ""}
                    </span>
                  </div>
                ))
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function formatScore(v: number) {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1000) return `${(v / 1000).toFixed(1)}k`;
  return String(Math.round(v));
}

/** Called out loudly — a storm is the city's only time-boxed live event. */
function StormBanner() {
  const w = useWorld();
  const [left, setLeft] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      setLeft(Math.max(0, world.stormEndsAt - Date.now()));
    }, 500);
    return () => clearInterval(id);
  }, []);

  if (!w.stormSymbol || left <= 0) return null;

  return (
    <div className="hud storm-banner">
      <div className="panel storm-panel">
        <span className="pill pill-storm">VOLATILITY STORM</span>
        <b className="mono">{w.stormSymbol}</b>
        <span className="dim small">
          {w.shards.size} shards loose · {Math.ceil(left / 1000)}s
        </span>
      </div>
    </div>
  );
}

/** Brief confirmation when you sweep up shards, so pickups feel physical. */
function ShardToast() {
  const [count, setCount] = useState(0);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const off = onShardsCollected((n) => {
      setCount((c) => c + n);
      clearTimeout(timer);
      timer = setTimeout(() => setCount(0), 1400);
    });
    return () => {
      off();
      clearTimeout(timer);
    };
  }, []);

  if (count <= 0) return null;
  return (
    <div className="hud shard-toast">
      <div className="panel compact">
        <span className="mono">+{count} shards</span>
      </div>
    </div>
  );
}

/** CHARGE, $BLOCK and shards — the three things the whole loop runs on. */
function Wallet() {
  const w = useWorld();
  const chargePct = Math.max(0, Math.min(100, w.charge));

  return (
    <div className="hud wallet">
      <div className="panel compact">
        <div className="wallet-row">
          <span className="wallet-label">$BLOCK</span>
          <span className="wallet-value mono">{Math.floor(w.block).toLocaleString()}</span>
        </div>
        <div className="wallet-row">
          <span className="wallet-label">SHARDS</span>
          <span className="wallet-value mono">{w.shardCount}</span>
        </div>
        <div className="charge">
          <div className="wallet-row">
            <span className="wallet-label">CHARGE</span>
            <span className="wallet-value mono">{Math.floor(chargePct)}/100</span>
          </div>
          <div className={`charge-bar ${w.resting ? "resting" : ""}`}>
            <div className="charge-fill" style={{ width: `${chargePct}%` }} />
          </div>
          {/* A bonus nobody notices is a bonus nobody walks to, so the HUD
              says it plainly the moment the player steps onto grass. */}
          {w.resting && <p className="resting-note tiny">❋ resting — CHARGE ×3</p>}
        </div>
      </div>
    </div>
  );
}

/**
 * Renderer diagnostics. Distinguishes "network is fine but nothing drew" from
 * "nothing arrived" — the two causes of a blank screen look identical without
 * this.
 */
function DebugReadout() {
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 500);
    return () => clearInterval(id);
  }, []);

  const d = world.debug;
  const ok = d.built && d.fps > 0;

  return (
    <div className="hud debug-readout">
      <div className="panel compact">
        <div className="row space">
          <span className={`pill ${ok ? "pill-ok" : "pill-warn"}`}>RENDER</span>
          <span className="mono tiny">{d.fps} fps</span>
        </div>
        <div className="debug-grid mono tiny">
          <span>canvas</span>
          <span>{d.canvas}</span>
          <span>city built</span>
          <span className={d.built ? "up" : "down"}>{d.built ? "yes" : "no"}</span>
          <span>towers</span>
          <span>{world.tickers.size}</span>
          <span>districts</span>
          <span>{world.districts.length}</span>
          <span>pos</span>
          <span>
            {world.local.x.toFixed(0)}, {world.local.z.toFixed(0)}
          </span>
        </div>
      </div>
    </div>
  );
}

/** Tells you when you've pulled out far enough to enter Skyline Mode. */
function ZoomIndicator() {
  const [zoom, setZoom] = useState(1);
  useEffect(() => {
    const id = setInterval(() => setZoom(world.zoom), 120);
    return () => clearInterval(id);
  }, []);

  // Relative to this window's floor, not a fixed number: on a large monitor
  // the whole city fits at 0.57, so a hardcoded 0.35 would never be reached.
  const skyline = zoom <= world.zoomMin * 1.25;
  return (
    <div className="hud top-right">
      <div className="panel compact">
        <div className="row space">
          <span className={`pill ${skyline ? "pill-closed" : "pill-ok"}`}>
            {skyline ? "SKYLINE MODE" : "STREET"}
          </span>
          <span className="dim tiny mono">{zoom.toFixed(2)}×</span>
        </div>
        <SkyClock />
        <p className="keys">
          <b>drag</b> pan · <b>scroll</b> zoom · <kbd>M</kbd> toggle map
        </p>
        <Recentre />
      </div>
    </div>
  );
}

/**
 * Appears only once the view has been dragged off the player.
 *
 * A free camera with no route back is how somebody concludes the game lost
 * their character. Walking already pulls the view home, but that isn't
 * discoverable — this is.
 */
function Recentre() {
  const [panned, setPanned] = useState(false);
  useEffect(() => {
    const id = setInterval(() => setPanned(world.panned), 150);
    return () => clearInterval(id);
  }, []);

  if (!panned) return null;
  return (
    <button
      className="ghost-btn recentre-btn"
      onClick={() => {
        world.recentre = true;
      }}
    >
      ⌖ Back to me
    </button>
  );
}

const PHASE_GLYPH: Record<string, string> = {
  night: "☾",
  dawn: "◐",
  day: "☀",
  dusk: "◑",
};

/**
 * Local time and sky phase.
 *
 * Reads the device clock directly on its own interval rather than through the
 * world subscription — the sky follows this machine's time, so it should keep
 * ticking whether or not the server has anything to say.
 */
function SkyClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const phase = world.daylight?.phase ?? "night";
  return (
    <div className="row space sky-clock">
      <span className="dim tiny">
        {PHASE_GLYPH[phase] ?? "☾"} {phase}
      </span>
      <span className="dim tiny mono" title="Your device's local time — the sky follows it">
        {clockLabel(now)}
      </span>
    </div>
  );
}

function TopLeft() {
  const w = useWorld();
  const open = w.phase === "open";
  const district = nearestDistrict();

  return (
    <div className="hud top-left">
      <div className="panel">
        <div className="row">
          <span className={`pill ${open ? "pill-open" : "pill-closed"}`}>
            {open ? "MARKET OPEN" : "AFTER HOURS"}
          </span>
          <span className={`pill ${w.oracleOk ? "pill-ok" : "pill-warn"}`}>
            {w.oracleOk ? "ORACLE LIVE" : "ORACLE COLD"}
          </span>
        </div>

        <h1>{district?.name ?? "Quanto"}</h1>
        <p className="dim small">{district?.blurb ?? "A city built from live market data."}</p>

        <dl className="stats">
          <div>
            <dt>Market mood</dt>
            <dd className={w.marketMood >= 0 ? "up" : "down"}>
              {w.marketMood >= 0 ? "+" : ""}
              {w.marketMood.toFixed(3)}%
            </dd>
          </div>
          <div>
            <dt>Most volatile</dt>
            <dd>{w.peakSymbol || "—"}</dd>
          </div>
          <div>
            <dt>Players</dt>
            <dd>{w.remotes.size + 1}</dd>
          </div>
        </dl>

        {!open && (
          <p className="note">
            Equity feeds are frozen at the last close. Crypto Alley is still live.
          </p>
        )}
      </div>
    </div>
  );
}

/** Scrolling tape of every tracked feed, sorted by absolute move. */
function TickerTape() {
  const w = useWorld();
  const items = [...w.tickers.values()].sort(
    (a, b) => Math.abs(b.changePct) - Math.abs(a.changePct)
  );
  if (items.length === 0) return null;

  return (
    <div className="tape">
      <div className="tape-track">
        {[...items, ...items].map((t, i) => (
          <span className="tape-item" key={`${t.symbol}-${i}`}>
            <b>{t.symbol}</b>
            <span className="tape-price">${formatPrice(t.price)}</span>
            <span className={t.frozen ? "flat" : t.changePct >= 0 ? "up" : "down"}>
              {t.frozen ? "◆" : `${t.changePct >= 0 ? "▲" : "▼"} ${Math.abs(t.changePct).toFixed(2)}%`}
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}

/** Details for whichever building you're standing closest to. */
function Inspector() {
  const [near, setNear] = useState<TickerView | null>(null);

  useEffect(() => {
    const id = setInterval(() => {
      // A clicked building wins over proximity, so you can inspect a tower
      // across the street without walking to it.
      let best: TickerView | null = world.selected
        ? (world.tickers.get(world.selected) ?? null)
        : null;

      if (!best) {
        let bestDist = 42;
        world.tickers.forEach((t) => {
          const d = Math.hypot(t.x - world.local.x, t.z - world.local.z);
          if (d < bestDist) {
            bestDist = d;
            best = t;
          }
        });
      }

      world.nearest = best;
      setNear((prev) => (prev?.symbol === (best as TickerView | null)?.symbol ? prev : best));
    }, 200);
    return () => clearInterval(id);
  }, []);

  if (!near) return null;
  const t = near;
  const age = t.updatedAt ? Date.now() / 1000 - t.updatedAt : 0;

  return (
    <div className="hud bottom-right">
      <div className="panel">
        <div className="row space">
          <h2>{t.symbol}</h2>
          <span className={`pill ${t.frozen ? "pill-closed" : "pill-open"}`}>
            {t.frozen ? "FROZEN" : "LIVE"}
          </span>
        </div>
        <p className="dim small">{t.label}</p>

        <div className="price-row">
          <span className="price">${formatPrice(t.price)}</span>
          <span className={t.changePct >= 0 ? "up" : "down"}>
            {t.changePct >= 0 ? "+" : ""}
            {t.changePct.toFixed(2)}%
          </span>
        </div>

        <dl className="stats">
          <div>
            <dt>Height</dt>
            <dd>{t.height.toFixed(1)}m</dd>
          </div>
          <div>
            <dt>Yield tier</dt>
            <dd className={`tier tier-${t.tier}`}>{t.tier}</dd>
          </div>
          <div>
            <dt>Feed age</dt>
            <dd>{formatAge(age)}</dd>
          </div>
        </dl>

        <FloorPanel ticker={t} />

        <p className="dim tiny">Chainlink feed on Robinhood Chain · updates every 20s</p>
      </div>
    </div>
  );
}

/**
 * Lease floors in the building you're standing next to. Each floor you own
 * lights one window on this tower for everyone in the city to see.
 */
function FloorPanel({ ticker }: { ticker: TickerView }) {
  const w = useWorld();
  const [flash, setFlash] = useState<BuyOutcome | null>(null);

  useEffect(() => {
    const unsubscribe = onBuyResult((r) => {
      setFlash(r);
      setTimeout(() => setFlash(null), 2600);
    });
    return () => {
      unsubscribe();
    };
  }, []);

  const full = ticker.totalFloors > 0 && ticker.ownedFloors >= ticker.totalFloors;
  const tooPoor = w.block < ticker.floorPrice;
  const occupancy = ticker.totalFloors > 0 ? (ticker.ownedFloors / ticker.totalFloors) * 100 : 0;

  return (
    <div className="floors">
      <div className="row space">
        <span className="wallet-label">FLOORS</span>
        <span className="mono small">
          {ticker.ownedFloors}/{ticker.totalFloors} leased
        </span>
      </div>

      <div className="occupancy">
        <div className="occupancy-fill" style={{ width: `${occupancy}%` }} />
      </div>

      {ticker.myFloors > 0 && (
        <p className="mine small">
          You own <b>{ticker.myFloors}</b> {ticker.myFloors === 1 ? "floor" : "floors"} here
        </p>
      )}

      <button
        className="buy"
        disabled={full || tooPoor}
        onClick={() => buyFloor(ticker.symbol)}
      >
        {full ? "Fully leased" : `Lease a floor · ${ticker.floorPrice} $BLOCK`}
      </button>

      {flash && (
        <p className={`flash small ${flash.ok ? "up" : "down"}`}>
          {flash.ok ? `Leased a floor in ${flash.symbol} — window lit.` : flash.reason}
        </p>
      )}

      {ticker.frozen && (
        <p className="dim tiny">Feed frozen — floors here earn nothing until the market reopens.</p>
      )}

      <button className="shift" onClick={() => startShift(ticker.symbol)}>
        Work a shift · 12 CHARGE
      </button>

      <SignCrafter ticker={ticker} />
    </div>
  );
}

/** Craft and mount a neon sign — needs a floor here, shards, and $BLOCK. */
function SignCrafter({ ticker }: { ticker: TickerView }) {
  const w = useWorld();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [color, setColor] = useState(SIGN_COLORS[0]);
  const [flash, setFlash] = useState<BuyOutcome | null>(null);

  useEffect(() => {
    const off = onSignResult((r) => {
      setFlash(r);
      if (r.ok) {
        setOpen(false);
        setText("");
      }
      setTimeout(() => setFlash(null), 2600);
    });
    return () => {
      off();
    };
  }, []);

  const canMount = ticker.myFloors > 0;

  if (!open) {
    return (
      <>
        <button className="sign-toggle" disabled={!canMount} onClick={() => setOpen(true)}>
          {canMount ? "Mount a neon sign" : "Lease a floor to mount a sign"}
        </button>
        {flash && (
          <p className={`flash small ${flash.ok ? "up" : "down"}`}>
            {flash.ok ? "Sign is up — the whole city can see it." : flash.reason}
          </p>
        )}
      </>
    );
  }

  return (
    <div className="crafter">
      <div className="row space">
        <span className="wallet-label">NEON SIGN</span>
        <button className="link" onClick={() => setOpen(false)}>
          cancel
        </button>
      </div>

      <input
        autoFocus
        value={text}
        maxLength={5}
        placeholder="5 chars"
        onChange={(e) => setText(e.target.value)}
      />

      <div className="swatches">
        {SIGN_COLORS.map((c) => (
          <button
            key={c}
            className={`swatch ${c === color ? "on" : ""}`}
            style={{ background: c, boxShadow: c === color ? `0 0 8px ${c}` : "none" }}
            onClick={() => setColor(c)}
            aria-label={`colour ${c}`}
          />
        ))}
      </div>

      <p className="dim tiny">
        Costs 8 shards + 120 $BLOCK + 20 CHARGE · you have {w.shardCount} shards
      </p>

      <button
        className="buy"
        disabled={!text.trim() || w.shardCount < 8 || w.block < 120}
        onClick={() => placeSign(ticker.symbol, text.trim(), color)}
      >
        Mount on {ticker.symbol}
      </button>
    </div>
  );
}

function Controls() {
  const w = useWorld();
  const [name, setLocalName] = useState("");
  const [editing, setEditing] = useState(false);

  return (
    <div className="hud bottom-left">
      <div className="panel compact">
        <div className="row space">
          <span className="dim small">
            <b style={{ color: w.localColor }}>{w.localName}</b>
          </span>
          <button className="link" onClick={() => setEditing((v) => !v)}>
            {editing ? "cancel" : "rename"}
          </button>
        </div>

        {editing && (
          <form
            className="row"
            onSubmit={(e) => {
              e.preventDefault();
              if (name.trim()) setName(name.trim());
              setEditing(false);
              setLocalName("");
            }}
          >
            <input
              autoFocus
              value={name}
              maxLength={16}
              placeholder="your name"
              onChange={(e) => setLocalName(e.target.value)}
            />
            <button type="submit">set</button>
          </form>
        )}

        <p className="keys">
          <kbd>W</kbd>
          <kbd>A</kbd>
          <kbd>S</kbd>
          <kbd>D</kbd> move · <kbd>Shift</kbd> run
        </p>
      </div>
    </div>
  );
}

function nearestDistrict() {
  let best = null;
  let bestDist = Infinity;
  for (const d of world.districts) {
    const dist = Math.hypot(d.cx - world.local.x, d.cz - world.local.z);
    if (dist < bestDist) {
      bestDist = dist;
      best = d;
    }
  }
  return bestDist < 90 ? best : null;
}

