import { useScrollProgress } from "./motion";

/**
 * The page is one trading day, and scrolling is time passing.
 *
 * This fixed readout maps scroll position onto the session clock: you enter at
 * 04:00 in the dark, the bell rings around a fifth of the way down, and you
 * leave after the close. It's the connective device that makes the page a
 * narrative rather than a list of sections — and it doubles as a scroll
 * progress indicator without looking like one.
 */

const DAY_START = 4 * 60; // 04:00
const DAY_END = 20 * 60; // 20:00

function label(minutes: number) {
  if (minutes < 9 * 60 + 30) return { text: "PRE-MARKET", tone: "dim" };
  if (minutes < 16 * 60) return { text: "MARKET OPEN", tone: "open" };
  return { text: "AFTER HOURS", tone: "closed" };
}

export function MarketClock() {
  const progress = useScrollProgress();
  const minutes = DAY_START + (DAY_END - DAY_START) * progress;
  const hh = String(Math.floor(minutes / 60)).padStart(2, "0");
  const mm = String(Math.floor(minutes % 60)).padStart(2, "0");
  const state = label(minutes);

  // The bell sits at 09:30 — mark it so the jump is legible on the track.
  const bellAt = ((9 * 60 + 30 - DAY_START) / (DAY_END - DAY_START)) * 100;
  const closeAt = ((16 * 60 - DAY_START) / (DAY_END - DAY_START)) * 100;

  return (
    <aside className="clock" aria-hidden="true">
      <div className="clock-face">
        <span className="clock-time">
          {hh}
          <em>:</em>
          {mm}
        </span>
        <span className={`clock-state ${state.tone}`}>{state.text}</span>
      </div>

      <div className="clock-track">
        <span className="clock-mark" style={{ left: `${bellAt}%` }} data-label="09:30" />
        <span className="clock-mark" style={{ left: `${closeAt}%` }} data-label="16:00" />
        <span className="clock-fill" style={{ height: `${progress * 100}%` }} />
      </div>
    </aside>
  );
}
