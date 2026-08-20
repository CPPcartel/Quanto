import { useState, useEffect, useRef, useSyncExternalStore } from "react";
import { world, subscribeUi, getUiVersion, markUiDirty } from "../net/world";
import {
  sendDm,
  replyToThread,
  openThread,
  refreshInbox,
  setBlocked,
  onDmResult,
  type DmOutcome,
} from "../net/connection";

/**
 * Private messages.
 *
 * Two views in one panel: the list of people you have talked to, and one open
 * conversation. Nothing is applied optimistically — whether a message was
 * accepted is decided by the server, and a hopeful local echo would have to be
 * taken back on a rate limit.
 *
 * The panel never sees a device id. Conversations are addressed by the opaque
 * handle the server minted for them, and a brand-new message to somebody
 * standing in front of you is addressed by session. Neither can be used to
 * impersonate anybody.
 *
 * Block is deliberately quiet: the other side is told nothing, and their
 * messages simply stop arriving. Telling somebody they have been blocked is an
 * invitation to make a second account.
 */

export function InboxPanelBody({
  onClose,
  draftTo,
  onDraftHandled,
}: {
  onClose: () => void;
  /** A player picked from chat, waiting for a first message. */
  draftTo: { session: string; name: string } | null;
  onDraftHandled: () => void;
}) {
  useSyncExternalStore(subscribeUi, getUiVersion);

  const [text, setText] = useState("");
  const [flash, setFlash] = useState<DmOutcome | null>(null);
  const [confirmBlock, setConfirmBlock] = useState(false);
  /** The name we just opened a conversation with, waiting for it to appear. */
  const [awaiting, setAwaiting] = useState<string | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  const open = world.dmOpen;
  const threads = world.dmThreads;

  // The list can go stale while the panel is closed — a message may have
  // arrived and been counted without the thread order being pushed.
  useEffect(() => refreshInbox(), []);

  useEffect(() => onDmResult(setFlash), []);

  /**
   * Open the conversation the first message just created.
   *
   * Sending to somebody picked out of chat leaves the panel on an empty draft —
   * the server confirms the send and pushes an updated inbox, but nothing tells
   * the panel to switch to the thread, so the sender sees no trace of what they
   * just wrote. We wait for the conversation to show up in the inbox and open it.
   */
  useEffect(() => {
    if (!awaiting) return;
    const match = world.dmThreads.find((t) => t.name === awaiting);
    if (!match) return;
    setAwaiting(null);
    onDraftHandled();
    openThread(match.device);
  }, [awaiting, getUiVersion(), onDraftHandled]);
  useEffect(() => {
    if (!flash) return;
    const id = setTimeout(() => setFlash(null), 4000);
    return () => clearTimeout(id);
  }, [flash]);

  // Newest message in view, without yanking the panel around.
  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [open?.lines.length, draftTo]);

  // Leaving a conversation clears the confirmation, so a stray Block cannot
  // land on whoever is opened next.
  useEffect(() => setConfirmBlock(false), [open?.device, draftTo?.session]);

  const send = () => {
    const body = text.trim();
    if (!body) return;
    if (draftTo) {
      sendDm(draftTo.session, body);
      setAwaiting(draftTo.name);
    } else if (open) {
      replyToThread(open.device, body);
    }
    setText("");
  };

  const back = () => {
    setAwaiting(null);
    // `dmOpen` lives on the world object, not in React state, so closing a
    // conversation has to announce itself. Without this the panel keeps showing
    // the thread whenever there was no draft to clear — `setDraftTo(null)` on an
    // already-null value re-renders nothing.
    world.dmOpen = null;
    markUiDirty();
    onDraftHandled();
    refreshInbox();
  };

  const title = draftTo?.name ?? open?.name;

  return (
    <>
      <div className="crew-head">
        <span className="wallet-label">{title ? title.toUpperCase() : "MESSAGES"}</span>
        <div className="row">
          {title && (
            <button className="link tiny" onClick={back}>
              back
            </button>
          )}
          <button className="link tiny" onClick={onClose}>
            close
          </button>
        </div>
      </div>

      {title ? (
        <>
          <div ref={logRef} className="dm-log">
            {draftTo && !open ? (
              <p className="dim tiny">
                Nothing yet. Whatever you send waits for {draftTo.name} even if they log off.
              </p>
            ) : (
              open?.lines.map((line) => (
                <p key={line.id} className={`dm-line ${line.mine ? "mine" : ""}`}>
                  <span className="dm-text">{line.text}</span>
                  <span className="dim tiny dm-at">{clock(line.at)}</span>
                </p>
              ))
            )}
          </div>

          <form
            className="chat-form dm-form"
            onSubmit={(e) => {
              e.preventDefault();
              send();
            }}
          >
            <input
              value={text}
              maxLength={200}
              placeholder="write a message…"
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => e.stopPropagation()}
            />
            <button className="primary-btn tiny-btn" type="submit" disabled={!text.trim()}>
              Send
            </button>
          </form>

          {open &&
            (confirmBlock ? (
              <div className="row space dm-block">
                <span className="dim tiny">Block {open.name}? They are not told.</span>
                <div className="row">
                  <button
                    className="ghost-btn tiny-btn"
                    onClick={() => {
                      setBlocked(open.device, true);
                      setConfirmBlock(false);
                      back();
                    }}
                  >
                    Block
                  </button>
                  <button className="link tiny" onClick={() => setConfirmBlock(false)}>
                    cancel
                  </button>
                </div>
              </div>
            ) : (
              <button className="link tiny dm-block" onClick={() => setConfirmBlock(true)}>
                block {open.name}
              </button>
            ))}
        </>
      ) : threads.length === 0 ? (
        <p className="dim tiny crew-note">
          No messages. Click somebody's name in chat to write to them — it will be waiting
          whether or not they are in the city when you send it.
        </p>
      ) : (
        <div className="dm-threads">
          {threads.map((t) => (
            <button
              key={t.device}
              className={`dm-thread ${t.unread ? "unread" : ""}`}
              onClick={() => {
                onDraftHandled();
                openThread(t.device);
              }}
            >
              <div className="dm-thread-head">
                <span className="dm-thread-name">{t.name}</span>
                {t.unread > 0 && <span className="dock-count">{t.unread}</span>}
              </div>
              <span className="dim tiny dm-thread-last">{t.lastText}</span>
            </button>
          ))}
        </div>
      )}

      {flash && !flash.ok && <p className="flash tiny bad">{flash.reason}</p>}
    </>
  );
}

/** Local time of day. Timestamps are server-issued; only the format is local. */
function clock(at: number): string {
  return new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
