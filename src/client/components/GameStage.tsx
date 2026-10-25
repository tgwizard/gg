import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import type { GameSetting } from "../../games/ui";
import { gameUIs } from "../../games/ui-registry";
import type { RoomClient, RoomSnapshot } from "../net/RoomClient";
import { RequestError } from "../net/RoomClient";
import { useHeartbeat } from "../heartbeat";
import { useServerNow } from "../useNow";
import { play } from "../../ui";
import { GameCard, morphStyle, playerCount, WipBadge } from "./GameCard";
import { Popover } from "./Popover";
import { InTopbar } from "./TopbarSlot";
import { useToast } from "./Toasts";

/** The running game, or before one: `invite` (who's here, and the link to bring more) and picking a game. */
export function GameStage({ client, snapshot, invite }: { client: RoomClient; snapshot: RoomSnapshot; invite?: ReactNode }) {
  return snapshot.game ? <ActiveGame client={client} snapshot={snapshot} /> : <GamePicker client={client} snapshot={snapshot} invite={invite} />;
}

function GamePicker({ client, snapshot, invite }: { client: RoomClient; snapshot: RoomSnapshot; invite?: ReactNode }) {
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const connected = snapshot.status === "connected";
  const ui = selected ? gameUIs[selected] : null;
  const picked = useRef<HTMLElement>(null);
  // Keep the set-up's top in sight when it opens from a card further down.
  useEffect(() => {
    if (selected) picked.current?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  // The chosen card grows into the game's set-up, and shrinks back into the grid.
  const choose = (id: string | null) => morph(() => setSelected(id));

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
      {invite}
      {ui ? (
        <section ref={picked} className="picked box" style={morphStyle(ui.meta.id)} aria-label={`Set up ${ui.meta.name}`} data-testid="game-setup">
          <div className="picked-head">
            <img className="game-card-art" src={ui.icon} alt="" width={120} height={120} style={morphStyle(ui.meta.id, "art")} />
            <div className="game-card-text">
              <span className="game-card-name" style={morphStyle(ui.meta.id, "name")}>
                <strong className="display">{ui.meta.name}</strong>
                <WipBadge wip={ui.meta.wip} />
              </span>
              <span className="game-card-tagline" style={morphStyle(ui.meta.id, "tagline")}>
                {ui.meta.tagline}
              </span>
              <span className="label" style={morphStyle(ui.meta.id, "players")}>
                {playerCount(ui.meta.minPlayers, ui.meta.maxPlayers)}
              </span>
            </div>
            <div className="picked-actions">
              <GameHelp name={ui.meta.name} rules={ui.meta.rules} />
              <button type="button" className="btn ghost small" onClick={() => choose(null)}>
                ← All games
              </button>
            </div>
          </div>
          <div className="picked-setup">
            {ui.Setup ? (
              <ui.Setup busy={busy} disabled={!connected} onStart={start} />
            ) : (
              <button className="btn primary" disabled={busy || !connected} onClick={() => start({})}>
                Start {ui.meta.name}
              </button>
            )}
          </div>
        </section>
      ) : (
        <>
          <div className="picker-head">
            <h2 className="display">Pick a game</h2>
            <p className="muted">Everyone in the room plays, or watches, together.</p>
          </div>
          <div className="game-grid">
            {Object.values(gameUIs).map((g) => (
              <GameCard key={g.meta.id} game={g} morph onClick={() => choose(g.meta.id)} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/** Run a state change as a view transition where the browser has them (and motion is welcome). */
function morph(update: () => void) {
  if (!("startViewTransition" in document) || matchMedia("(prefers-reduced-motion: reduce)").matches) return update();
  document.startViewTransition(() => flushSync(update));
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
          <div className="game-header-title">
            <img className="game-header-icon" src={ui.icon} alt="" width={44} height={44} />
            <h2 className="display">{ui.meta.name}</h2>
            <WipBadge wip={ui.meta.wip} />
          </div>
          <div className="game-header-actions">
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
          {/* Last, so it never moves the buttons; on a phone it's a bar of its own under them. */}
          <TurnPill
            waitingOn={game.waitingOn}
            me={snapshot.you!.id}
            members={members}
            instance={game.instanceId}
            deadline={game.deadline}
            clockOffset={snapshot.clockOffset}
            quiet={ui.quietTurn}
          />
        </div>
      </InTopbar>
      <ui.Game view={game.view} snapshot={game} me={snapshot.you!.id} members={members} connected={connected} sendOp={sendOp} serverNow={serverNow} />
    </div>
  );
}

/**
 * Whose turn it is, for every game: "Your turn" (with a chime, and in the tab's title
 * so you notice from another tab), "Bob's turn", or an empty slot when nobody's being
 * waited on. A heartbeat when your time's nearly up.
 */
function TurnPill({
  waitingOn,
  me,
  members,
  instance,
  deadline,
  clockOffset,
  quiet,
}: {
  waitingOn: string[];
  me: string;
  members: Map<string, { name: string }>;
  instance: string;
  deadline: number | null;
  clockOffset: number;
  quiet?: boolean;
}) {
  const mine = waitingOn.includes(me);
  useHeartbeat(mine, deadline, clockOffset);
  const others = waitingOn.filter((id) => id !== me).map((id) => members.get(id)?.name ?? "Someone");
  // Chime when it becomes your turn, not when you arrive and it already is.
  const was = useRef<{ instance: string; mine: boolean } | null>(null);
  useEffect(() => {
    const before = was.current;
    was.current = { instance, mine };
    if (mine && before && before.instance === instance && !before.mine && !quiet) play("turn");
  }, [mine, instance, quiet]);
  useEffect(() => {
    if (!mine) return;
    const title = document.title;
    document.title = `● Your turn · ${title}`;
    return () => {
      document.title = title;
    };
  }, [mine]);

  // A fixed-size slot, kept even when nobody's up, so nothing beside it moves as turns change.
  if (!mine && !others.length) return <span className="turn-pill empty" aria-hidden data-testid="turn-pill" />;
  const text = mine ? "Your turn" : others.length === 1 ? `${others[0]}'s turn` : others.length === 2 ? `${others[0]} & ${others[1]}` : `${others.length} players`;
  return (
    <span key={mine ? "mine" : "theirs"} className={`turn-pill ${mine ? "mine" : ""}`} role="status" title={text} data-testid="turn-pill">
      {mine && <span className="turn-pill-dot" aria-hidden />}
      <span className="turn-pill-text">{text}</span>
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
  const button = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button ref={button} className="icon-btn" onClick={() => setOpen(!open)} aria-expanded={open} aria-label={label} title={label}>
        {icon}
      </button>
      {open && button.current && (
        <Popover anchor={button.current} label={label} onClose={() => setOpen(false)} className={`header-pop ${wide ? "wide" : ""}`}>
          {children}
        </Popover>
      )}
    </>
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
