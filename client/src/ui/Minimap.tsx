import { useEffect, useRef } from "react";
import { world } from "../net/world";

/**
 * Live overhead map.
 *
 * Drawn straight to a canvas from the mutable world state rather than through
 * React, so it can refresh smoothly without re-rendering the HUD. Uses raw
 * world coordinates (not the isometric projection) because a map reads best
 * as a plan view.
 */

const SIZE = 150;
const WORLD_EXTENT = 210; // world units from centre to edge

const DISTRICT_TINT: Record<string, string> = {
  tech: "#22e8ff",
  crypto: "#ffb347",
  moonshot: "#ff2d95",
  index: "#3bff8f",
};

export function Minimap() {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const ctx = el.getContext("2d");
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    el.width = SIZE * dpr;
    el.height = SIZE * dpr;
    ctx.scale(dpr, dpr);

    let raf = 0;
    const toMap = (v: number) => (v / WORLD_EXTENT) * (SIZE / 2) + SIZE / 2;

    const draw = () => {
      ctx.clearRect(0, 0, SIZE, SIZE);

      ctx.fillStyle = "#0b0d14";
      ctx.fillRect(0, 0, SIZE, SIZE);

      // District wash, so the quadrants are recognisable at a glance.
      for (const district of world.districts) {
        ctx.fillStyle = DISTRICT_TINT[district.id] ?? "#22e8ff";
        ctx.globalAlpha = 0.07;
        ctx.beginPath();
        ctx.arc(toMap(district.cx), toMap(district.cz), 34, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }

      // Towers: brighter when players own floors there.
      world.tickers.forEach((t) => {
        const x = toMap(t.x);
        const y = toMap(t.z);
        const owned = t.totalFloors > 0 ? t.ownedFloors / t.totalFloors : 0;
        const size = 2.5 + Math.min(2.5, t.height / 28);

        ctx.fillStyle = t.frozen
          ? "#39415a"
          : t.changePct >= 0
            ? "#3bff8f"
            : "#ff6b6b";
        ctx.globalAlpha = 0.55 + owned * 0.45;
        ctx.fillRect(x - size / 2, y - size / 2, size, size);
        ctx.globalAlpha = 1;
      });

      // Storm ring — the thing you most want to find quickly.
      if (world.stormSymbol) {
        const t = world.tickers.get(world.stormSymbol);
        if (t) {
          const pulse = 8 + Math.sin(performance.now() / 220) * 3;
          ctx.strokeStyle = "#ff2d95";
          ctx.lineWidth = 1.5;
          ctx.globalAlpha = 0.9;
          ctx.beginPath();
          ctx.arc(toMap(t.x), toMap(t.z), pulse, 0, Math.PI * 2);
          ctx.stroke();
          ctx.globalAlpha = 1;
        }
      }

      // Other players.
      ctx.fillStyle = "#9aa2b8";
      world.remotes.forEach((remote) => {
        const last = remote.buffer[remote.buffer.length - 1];
        if (!last) return;
        ctx.fillRect(toMap(last.x) - 1, toMap(last.z) - 1, 2, 2);
      });

      // You, with a heading tick so the map is orientable.
      const px = toMap(world.local.x);
      const py = toMap(world.local.z);
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(px, py, 3.5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(px - 1, py - 1, 2, 2);

      raf = requestAnimationFrame(draw);
    };

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className="hud minimap">
      <div className="panel compact">
        <canvas ref={canvas} style={{ width: SIZE, height: SIZE, display: "block" }} />
        <div className="minimap-legend">
          {world.districts.map((d) => (
            <span key={d.id} style={{ color: DISTRICT_TINT[d.id] }}>
              ■ {d.name.split(" ")[0]}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
