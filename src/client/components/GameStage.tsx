import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import type { GameSetting } from "../../games/ui";
import { gameUIs } from "../../games/ui-registry";
import type { RoomClient, RoomSnapshot } from "../net/RoomClient";
import { RequestError } from "../net/RoomClient";
import { useServerNow } from "../useNow";
import { Panel, play } from "../../ui";
import { GameCard } from "./GameCard";
import { InTopbar } from "./TopbarSlot";
import { useToast } from "./Toasts";

export function GameStage({ client, snapshot }: { client: RoomClient; snapshot: RoomSnapshot }) {
  return snapshot.game ? <ActiveGame client={client} snapshot={snapshot} /> : <GamePicker client={client} snapshot={snapshot} />;
}

function GamePicker({ client, snapshot }: { client: RoomClient; snapshot: RoomSnapshot }) {
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const connected = snapshot.status === "connected";
  const ui = selected ? gameUIs[selected] : null;

  async function start(config: unknown) {
    if (!selected) return;
    setBusy(true);
    try {
      await client.selectGame(selected, config);
    } catch (e) {
      toast(e instanceof RequestError ? e.message : "Couldn't start the game.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="picker">
      <div className="picker-head">
        <h2 className="display">Pick a game</h2>
        <p className="muted">Everyone in the room plays, or watches, together.</p>
      </div>
      <div className="game-grid">
        {Object.values(gameUIs).map((g) => (
          <GameCard key={g.meta.id} game={g} selected={selected === g.meta.id} onClick={() => setSelected(g.meta.id)} />
        ))}
      </div>
      {ui && (
        <Panel className="setup" title={`Set up ${ui.meta.name}`}>
          {ui.Setup ? (
            <ui.Setup busy={busy} disabled={!connected} onStart={start} />
          ) : (
            <button className="btn primary" disabled={busy || !connected} onClick={() => start({})}>
              Start {ui.meta.name}
            </button>
          )}
        </Panel>
      )}
    </div>
  );
}

function ActiveGame({ client, snapshot }: { client: RoomClient; snapshot: RoomSnapshot }) {
  const game = snapshot.game!;
  const ui = gameUIs[game.gameId];
  const toast = useToast();
  const [confirmEnd, setConfirmEnd] = useState(false);
  const connected = snapshot.status === "connected";
  const members = useMemo(() => new Map(snapshot.members.map((m) => [m.id, m])), [snapshot.members]);
  const serverNow = useServerNow(snapshot.clockOffset, 250);

  if (!ui) return <p className="muted">This room is playing a game this version of gg doesn't know ({game.gameId}). Try reloading.</p>;

  async function sendOp(op: unknown) {
    try {
      await client.sendGameOp(op);
      return true;
    } catch (e) {
      toast(e instanceof RequestError ? e.message : "Something went wrong.");
      return false;
    }
  }

  return (
    <div className="active-game">
      <InTopbar>
        <div className="game-header">
          <img className="game-header-icon" src={ui.icon} alt="" width={44} height={44} />
          <h2 className="display">{ui.meta.name}</h2>
          <TurnPill waitingOn={game.waitingOn} me={snapshot.you!.id} members={members} instance={game.instanceId} />
          <div className="spacer" />
          <GameHelp name={ui.meta.name} rules={ui.meta.rules} />
          {ui.settings && <GameSettings settings={ui.settings(game.view)} />}
          {confirmEnd ? (
            <span className="row">
              <span className="muted small">End for everyone?</span>
              <button
                className="btn danger small"
                onClick={() => {
                  setConfirmEnd(false);
                  client.endGame().catch((e) => toast(e instanceof RequestError ? e.message : "Couldn't end the game."));
                }}
              >
                End game
              </button>
              <button className="btn ghost small" onClick={() => setConfirmEnd(false)}>
                Cancel
              </button>
            </span>
          ) : (
            <button className="btn small" disabled={!connected} onClick={() => setConfirmEnd(true)}>
              End game
            </button>
          )}
        </div>
      </InTopbar>
      <ui.Game view={game.view} snapshot={game} me={snapshot.you!.id} members={members} connected={connected} sendOp={sendOp} serverNow={serverNow} />
    </div>
  );
}

/**
 * Whose turn it is, for every game: "Your turn" (with a chime, and in the tab's title
 * so you notice from another tab), "Bob's turn", or nothing when nobody's being waited on.
 */
function TurnPill({ waitingOn, me, members, instance }: { waitingOn: string[]; me: string; members: Map<string, { name: string }>; instance: string }) {
  const mine = waitingOn.includes(me);
  const others = waitingOn.filter((id) => id !== me).map((id) => members.get(id)?.name ?? "Someone");
  // Chime when it becomes your turn, not when you arrive and it already is.
  const was = useRef<{ instance: string; mine: boolean } | null>(null);
  useEffect(() => {
    const before = was.current;
    was.current = { instance, mine };
    if (mine && before && before.instance === instance && !before.mine) play("turn");
  }, [mine, instance]);
  useEffect(() => {
    if (!mine) return;
    const title = document.title;
    document.title = `● Your turn · ${title}`;
    return () => {
      document.title = title;
    };
  }, [mine]);

  if (!mine && !others.length) return null;
  const text = mine ? "Your turn" : others.length === 1 ? `${others[0]}'s turn` : others.length === 2 ? `${others[0]} & ${others[1]}` : `${others.length} players`;
  return (
    <span key={mine ? "mine" : "theirs"} className={`turn-pill ${mine ? "mine" : ""}`} role="status" data-testid="turn-pill">
      {mine && <span className="turn-pill-dot" aria-hidden />}
      {text}
    </span>
  );
}

/** A small gear that shows the running game's settings (turn timer, blinds…). */
function GameSettings({ settings }: { settings: GameSetting[] }) {
  return (
    <HeaderPopover label="Game settings" icon={<GearIcon />}>
      <h3 className="label">Table rules</h3>
      <dl>
        {settings.map((s) => (
          <div key={s.label} className="setting">
            <dt>{s.label}</dt>
            <dd>
              <strong>{s.value}</strong>
              {s.hint && <span className="muted small">{s.hint}</span>}
            </dd>
          </div>
        ))}
      </dl>
      <p className="muted small">Set when the game started. End the game to change them.</p>
    </HeaderPopover>
  );
}

/** How to play: the game's rules (the same text AI bots get). */
function GameHelp({ name, rules }: { name: string; rules: string }) {
  return (
    <HeaderPopover label="How to play" icon={<span className="icon-btn-text">?</span>} wide>
      <h3 className="label">How to play {name}</h3>
      <Rules text={rules} />
    </HeaderPopover>
  );
}

/** Paragraphs, with "- " lines as bullet lists. */
export function Rules({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  let bullets: string[] = [];
  const flush = () => {
    if (bullets.length)
      blocks.push(
        <ul key={blocks.length}>
          {bullets.map((b, i) => (
            <li key={i}>{b}</li>
          ))}
        </ul>,
      );
    bullets = [];
  };
  for (const line of text.split("\n")) {
    if (line.startsWith("- ")) bullets.push(line.slice(2));
    else {
      flush();
      if (line.trim()) blocks.push(<p key={blocks.length}>{line}</p>);
    }
  }
  flush();
  return <div className="rules">{blocks}</div>;
}

/** An icon button in the game header that opens a small panel under it. */
function HeaderPopover({ label, icon, wide, children }: { label: string; icon: ReactNode; wide?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  return (
    <div className="game-settings" ref={ref}>
      <button className="icon-btn" onClick={() => setOpen(!open)} aria-expanded={open} aria-label={label} title={label}>
        {icon}
      </button>
      {open && (
        <div className={`game-settings-pop box ${wide ? "wide" : ""}`} role="dialog" aria-label={label}>
          {children}
        </div>
      )}
    </div>
  );
}

function GearIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" />
    </svg>
  );
}
