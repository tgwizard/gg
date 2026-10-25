import { useRef, useState } from "react";
import { MAX_BOTS_PER_PLAYER, type Member } from "../../shared/protocol";
import { ActivityBubble, Avatar, Panel, PlayerName, playerStyle } from "../../ui";
import { type BotRecord, type BotSetup, createBot, inviteBot, removeFromRoom, suggestBot, updateBot, useMyBots } from "../bots/store";
import { saveColor, saveName } from "../identity";
import type { RoomSnapshot } from "../net/RoomClient";
import { BotForm, botCaption } from "./BotForm";
import { Popover } from "./Popover";
import { ProfileForm } from "./Profile";
import { SettingsLink } from "./SettingsLink";

export function Members({ snapshot, roomId, bots }: { snapshot: RoomSnapshot; roomId: string; bots: BotRecord[] }) {
  const waiting = new Set(snapshot.game?.waitingOn ?? []);
  const members = [...snapshot.members].sort((a, b) => Number(b.online) - Number(a.online));
  const names = new Map(snapshot.members.map((m) => [m.id, m.name]));
  const mine = new Map(bots.map((b) => [b.playerId, b]));
  const connected = snapshot.status === "connected";
  const playing = bots.filter((b) => !b.rooms[roomId]?.removing && !b.deleted);

  return (
    <Panel className="members" title="In this room" actions={<span className="label">{members.filter((m) => m.online).length} online</span>}>
      <ul>
        {members.map((m) => {
          const record = mine.get(m.id);
          const leaving = !!record && (!!record.deleted || !!record.rooms[roomId]?.removing);
          return (
            <li key={m.id} className={m.online ? "online" : "away"} data-testid="member">
              {/* On the avatar's corner, so it never takes room from the name. */}
              {m.activity && <ActivityBubble text={m.activity} compact />}
              <MemberButton member={m} snapshot={snapshot} bots={bots} roomId={roomId} />
              {m.id === snapshot.you?.id && <span className="tag accent">you</span>}
              {m.kind === "bot" && (
                <span className="tag brand" title={botSummary(m, record ? "you" : (names.get(m.ownerId ?? "") ?? "Someone"))}>
                  {(m.bot?.level ?? record?.level) === "ai" ? "AI bot" : "bot"}
                </span>
              )}
              {record?.error && !leaving && (
                <span className="tag danger" title={record.error}>
                  AI problem
                </span>
              )}
              {leaving && <span className="tag">leaving…</span>}
              {waiting.has(m.id) && <span className="tag gold">to act</span>}
              {record && !leaving && (
                <button
                  className="member-remove"
                  onClick={() => removeFromRoom(record.id, roomId)}
                  aria-label={`Remove ${m.name}`}
                  title={`Take ${m.name} out of this room (it stays one of your bots)`}
                >
                  ×
                </button>
              )}
            </li>
          );
        })}
      </ul>
      <div className="members-foot">
        <InviteBot roomId={roomId} members={snapshot.members} disabled={!connected || playing.length >= MAX_BOTS_PER_PLAYER} />
        {playing.length >= MAX_BOTS_PER_PLAYER && <span className="muted small">Up to {MAX_BOTS_PER_PLAYER} bots each.</span>}
      </div>
    </Panel>
  );
}

/**
 * Someone in the room, by avatar and name: click yourself or one of your bots to edit
 * (a bot's changes apply in every room), or someone else's bot to see what it is.
 */
export function MemberButton({ member, snapshot, bots, roomId }: { member: Member; snapshot: RoomSnapshot; bots: BotRecord[]; roomId: string }) {
  const bot = bots.find((b) => b.playerId === member.id);
  if (member.id === snapshot.you?.id) return <EditYou member={member} members={snapshot.members} />;
  if (bot && !bot.deleted && !bot.rooms[roomId]?.removing) return <EditBot bot={bot} member={member} members={snapshot.members} />;
  if (member.kind === "bot") {
    const owner = snapshot.members.find((m) => m.id === member.ownerId)?.name ?? "Someone";
    return <AboutBot member={member} owner={owner} you={member.ownerId === snapshot.you?.id} />;
  }
  return (
    <span className="member-plain">
      <Avatar name={member.name} color={member.color} online={member.online} size="sm" />
      <PlayerName name={member.name} color={member.color} className="member-name" />
    </span>
  );
}

/** "AI bot (muse-spark-1.3, low effort, Meta), playing from Adam's browser." */
function botSummary(m: Member, owner: string): string {
  const where = owner === "you" ? "playing from this browser" : `playing from ${owner}'s browser`;
  if (m.bot?.level !== "ai") return `Built-in bot, no AI, ${where}.`;
  const how = [m.bot.model, m.bot.effort && `${m.bot.effort} effort`, m.bot.provider].filter(Boolean).join(", ");
  return `AI bot${how ? ` (${how})` : ""}, ${where}.`;
}

/** An avatar and name that open a popover. */
function MemberTrigger({ member, bot, label, open, onClick, anchor }: { member: Member; bot?: boolean; label: string; open: boolean; onClick(): void; anchor: React.RefObject<HTMLButtonElement | null> }) {
  return (
    <button ref={anchor} className="member-edit" onClick={onClick} aria-expanded={open} aria-label={label} title={label}>
      <Avatar name={member.name} color={member.color} online={member.online} bot={bot} size="sm" />
      <PlayerName name={member.name} color={member.color} className="member-name" />
    </button>
  );
}

/** You: your name and color, as in the top bar. */
function EditYou({ member, members }: { member: Member; members: Member[] }) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  return (
    <>
      <MemberTrigger member={member} label="Edit your profile" open={open} onClick={() => setOpen(!open)} anchor={button} />
      {open && button.current && (
        <Popover anchor={button.current} label="Your profile" onClose={() => setOpen(false)}>
          <ProfileForm
            name={member.name}
            color={member.color}
            submitLabel="Save"
            taken={takenColors(members, member.id)}
            onSubmit={(name, color) => {
              saveColor(color);
              saveName(name);
              setOpen(false);
            }}
            onCancel={() => setOpen(false)}
          />
        </Popover>
      )}
    </>
  );
}

/** Someone else's bot: what it is, how it plays, and whose browser it plays from (never their key). */
function AboutBot({ member, owner, you }: { member: Member; owner: string; you: boolean }) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const ai = member.bot?.level === "ai";
  const whose = you ? "your" : `${owner}'s`;
  return (
    <>
      <MemberTrigger member={member} bot label={`About ${member.name}`} open={open} onClick={() => setOpen(!open)} anchor={button} />
      {open && button.current && (
        <Popover anchor={button.current} label={`About ${member.name}`} onClose={() => setOpen(false)}>
          <div className="profile-form">
            <div className="profile-preview">
              <Avatar name={member.name} color={member.color} online={member.online} bot size="lg" />
              <div className="profile-preview-text">
                <strong className="name" style={playerStyle(member.color)}>
                  {member.name}
                </strong>
                <span className="muted small">{ai ? "AI bot" : "Built-in bot · no AI"}</span>
              </div>
            </div>
            {member.bot?.persona && <p className="bot-persona">“{member.bot.persona}”</p>}
            {ai && (
              <dl className="bot-about">
                <dt>Model</dt>
                <dd>{member.bot?.model ?? "unknown"}</dd>
                <dt>Effort</dt>
                <dd>{member.bot?.effort ?? "low"}</dd>
                {member.bot?.provider && (
                  <>
                    <dt>Provider</dt>
                    <dd>{member.bot.provider}</dd>
                  </>
                )}
              </dl>
            )}
            <p className="muted small bot-form-note">
              {owner === "Someone" ? "It" : `It's ${owner}'s bot, and it`} plays from {whose} browser{ai ? `, with ${whose} own AI key` : ""}.{" "}
              {member.online ? "It's here now." : `It's away until ${you ? "you're" : `${owner} is`} back in the room.`}
            </p>
          </div>
        </Popover>
      )}
    </>
  );
}

/** Colors others in the room have, for the picker. */
function takenColors(members: Member[], except?: string): Map<number, string> {
  return new Map(members.filter((m) => m.id !== except).map((m) => [m.color, m.name]));
}

/**
 * "+ Invite a bot": your bots that aren't here yet, one click each, or a new one made on
 * the spot (it's yours from then on, for any room).
 */
export function InviteBot({ roomId, members, disabled, className = "btn ghost small" }: { roomId: string; members: Member[]; disabled: boolean; className?: string }) {
  const [open, setOpen] = useState(false);
  const [making, setMaking] = useState<BotSetup | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const mine = useMyBots();
  const here = new Set(members.map((m) => m.id));
  const free = mine.filter((b) => !here.has(b.playerId) && !(b.rooms[roomId] && !b.rooms[roomId].removing));
  const close = () => {
    setOpen(false);
    setMaking(null);
  };
  const fresh = (): BotSetup => ({ ...suggestBot({ names: members.map((m) => m.name), colors: members.map((m) => m.color) }), level: "easy" });
  return (
    <>
      <button
        ref={button}
        className={className}
        disabled={disabled}
        aria-expanded={open}
        onClick={() => {
          if (open) return close();
          setOpen(true);
          // Nobody to invite yet: straight to making one.
          setMaking(mine.length ? null : fresh());
        }}
      >
        + Invite a bot
      </button>
      {open && button.current && (
        <Popover anchor={button.current} label="Invite a bot" onClose={close}>
          {making ? (
            <BotForm
              initial={making}
              submitLabel="Make and invite"
              taken={takenColors(members)}
              intro={mine.length ? undefined : "Bots are yours to keep, like your name: make one now and invite it into any room later."}
              onSubmit={async (setup) => {
                close();
                const bot = await createBot(setup);
                if (bot) inviteBot(bot.id, roomId);
              }}
              onCancel={mine.length ? () => setMaking(null) : close}
            />
          ) : (
            <div className="invite-bots">
              <h3 className="peek-title">Invite a bot</h3>
              {free.length ? (
                <ul className="invite-bots-list">
                  {free.map((b) => (
                    <li key={b.id}>
                      <button
                        type="button"
                        className="invite-bot"
                        onClick={() => {
                          close();
                          inviteBot(b.id, roomId);
                        }}
                        aria-label={`Invite ${b.name}`}
                      >
                        <Avatar name={b.name} color={b.color} bot size="sm" />
                        <span className="invite-bot-text">
                          <PlayerName name={b.name} color={b.color} />
                          <span className="muted small">{botCaption(b)}</span>
                        </span>
                        <span className="invite-bot-go">Invite</span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted small">All your bots are here already.</p>
              )}
              <div className="row invite-bots-foot">
                <button type="button" className="btn small" onClick={() => setMaking(fresh())}>
                  + New bot
                </button>
                <SettingsLink tab="bots">Your bots</SettingsLink>
              </div>
            </div>
          )}
        </Popover>
      )}
    </>
  );
}

/** Your bot's avatar and name, which open it for editing (in every room). */
function EditBot({ bot, member, members }: { bot: BotRecord; member: Member; members: Member[] }) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  return (
    <>
      <MemberTrigger member={member} bot label={`Edit ${member.name}`} open={open} onClick={() => setOpen(!open)} anchor={button} />
      {open && button.current && (
        <Popover anchor={button.current} label={`Edit ${member.name}`} onClose={() => setOpen(false)}>
          <BotForm
            initial={bot}
            bot={bot}
            submitLabel="Save"
            taken={takenColors(members, member.id)}
            onSubmit={(setup) => {
              setOpen(false);
              updateBot(bot.id, setup);
            }}
            onCancel={() => setOpen(false)}
          />
        </Popover>
      )}
    </>
  );
}
