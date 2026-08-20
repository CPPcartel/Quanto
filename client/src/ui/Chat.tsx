import { useEffect, useRef, useState } from "react";
import { isTyping } from "./keyboard";
import {
  sendChat,
  sendEmote,
  onChat,
  onCrewHistory,
  type IncomingChat,
} from "../net/connection";
import { world } from "../net/world";

/**
 * Chat panel.
 *
 * Three channels: what you can hear from where you're standing, the district
 * around you, and your crew — which is the only one that reaches across the map,
 * because that is the point of being in one.
 *
 * Crew is also the only channel with scrollback. The other two are correctly
 * ephemeral — you had to be standing there — but a crew message posted while you
 * were asleep should still be waiting, so the server replays the last of them on
 * join and they are folded in below.
 *
 * Enter opens the input and sends; Escape closes it — so walking and talking
 * never fight over the keyboard, which is the usual way chat in a game with WASD
 * movement goes wrong.
 */

const EMOTES: Array<[string, string]> = [
  ["wave", "👋"],
  ["point", "👉"],
  ["laugh", "😄"],
  ["shrug", "🤷"],
  ["dance", "🕺"],
  ["think", "🤔"],
];

const MAX_LINES = 60;

export function ChatPanel({ onWhisper }: { onWhisper: (session: string, name: string) => void }) {
  const [lines, setLines] = useState<IncomingChat[]>([]);
  const [open, setOpen] = useState(false);
  const [channel, setChannel] = useState<Channel>("local");
  const [draft, setDraft] = useState("");
  const [showEmotes, setShowEmotes] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    return onChat((msg) => {
      setLines((prev) => [...prev, msg].slice(-MAX_LINES));
    });
  }, []);

  /**
   * Crew scrollback, replayed once on join.
   *
   * Prepended rather than appended: these are older than anything already on
   * screen, and `at` is a server timestamp so they sort correctly against live
   * lines without trusting the local clock.
   */
  useEffect(
    () =>
      onCrewHistory((history) => {
        if (!history.length) return;
        setLines((prev) => {
          const replayed: IncomingChat[] = history.map((h) => ({
            from: "",
            name: h.name,
            color: "var(--crew, #22e8ff)",
            crewTag: world.crew?.tag ?? "",
            text: h.text,
            channel: "crew" as const,
            at: h.at,
            history: true,
          }));
          return [...replayed, ...prev].slice(-MAX_LINES);
        });
      }),
    []
  );

  // Keep the newest message in view without yanking the page around.
  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines]);

  /**
   * Enter opens chat and Escape closes it. The input itself stops key events
   * propagating, so typing "wasd" writes letters rather than walking away.
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = isTyping();

      if (e.key === "Enter" && !typing) {
        e.preventDefault();
        setOpen(true);
        requestAnimationFrame(() => inputRef.current?.focus());
      }
      if (e.key === "Escape" && typing) {
        inputRef.current?.blur();
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const text = draft.trim();
    // A player can leave their crew with the crew channel still selected;
    // sending there would go to nobody.
    const scope = channel === "crew" && !world.crew ? "local" : channel;
    if (text) sendChat(text, scope);
    setDraft("");
    inputRef.current?.blur();
    setOpen(false);
  };

  return (
    <div className="hud chat">
      <div className="panel compact chat-panel">
        <div ref={logRef} className="chat-log">
          {lines.length === 0 && (
            <p className="dim tiny">
              Press <kbd>Enter</kbd> to talk. People nearby will hear you.
            </p>
          )}
          {lines.map((line, i) => (
            <p key={i} className={`chat-line ${line.channel} ${line.history ? "replayed" : ""}`}>
              {line.channel === "district" && <span className="chat-ch">[district]</span>}
              {line.channel === "crew" && <span className="chat-ch crew">[crew]</span>}
              {/*
                A name is a button only when we know which session said it.
                Replayed history has no session — the person may not even be in
                the city — so those names stay plain rather than offering a
                message that could not be sent.
              */}
              {line.from && line.from !== world.sessionId ? (
                <button
                  type="button"
                  className="chat-who"
                  style={{ color: line.color }}
                  title={`Message ${line.name}`}
                  onClick={() => onWhisper(line.from, line.name)}
                >
                  {line.crewTag ? `[${line.crewTag}] ` : ""}
                  {line.name}
                </button>
              ) : (
                <b style={{ color: line.color }}>
                  {line.crewTag ? `[${line.crewTag}] ` : ""}
                  {line.name}
                </b>
              )}
              <span>{line.text}</span>
            </p>
          ))}
        </div>

        {open ? (
          <form className="chat-form" onSubmit={submit}>
            <button
              type="button"
              className={`chat-scope ${channel}`}
              onClick={() => setChannel((c) => nextChannel(c, !!world.crew))}
              title={SCOPE_HINT[channel]}
            >
              {SCOPE_LABEL[channel]}
            </button>
            <input
              ref={inputRef}
              value={draft}
              maxLength={200}
              placeholder="say something…"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.stopPropagation()}
              onBlur={() => !draft && setOpen(false)}
            />
          </form>
        ) : (
          <div className="chat-actions">
            <button className="link" onClick={() => { setOpen(true); requestAnimationFrame(() => inputRef.current?.focus()); }}>
              say something
            </button>
            <button className="link" onClick={() => setShowEmotes((v) => !v)}>
              emotes
            </button>
          </div>
        )}

        {showEmotes && (
          <div className="emote-row">
            {EMOTES.map(([name, glyph]) => (
              <button
                key={name}
                className="emote-btn"
                title={name}
                onClick={() => {
                  sendEmote(name);
                  setShowEmotes(false);
                }}
              >
                {glyph}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export type Channel = "local" | "district" | "crew";

const SCOPE_LABEL: Record<Channel, string> = {
  local: "near",
  district: "district",
  crew: "crew",
};

const SCOPE_HINT: Record<Channel, string> = {
  local: "Heard by players standing near you",
  district: "Heard by everyone in this district",
  crew: "Heard by your crew, anywhere in the city",
};

/**
 * Cycle through the channels, skipping crew when the player has none.
 *
 * A two-state toggle cannot express three options, and offering a crew channel
 * to somebody with no crew would send messages nobody receives.
 */
function nextChannel(current: Channel, hasCrew: boolean): Channel {
  const order: Channel[] = hasCrew ? ["local", "district", "crew"] : ["local", "district"];
  const i = order.indexOf(current);
  return order[(i + 1) % order.length];
}
