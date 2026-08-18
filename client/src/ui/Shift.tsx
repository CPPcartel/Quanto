import { useEffect, useRef, useState } from "react";
import {
  onShiftStart,
  onShiftFinish,
  finishShift,
  type ShiftSpec,
  type ShiftFinishOutcome,
} from "../net/connection";
import { isTyping } from "./keyboard";

/**
 * The Order Execution minigame.
 *
 * A marker sweeps the bar; hit SPACE inside the green band, three times. The
 * client only reports *when* each press happened — the server owns the target
 * positions and recomputes the score itself, so a modified client cannot
 * invent a better result than perfect play.
 */
export function ShiftGame() {
  const [spec, setSpec] = useState<ShiftSpec | null>(null);
  const [round, setRound] = useState(0);
  const [result, setResult] = useState<ShiftFinishOutcome | null>(null);
  const [marker, setMarker] = useState(0);

  const startedAt = useRef(0);
  const presses = useRef<number[]>([]);
  const raf = useRef(0);

  useEffect(() => {
    const off = onShiftStart((r) => {
      if (!r.ok) return;
      setSpec(r.spec);
      setResult(null);
      setRound(0);
      presses.current = [];
      startedAt.current = performance.now();
    });
    return () => {
      off();
    };
  }, []);

  useEffect(() => {
    const off = onShiftFinish((r) => {
      setResult(r);
      setSpec(null);
      setTimeout(() => setResult(null), 3200);
    });
    return () => {
      off();
    };
  }, []);

  // Drive the sweeping marker. Same triangle wave the server uses to score.
  useEffect(() => {
    if (!spec) return;
    const tick = () => {
      const ms = performance.now() - startedAt.current;
      const phase = (ms / 1000 / spec.sweepSec) % 1;
      setMarker(phase < 0.5 ? phase * 2 : 2 - phase * 2);
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [spec]);

  useEffect(() => {
    if (!spec) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "Space") return;
      // Space is a legitimate character in chat, a crew name or a sign. Without
      // this the shift swallowed it — you could not type a space during a
      // shift, and the keystroke was scored as a press.
      if (isTyping()) return;
      e.preventDefault();

      presses.current.push(performance.now() - startedAt.current);
      const next = round + 1;

      if (next >= spec.rounds) {
        finishShift(spec.shiftId, presses.current);
        setSpec(null);
      } else {
        setRound(next);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [spec, round]);

  if (result) {
    return (
      <div className="hud shift-overlay">
        <div className="panel">
          {result.ok ? (
            <>
              <h2 className="up">Shift complete</h2>
              <p className="small dim">
                {result.symbol} · {result.tier} tier · {Math.round(result.accuracy * 100)}% accuracy
              </p>
              <p className="payout mono">+{result.paid} $BLOCK</p>
            </>
          ) : (
            <>
              <h2 className="down">Shift failed</h2>
              <p className="small dim">{result.reason}</p>
            </>
          )}
        </div>
      </div>
    );
  }

  if (!spec) return null;

  const target = spec.targets[round] ?? 0.5;

  return (
    <div className="hud shift-overlay">
      <div className="panel shift-panel">
        <div className="row space">
          <h2>Order Execution · {spec.symbol}</h2>
          <span className="mono small dim">
            {round + 1}/{spec.rounds}
          </span>
        </div>

        <div className="shift-bar">
          <div
            className="shift-band"
            style={{
              left: `${Math.max(0, (target - spec.band) * 100)}%`,
              width: `${spec.band * 200}%`,
            }}
          />
          <div className="shift-marker" style={{ left: `${marker * 100}%` }} />
        </div>

        <p className="keys">
          Hit <kbd>Space</kbd> inside the green band
        </p>
      </div>
    </div>
  );
}
