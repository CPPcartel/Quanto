import { useEffect, useRef, useState } from "react";
import { formatPrice, type Reading } from "./feeds";

/**
 * The live hero.
 *
 * Every bar is a real company, its height derived from that company's actual
 * share price read from Robinhood Chain moments ago, drawn as a candlestick
 * with a wick and a lit facade. It is simultaneously a skyline and a chart,
 * which is the entire product thesis rendered rather than described.
 *
 * Drawn to canvas rather than SVG because of the window grid: a few thousand
 * small rectangles per frame is trivial for canvas and miserable for the DOM.
 */

const BASELINE = 0.74; // fraction of canvas height where the street sits
const REVEAL_MS = 1500;

interface Bar {
  reading: Reading;
  /** 0..1 target height, from log-normalised price. */
  target: number;
  /** Eased render height. */
  current: number;
  /** Deterministic per-building window pattern. */
  seed: number;
}

function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967295;
}

/** Log scale, or Bitcoin at $63k would be 2,600× taller than GameStop at $24. */
function normalise(readings: Reading[]) {
  const logs = readings.map((r) => Math.log10(Math.max(1, r.price)));
  const min = Math.min(...logs);
  const max = Math.max(...logs);
  const span = max - min || 1;
  return logs.map((v) => 0.3 + ((v - min) / span) * 0.7);
}

export function Skyline({ readings, live }: { readings: Reading[]; live: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const barsRef = useRef<Bar[]>([]);
  const [hover, setHover] = useState<Reading | null>(null);
  const [hoverX, setHoverX] = useState(0);

  // Keep the bar list in a ref so the animation loop never restarts on data.
  useEffect(() => {
    const heights = normalise(readings);
    const next: Bar[] = readings.map((reading, i) => {
      const existing = barsRef.current.find((b) => b.reading.symbol === reading.symbol);
      return {
        reading,
        target: heights[i],
        current: existing?.current ?? 0,
        seed: hash(reading.symbol),
      };
    });
    barsRef.current = next;
  }, [readings]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let width = 0;
    let height = 0;
    let dpr = 1;

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = wrap.clientWidth;
      height = wrap.clientHeight;
      canvas.width = Math.max(1, Math.floor(width * dpr));
      canvas.height = Math.max(1, Math.floor(height * dpr));
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();

    const observer = new ResizeObserver(resize);
    observer.observe(wrap);

    const started = performance.now();
    let raf = 0;

    const draw = (now: number) => {
      const bars = barsRef.current;
      const baseline = height * BASELINE;
      const maxBar = baseline - 26;

      ctx.clearRect(0, 0, width, height);

      // --- sky ------------------------------------------------------------
      const sky = ctx.createLinearGradient(0, 0, 0, baseline);
      sky.addColorStop(0, "#080A11");
      sky.addColorStop(0.65, "#0D1119");
      sky.addColorStop(1, "#141A26");
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, width, baseline);

      // --- distant haze layer ---------------------------------------------
      ctx.fillStyle = "#10141D";
      const farCount = Math.ceil(width / 26);
      for (let i = 0; i < farCount; i++) {
        const s = hash(`far${i}`);
        const w = 14 + s * 16;
        const h = (0.12 + s * 0.3) * maxBar;
        ctx.fillRect(i * 26 + s * 6, baseline - h, w, h);
      }

      if (bars.length === 0) {
        raf = requestAnimationFrame(draw);
        return;
      }

      // --- main bars -------------------------------------------------------
      const gap = 6;
      const slot = width / bars.length;
      const barW = Math.max(10, slot - gap);
      const elapsed = now - started;

      bars.forEach((bar, i) => {
        // Staggered grow-in, then continuous easing toward live values.
        const delay = (i / bars.length) * 400;
        const revealT = reduced ? 1 : Math.min(1, Math.max(0, (elapsed - delay) / REVEAL_MS));
        const eased = 1 - Math.pow(1 - revealT, 3);
        bar.current += (bar.target * eased - bar.current) * 0.12;

        const h = Math.max(2, bar.current * maxBar);
        const x = Math.round(i * slot + gap / 2);
        const y = baseline - h;

        const r = bar.reading;
        const up = r.drift >= 0;
        const body = r.frozen ? "#39415A" : up ? "#1F8A57" : "#B4433A";
        const face = r.frozen ? "#2C3348" : up ? "#186E45" : "#8F352E";
        const neon = r.frozen ? "#5D6A8F" : up ? "#3BFF8F" : "#FF6B6B";

        // candlestick wick — the high, drawn above the roof
        ctx.strokeStyle = neon;
        ctx.globalAlpha = 0.35;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x + barW / 2, y - 12 - bar.seed * 10);
        ctx.lineTo(x + barW / 2, y);
        ctx.stroke();
        ctx.globalAlpha = 1;

        // body: lit face and shadowed side, so it reads as a solid volume
        ctx.fillStyle = face;
        ctx.fillRect(x, y, barW, h);
        ctx.fillStyle = body;
        ctx.fillRect(x, y, barW * 0.62, h);

        // roofline
        ctx.fillStyle = neon;
        ctx.globalAlpha = 0.85;
        ctx.fillRect(x, y, barW, 2);
        ctx.globalAlpha = 1;

        // --- windows ------------------------------------------------------
        const cols = Math.max(2, Math.floor(barW / 9));
        const rows = Math.floor(h / 11);
        const winW = 4;
        const winH = 5;
        const padX = (barW - cols * 9) / 2 + 2;

        for (let c = 0; c < cols; c++) {
          for (let rIdx = 0; rIdx < rows; rIdx++) {
            const n = hash(`${r.symbol}:${c}:${rIdx}`);
            if (n < 0.42) continue; // dark window — nobody home

            // Occasional slow flicker, so the facade feels inhabited.
            const flicker = reduced ? 1 : 0.75 + Math.sin(now / 700 + n * 40) * 0.25;
            ctx.globalAlpha = (r.frozen ? 0.3 : 0.85) * flicker;
            ctx.fillStyle = n > 0.93 ? neon : "#FFC46B";
            ctx.fillRect(
              Math.round(x + padX + c * 9),
              Math.round(y + 6 + rIdx * 11),
              winW,
              winH
            );
          }
        }
        ctx.globalAlpha = 1;

        // rooftop beacon
        if (bar.seed > 0.55) {
          const blink = reduced ? 1 : (Math.sin(now / 400 + bar.seed * 12) + 1) / 2;
          ctx.globalAlpha = 0.35 + blink * 0.65;
          ctx.fillStyle = neon;
          ctx.fillRect(x + barW / 2 - 1, y - 4, 2, 3);
          ctx.globalAlpha = 1;
        }
      });

      // --- wet street reflection -------------------------------------------
      ctx.save();
      ctx.globalAlpha = 0.16;
      ctx.translate(0, baseline * 2);
      ctx.scale(1, -1);
      bars.forEach((bar, i) => {
        const h = Math.max(2, bar.current * maxBar) * 0.55;
        const x = Math.round(i * slot + gap / 2);
        const r = bar.reading;
        ctx.fillStyle = r.frozen ? "#39415A" : r.drift >= 0 ? "#1F8A57" : "#B4433A";
        ctx.fillRect(x, baseline - h, barW, h);
      });
      ctx.restore();

      // street surface fade
      const street = ctx.createLinearGradient(0, baseline, 0, height);
      street.addColorStop(0, "rgba(8,10,17,0.2)");
      street.addColorStop(1, "#08090D");
      ctx.fillStyle = street;
      ctx.fillRect(0, baseline, width, height - baseline);

      // horizon line
      ctx.strokeStyle = "rgba(120,140,190,0.25)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, baseline + 0.5);
      ctx.lineTo(width, baseline + 0.5);
      ctx.stroke();

      raf = requestAnimationFrame(draw);
    };

    raf = requestAnimationFrame(draw);

    // --- pointer picking ---------------------------------------------------
    const onMove = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const bars = barsRef.current;
      if (bars.length === 0) return;
      const index = Math.floor((x / rect.width) * bars.length);
      const bar = bars[Math.max(0, Math.min(bars.length - 1, index))];
      setHover(bar?.reading ?? null);
      setHoverX(x);
    };
    const onLeave = () => setHover(null);

    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerleave", onLeave);

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerleave", onLeave);
    };
  }, []);

  return (
    <div className="skyline" ref={wrapRef}>
      <canvas ref={canvasRef} aria-label="Live skyline built from real stock prices" role="img" />

      {hover && (
        <div
          className="skyline-tip"
          style={{ left: `clamp(4rem, ${hoverX}px, calc(100% - 4rem))` }}
        >
          <b>{hover.symbol}</b>
          <span>${formatPrice(hover.price)}</span>
          <span className={hover.frozen ? "flat" : hover.drift >= 0 ? "up" : "down"}>
            {hover.frozen
              ? "frozen"
              : `${hover.drift >= 0 ? "+" : ""}${hover.drift.toFixed(3)}%`}
          </span>
        </div>
      )}

      <div className="skyline-status">
        <span className={live ? "pulse live" : "pulse"} />
        {live ? "reading live feeds" : "connecting to chain…"}
      </div>
    </div>
  );
}
