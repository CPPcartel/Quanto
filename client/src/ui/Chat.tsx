import { useEffect, useRef, useState } from "react";
import { isTyping } from "./keyboard";
import { sendChat, sendEmote, onChat, type IncomingChat } from "../net/connection";

/**
 * Chat panel.
 *
 * Two channels: what you can hear from where you're standing, and the district
 * you're in. Enter opens the input and sends; Escape closes it — so walking
 * and talking never fight over the keyboard, which is the usual way chat in a
 * game with WASD movement goes wrong.
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

export function ChatPanel() {
  const [lines, setLines] = useState<IncomingChat[]>([]);
  const [open, setOpen] = useState(false);
  const [channel, setChannel] = useState<"local" | "district">("local");
  const [draft, setDraft] = useState("");
  const [showEmotes, setShowEmotes] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    return onChat((msg) => {
      setLines((prev) => [...prev, msg].slice(-MAX_LINES));
    });
  }, []);

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
    if (text) sendChat(text, channel);
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
            <p key={i} className={`chat-line ${line.channel}`}>
              {line.channel === "district" && <span className="chat-ch">[district]</span>}
              <b style={{ color: line.color }}>
                {line.crewTag ? `[${line.crewTag}] ` : ""}
                {line.name}
              </b>
              <span>{line.text}</span>
            </p>
          ))}
        </div>

        {open ? (
          <form className="chat-form" onSubmit={submit}>
            <button
              type="button"
              className={`chat-scope ${channel}`}
              onClick={() => setChannel((c) => (c === "local" ? "district" : "local"))}
              title="Switch channel"
            >
              {channel === "local" ? "near" : "district"}
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
