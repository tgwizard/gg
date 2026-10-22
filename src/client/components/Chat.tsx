import { type FormEvent, useLayoutEffect, useRef, useState } from "react";
import { MAX_CHAT_LENGTH } from "../../shared/protocol";
import type { RoomSnapshot } from "../net/RoomClient";
import { noAutofill } from "../noAutofill";
import { colorFor } from "./Members";
import { useToast } from "./Toasts";

const time = (ts: number) => new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

export function Chat({ snapshot, onSend }: { snapshot: RoomSnapshot; onSend(text: string): Promise<void> }) {
  const [text, setText] = useState("");
  const toast = useToast();
  const listRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);

  useLayoutEffect(() => {
    const el = listRef.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [snapshot.chat, snapshot.pendingChat]);

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
  }

  return (
    <section className="panel chat">
      <h3>Chat</h3>
      <div
        className="chat-list"
        ref={listRef}
        data-testid="chat-list"
        onScroll={(e) => {
          const el = e.currentTarget;
          stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
      >
        {snapshot.chat.map((m) =>
          m.kind === "user" ? (
            <div key={m.seq} className="msg" data-testid="chat-message">
              <span className="msg-time">{time(m.ts)}</span>
              <span className="msg-name" style={{ color: colorFor(m.playerId ?? "") }}>
                {m.name}
              </span>
              <span className="msg-text">{m.text}</span>
            </div>
          ) : (
            <div key={m.seq} className={`msg msg-${m.kind}`} data-testid="chat-message">
              <span className="msg-time">{time(m.ts)}</span>
              <span className="msg-text">{m.text}</span>
            </div>
          ),
        )}
        {snapshot.pendingChat.map((p) => (
          <div key={p.cid} className="msg pending" title="Sending…" data-testid="chat-pending">
            <span className="msg-time">{time(p.ts)}</span>
            <span className="msg-name" style={{ color: colorFor(snapshot.you?.id ?? "") }}>
              {snapshot.you?.name}
            </span>
            <span className="msg-text">{p.text}</span>
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
        <button className="btn" disabled={!text.trim()}>
          Send
        </button>
      </form>
    </section>
  );
}
