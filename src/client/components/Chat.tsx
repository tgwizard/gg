import { type FormEvent, useEffect, useLayoutEffect, useRef, useState } from "react";
import { MAX_CHAT_LENGTH } from "../../shared/protocol";
import type { RoomSnapshot } from "../net/RoomClient";
import { formatDateTimeZone, formatTime } from "../format";
import { noAutofill } from "../noAutofill";
import { Button, Panel, playerStyle, useMedia, usePlayerColors } from "../../ui";
import { useToast } from "./Toasts";

/** Messages shown when the chat is part of the page, before "Show earlier". */
const IN_PAGE_RECENT = 30;

export function Chat({ snapshot, onSend }: { snapshot: RoomSnapshot; onSend(text: string): Promise<void> }) {
  const [text, setText] = useState("");
  const toast = useToast();
  const colorOf = usePlayerColors();
  const listRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  // Under the game (phones, narrow windows) the chat is part of the page, which is what
  // scrolls: a box scrolling inside it would stop a swipe up at its top, short of the game.
  const inPage = useMedia("(max-width: 860px)");
  const [showAll, setShowAll] = useState(false);
  const pageAtBottom = useRef(false);
  useEffect(() => {
    if (!inPage) return;
    const note = () => (pageAtBottom.current = innerHeight + scrollY >= document.documentElement.scrollHeight - 60);
    note();
    addEventListener("scroll", note, { passive: true });
    addEventListener("resize", note);
    return () => {
      removeEventListener("scroll", note);
      removeEventListener("resize", note);
    };
  }, [inPage]);

  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el) return;
    // Reading the latest at the bottom of the page: new messages come into view.
    if (inPage) {
      if (pageAtBottom.current) scrollTo({ top: document.documentElement.scrollHeight });
    } else if (stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [snapshot.chat, snapshot.pendingChat, inPage]);

  const earlier = inPage && !showAll ? Math.max(0, snapshot.chat.length - IN_PAGE_RECENT) : 0;
  const messages = earlier ? snapshot.chat.slice(earlier) : snapshot.chat;

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    const sent = text;
    onSend(sent).catch((e: Error) => {
      // Refused (e.g. too fast): say so, and give the text back unless they've started typing again.
      toast(e.message);
      setText((current) => current || sent);
    });
    setText("");
    stickToBottom.current = true;
    pageAtBottom.current = true;
  }

  return (
    <Panel className="chat" title="Chat">
      <div
        className="chat-list"
        ref={listRef}
        data-testid="chat-list"
        onScroll={(e) => {
          const el = e.currentTarget;
          stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
      >
        {earlier > 0 && (
          <button type="button" className="btn ghost small chat-earlier" onClick={() => setShowAll(true)}>
            Show {earlier} earlier {earlier === 1 ? "message" : "messages"}
          </button>
        )}
        {messages.map((m) =>
          m.kind === "user" ? (
            <div key={m.seq} className="msg" data-testid="chat-message">
              <time className="msg-time" title={formatDateTimeZone(m.ts)}>{formatTime(m.ts)}</time>
              <span className="msg-body">
                <span className="name" style={playerStyle(colorOf(m.playerId ?? ""))}>
                  {m.name}
                </span>
                <span className="msg-text">{m.text}</span>
              </span>
            </div>
          ) : (
            <div key={m.seq} className={`msg msg-${m.kind}`} data-testid="chat-message">
              <time className="msg-time" title={formatDateTimeZone(m.ts)}>{formatTime(m.ts)}</time>
              <span className="msg-body">
                <span className="msg-text">{m.text}</span>
              </span>
            </div>
          ),
        )}
        {snapshot.pendingChat.map((p) => (
          <div key={p.cid} className="msg pending" title="Sending…" data-testid="chat-pending">
            <time className="msg-time" title={formatDateTimeZone(p.ts)}>{formatTime(p.ts)}</time>
            <span className="msg-body">
              <span className="name" style={playerStyle(snapshot.you?.color ?? 0)}>
                {snapshot.you?.name}
              </span>
              <span className="msg-text">{p.text}</span>
            </span>
          </div>
        ))}
      </div>
      <form className="chat-input" onSubmit={submit}>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Say something…"
          aria-label="Chat message"
          maxLength={MAX_CHAT_LENGTH}
          {...noAutofill}
        />
        <Button className="btn primary" why={text.trim() ? null : "Type a message first."}>
          Send
        </Button>
      </form>
    </Panel>
  );
}
