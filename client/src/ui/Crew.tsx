import { useState, useEffect, useSyncExternalStore } from "react";
import { world, subscribeUi, getUiVersion } from "../net/world";
import { createCrew, joinCrew, leaveCrew, onCrewResult, type CrewOutcome } from "../net/connection";

/**
 * Crew panel.
 *
 * Two states, and the difference matters: unaffiliated players see the two ways
 * *in* (found one, or join one by tag), members see what their crew is worth.
 * Showing both at once would put a "leave" button in front of somebody who has
 * not joined anything.
 *
 * Every result here comes from the server — nothing is applied optimistically,
 * because a tag collision or a full crew is decided there and a hopeful local
 * update would just have to be taken back.
 */

const CREW_COLORS = ["#22e8ff", "#ff2d95", "#ffb347", "#3bff8f", "#a855f7", "#ff6b6b"];

export function CrewPanelBody({ onClose }: { onClose: () => void }) {
  useSyncExternalStore(subscribeUi, getUiVersion);
  const crew = world.crew;

  const [mode, setMode] = useState<"join" | "create">("join");
  const [name, setName] = useState("");
  const [tag, setTag] = useState("");
  const [color, setColor] = useState(CREW_COLORS[0]);
  const [flash, setFlash] = useState<CrewOutcome | null>(null);

  useEffect(() => onCrewResult(setFlash), []);

  // Clear the banner rather than leaving a stale "tag is taken" on screen after
  // the player has already fixed it.
  useEffect(() => {
    if (!flash) return;
    const id = setTimeout(() => setFlash(null), 4000);
    return () => clearTimeout(id);
  }, [flash]);

  return (
    <>
        <div className="crew-head">
          <span className="wallet-label">CREW</span>
          <button className="link tiny" onClick={onClose}>
            close
          </button>
        </div>

        {crew ? (
          <>
            <div className="crew-identity">
              <span className="crew-dot" style={{ background: crew.color }} />
              <div>
                <p className="crew-name">{crew.name}</p>
                <p className="dim tiny mono">
                  [{crew.tag}] · {crew.members} member{crew.members === 1 ? "" : "s"}
                  {crew.isLeader ? " · you lead" : ""}
                </p>
              </div>
            </div>

            <div className="crew-stat">
              <span className="dim tiny">Pooled holdings</span>
              <span className="mono">{crew.floors} floors</span>
            </div>
            <p className="dim tiny crew-note">
              Pooled floors decide tower control. Yield stays with whoever bought the floor.
            </p>

            <button className="ghost-btn" onClick={() => leaveCrew()}>
              {crew.isLeader && crew.members > 1 ? "Leave (hands over lead)" : "Leave crew"}
            </button>
          </>
        ) : (
          <>
            <div className="board-tabs">
              <button className={mode === "join" ? "on" : ""} onClick={() => setMode("join")}>
                Join
              </button>
              <button className={mode === "create" ? "on" : ""} onClick={() => setMode("create")}>
                Found
              </button>
            </div>

            {mode === "join" ? (
              <>
                <label className="field-label dim tiny">Crew tag</label>
                <input
                  className="text-input mono"
                  value={tag}
                  maxLength={5}
                  placeholder="BULL"
                  onChange={(e) => setTag(e.target.value.toUpperCase())}
                  onKeyDown={(e) => e.stopPropagation()}
                />
                <button
                  className="primary-btn"
                  disabled={tag.length < 2}
                  onClick={() => joinCrew(tag)}
                >
                  Join [{tag || "····"}]
                </button>
              </>
            ) : (
              <>
                <label className="field-label dim tiny">Name</label>
                <input
                  className="text-input"
                  value={name}
                  maxLength={24}
                  placeholder="The Bulls"
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => e.stopPropagation()}
                />

                <label className="field-label dim tiny">Tag (2–5)</label>
                <input
                  className="text-input mono"
                  value={tag}
                  maxLength={5}
                  placeholder="BULL"
                  onChange={(e) => setTag(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
                  onKeyDown={(e) => e.stopPropagation()}
                />

                <div className="swatches">
                  {CREW_COLORS.map((c) => (
                    <button
                      key={c}
                      className={`swatch ${color === c ? "on" : ""}`}
                      style={{ background: c }}
                      aria-label={`Crew colour ${c}`}
                      onClick={() => setColor(c)}
                    />
                  ))}
                </div>

                <button
                  className="primary-btn"
                  disabled={name.trim().length < 3 || tag.length < 2}
                  onClick={() => createCrew(name.trim(), tag, color)}
                >
                  Found crew
                </button>
              </>
            )}
          </>
        )}

        {flash && (
          <p className={`flash tiny ${flash.ok ? "ok" : "bad"}`}>
            {flash.ok ? `You're in [${flash.crew.tag}].` : flash.reason}
          </p>
        )}
    </>
  );
}
