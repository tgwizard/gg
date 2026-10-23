import { useRef, useState } from "react";
import { MAX_BOTS_PER_PLAYER, type Member } from "../../shared/protocol";
import { ActivityBubble, Avatar, Panel, PlayerName, playerStyle } from "../../ui";
import { addBot, type BotRecord, type BotSetup, removeBot, suggestBot, updateBot } from "../bots/store";
import type { RoomSnapshot } from "../net/RoomClient";
import { BotForm } from "./BotForm";
import { Popover } from "./Profile";

export function Members({ snapshot, roomId, bots }: { snapshot: RoomSnapshot; roomId: string; bots: BotRecord[] }) {
  const waiting = new Set(snapshot.game?.waitingOn ?? []);
  const members = [...snapshot.members].sort((a, b) => Number(b.online) - Number(a.online));
  const names = new Map(snapshot.members.map((m) => [m.id, m.name]));
  const mine = new Map(bots.map((b) => [b.playerId, b]));
  const connected = snapshot.status === "connected";

  return (
    <Panel className="members" title="In this room" actions={<span className="label">{members.filter((m) => m.online).length} online</span>}>
      <ul>
        {members.map((m) => {
          const bot = mine.get(m.id);
          return (
            <li key={m.id} className={m.online ? "online" : "away"} data-testid="member">
              {/* On the avatar's corner, so it never takes room from the name. */}
              {m.activity && <ActivityBubble text={m.activity} compact />}
              {bot ? (
                <EditBot bot={bot} member={m} members={snapshot.members} />
              ) : m.kind === "bot" ? (
                <AboutBot member={m} owner={names.get(m.ownerId ?? "") ?? "Someone"} you={m.ownerId === snapshot.you?.id} />
              ) : (
                <>
                  <Avatar name={m.name} color={m.color} online={m.online} size="sm" />
                  <PlayerName name={m.name} color={m.color} className="member-name" />
                </>
              )}
              {m.id === snapshot.you?.id && <span className="tag accent">you</span>}
              {m.kind === "bot" && (
                <span className="tag brand" title={botSummary(m, bot ? "you" : (names.get(m.ownerId ?? "") ?? "Someone"))}>
                  {(m.bot?.level ?? bot?.level) === "ai" ? "AI bot" : "bot"}
                </span>
              )}
              {bot?.error && (
                <span className="tag danger" title={bot.error}>
                  AI problem
                </span>
              )}
              {waiting.has(m.id) && <span className="tag gold">to act</span>}
              {bot && (
                <button className="member-remove" onClick={() => removeBot(bot.id)} aria-label={`Remove ${m.name}`} title={`Remove ${m.name}`}>
                  ×
                </button>
              )}
            </li>
          );
        })}
      </ul>
      <div className="members-foot">
        <AddBot roomId={roomId} members={snapshot.members} disabled={!connected || bots.length >= MAX_BOTS_PER_PLAYER} />
        <span className="muted small">
          {bots.length >= MAX_BOTS_PER_PLAYER ? `Up to ${MAX_BOTS_PER_PLAYER} bots each.` : "Easy, or AI with your own key. Plays from this tab."}
        </span>
      </div>
    </Panel>
  );
}

/** "AI bot (muse-spark-1.3, low effort, Meta), playing from Adam's browser." */
function botSummary(m: Member, owner: string): string {
  const where = owner === "you" ? "playing from this browser" : `playing from ${owner}'s browser`;
  if (m.bot?.level !== "ai") return `Easy bot, no AI, ${where}.`;
  const how = [m.bot.model, m.bot.effort && `${m.bot.effort} effort`, m.bot.provider].filter(Boolean).join(", ");
  return `AI bot${how ? ` (${how})` : ""}, ${where}.`;
}

/** Someone else's bot: what it is, and whose browser it plays from. */
function AboutBot({ member, owner, you }: { member: Member; owner: string; you: boolean }) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const ai = member.bot?.level === "ai";
  const whose = you ? "your" : `${owner}'s`;
  return (
    <>
      <button ref={button} className="member-edit" onClick={() => setOpen(!open)} aria-expanded={open} aria-label={`About ${member.name}`} title={`About ${member.name}`}>
        <Avatar name={member.name} color={member.color} online={member.online} bot size="sm" />
        <PlayerName name={member.name} color={member.color} className="member-name" />
      </button>
      {open && button.current && (
        <Popover anchor={button.current} label={`About ${member.name}`} onClose={() => setOpen(false)}>
          <div className="profile-form">
            <div className="profile-preview">
              <Avatar name={member.name} color={member.color} online={member.online} bot size="lg" />
              <div className="profile-preview-text">
                <strong className="name" style={playerStyle(member.color)}>
                  {member.name}
                </strong>
                <span className="muted small">{ai ? "AI bot" : "Easy bot · no AI"}</span>
              </div>
            </div>
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
              {owner === "Someone" ? "It" : `${owner} added it, and it`} plays from {whose} browser{ai ? `, with ${whose} own AI key` : ""}.{" "}
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

function AddBot({ roomId, members, disabled }: { roomId: string; members: Member[]; disabled: boolean }) {
  const [suggestion, setSuggestion] = useState<BotSetup | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const close = () => setSuggestion(null);
  return (
    <>
      <button
        ref={button}
        className="btn ghost small"
        disabled={disabled}
        aria-expanded={!!suggestion}
        onClick={() =>
          setSuggestion(suggestion ? null : { ...suggestBot({ names: members.map((m) => m.name), colors: members.map((m) => m.color) }), level: "easy" })
        }
      >
        + Add a bot
      </button>
      {suggestion && button.current && (
        <Popover anchor={button.current} label="Add a bot" onClose={close}>
          <BotForm
            initial={suggestion}
            submitLabel="Add bot"
            taken={takenColors(members)}
            onSubmit={(setup) => {
              close();
              void addBot(roomId, setup);
            }}
            onCancel={close}
          />
        </Popover>
      )}
    </>
  );
}

/** Your bot's avatar and name, which open its name and color for editing. */
function EditBot({ bot, member, members }: { bot: BotRecord; member: Member; members: Member[] }) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button
        ref={button}
        className="member-edit"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-label={`Edit ${member.name}`}
        title={`Edit ${member.name}`}
      >
        <Avatar name={member.name} color={member.color} online={member.online} bot size="sm" />
        <PlayerName name={member.name} color={member.color} className="member-name" />
      </button>
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
