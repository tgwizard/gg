import { useRef, useState } from "react";
import { Panel } from "../../ui";
import type { BotRecord } from "../bots/store";
import type { GuestRecord } from "../guests";
import type { RoomSnapshot } from "../net/RoomClient";
import { AddGuest, BotTag, bringWhy, GuestTag, InviteBot, JoiningBots, MemberButton, RemoveMember } from "./Members";
import { Popover, usePeek } from "./Popover";

/** A people icon by the room's name: hover or click it for the room code and invite link. */
export function InviteButton({ roomId }: { roomId: string }) {
  const peek = usePeek();
  const button = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button ref={button} type="button" className="invite-btn" onClick={peek.toggle} aria-expanded={peek.open} aria-label="Invite people" {...peek.hover}>
        <PeopleIcon />
      </button>
      {peek.open && button.current && (
        <Popover anchor={button.current} label="Invite people" onClose={peek.close} hover={peek.hover} align="left" className="peek-pop invite-pop">
          <div className="peek">
            <h3 className="peek-title">Invite people</h3>
            <div className="invite-code">
              <span className="label">Room code</span>
              <span className="code" data-testid="room-code">
                {roomId}
              </span>
            </div>
            <InviteLink roomId={roomId} />
            <p className="muted small">Anyone with the link can join. There's no list of rooms, so it's only for whoever you send it to.</p>
          </div>
        </Popover>
      )}
    </>
  );
}

/**
 * Before a game: who's here (click yourself or your bots to edit), the link to send to
 * friends, and your bots to fill the table.
 */
export function InviteSection({ snapshot, roomId, bots, guests }: { snapshot: RoomSnapshot; roomId: string; bots: BotRecord[]; guests: GuestRecord[] }) {
  const here = snapshot.members.filter((m) => m.online);
  const alone = !here.some((m) => m.id !== snapshot.you?.id && m.kind !== "bot");
  const why = bringWhy(roomId, snapshot.status === "connected");
  return (
    <Panel className="invite" data-testid="invite-section">
      <div className="invite-head">
        <h2 className="display">Invite friends to play</h2>
        <p className="muted">{alone ? "Send them the link. They pick a name and they're in: no accounts, no installs." : "Send the link to anyone else who wants in."}</p>
      </div>
      <InviteLink roomId={roomId} large />
      <div className="invite-here">
        <span className="label">Here now</span>
        <ul className="invite-people">
          {here.map((m) => (
            <li key={m.id} className="invite-person">
              <MemberButton member={m} snapshot={snapshot} bots={bots} guests={guests} roomId={roomId} />
              {m.id === snapshot.you?.id && <span className="tag accent">you</span>}
              {m.kind === "bot" && <BotTag member={m} owner={m.ownerId === snapshot.you?.id ? "you" : (snapshot.members.find((o) => o.id === m.ownerId)?.name ?? "Someone")} />}
              {m.kind === "guest" && <GuestTag member={m} owner={m.ownerId === snapshot.you?.id ? null : (snapshot.members.find((o) => o.id === m.ownerId)?.name ?? "someone")} />}
              <RemoveMember member={m} bots={bots} guests={guests} roomId={roomId} />
            </li>
          ))}
          {snapshot.status === "connected" && <JoiningBots roomId={roomId} bots={bots} members={here.map((m) => m.id)} className="invite-person" />}
          <li>
            <InviteBot roomId={roomId} members={snapshot.members} why={why} className="btn small" />
          </li>
          <li>
            <AddGuest roomId={roomId} members={snapshot.members} why={why} className="btn small" />
          </li>
        </ul>
      </div>
    </Panel>
  );
}

/** The room's link, with Copy (and Share, where the device has it). */
function InviteLink({ roomId, large }: { roomId: string; large?: boolean }) {
  const [copied, setCopied] = useState(false);
  const url = `${location.origin}/r/${roomId}`;
  const canShare = typeof navigator.share === "function" && matchMedia("(pointer: coarse)").matches;
  return (
    <div className={`invite-link ${large ? "large" : ""}`}>
      <span className="invite-url" title={url}>
        {location.host}/r/{roomId}
      </span>
      <button
        type="button"
        className={`btn ${large ? "primary" : "primary small"}`}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(url);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          } catch {
            // Clipboard blocked; the link is right there to select.
          }
        }}
      >
        {/* Both labels take up room, so the button (and the link beside it) keeps its width. */}
        <span className={`swap-label ${copied ? "alt" : ""}`}>
          <span aria-hidden={copied}>Copy invite link</span>
          <span aria-hidden={!copied}>Link copied ✓</span>
        </span>
      </button>
      {canShare && (
        <button type="button" className={`btn ${large ? "" : "small"}`} onClick={() => navigator.share({ title: "Play with me on gg", url }).catch(() => {})}>
          Share…
        </button>
      )}
    </div>
  );
}

function PeopleIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20a6.5 6.5 0 0 1 13 0" />
      <path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14a6.5 6.5 0 0 1 3.5 6" />
    </svg>
  );
}
