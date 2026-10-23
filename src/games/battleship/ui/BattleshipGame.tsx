import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ActionTray, GameLog, Herald, TableFooter } from "../../kit/ui/GameParts";
import { PlayerPlate } from "../../kit/ui/PlayerPlate";
import { TurnTimer } from "../../kit/ui/TurnTimer";
import type { GameUIProps } from "../../ui";
import {
  type BoardView,
  type BsEvent,
  type BsView,
  cellOf,
  colOf,
  coord,
  FLEET,
  layoutError,
  rowOf,
  type ShipId,
  type ShipPlacement,
  SIZE,
  shipCells,
  shipName,
  shipSize,
  type Side,
} from "../engine";
import type { BsOp } from "../index";
import "./battleship.css";

type Props = GameUIProps<BsView, BsOp>;
type Shot = Extract<BsEvent, { type: "shot" }>;
const SIDES: Side[] = [0, 1];
const LETTERS = "ABCDEFGHIJ";

export function BattleshipGame({ view, me, members, connected, sendOp, serverNow }: Props) {
  const name = (id: string) => members.get(id)?.name ?? "Player";
  const [busy, setBusy] = useState(false);
  const send = async (op: BsOp) => {
    setBusy(true);
    const ok = await sendOp(op);
    setBusy(false);
    return ok;
  };

  const mySeat = view.you.seat;
  // Your own waters go first (on the left, or on top on a phone), even after you've left your seat.
  const mineAt = view.boards.findIndex((b) => b?.playerId === me);
  const order: Side[] = (mineAt >= 0 ? mineAt : (mySeat ?? 0)) === 1 ? [1, 0] : [0, 1];
  const myBoard = mineAt >= 0 ? view.boards[mineAt]! : null;
  const placing = view.phase === "placing" && !!myBoard && mySeat !== null;
  const myTurn = view.phase === "firing" && view.turn !== null && view.turn === mySeat;
  const open = SIDES.filter((s) => !view.seats[s]);
  // Waiting for players: grey the sea out and say what to do.
  const prompt: "pick" | "wait" | null = view.phase !== "waiting" ? null : mySeat === null ? "pick" : "wait";

  const placement = usePlacement(view, placing && !myBoard!.ready ? myBoard : null, send);
  const landing = useLanding(view, connected);

  return (
    <div className="bs" data-testid="bs">
      <News view={view} me={me} name={name} myBoard={myBoard} />

      <div className="bs-wrap">
        <div className={`bs-boards ${view.phase} ${prompt ? "idle" : ""}`}>
          {order.map((side) => {
            const board = view.boards[side] ?? null;
            const ownerId = board?.playerId ?? view.seats[side]?.playerId ?? null;
            const mine = ownerId === me && board !== null;
            const shooter = view.turn !== null && view.turn !== side;
            return (
              <section
                key={side}
                className={`bs-side ${mine ? "mine" : myBoard ? "theirs" : ""} ${view.phase === "placing" && !mine && myBoard ? "resting" : ""}`}
                data-testid={`bs-side-${side}`}
              >
                <SidePlate
                  view={view}
                  side={side}
                  board={board}
                  ownerId={ownerId}
                  me={me}
                  name={name}
                  online={ownerId ? members.get(ownerId)?.online !== false : false}
                  serverNow={serverNow}
                />
                <Board
                  view={view}
                  side={side}
                  board={board}
                  mine={mine}
                  target={myTurn && !mine}
                  underFire={view.phase === "firing" && shooter}
                  placement={mine ? placement : null}
                  landing={board && landing?.target === board.playerId ? landing : null}
                  disabled={!connected || busy}
                  onFire={(cell) => send({ type: "fire", cell })}
                  caption={caption(view, board, mine, ownerId ? name(ownerId) : null)}
                  note={view.phase === "placing" && !mine && board ? (board.ready ? "Fleet hidden and ready" : "Placing their fleet…") : null}
                />
              </section>
            );
          })}
        </div>
        {prompt === "pick" && (
          <div className="bs-prompt box" role="dialog" aria-label="Take a seat">
            <h3 className="display">{open.length === 2 ? "Play Battleship" : `Take on ${name(view.seats[1 - open[0]!]!.playerId)}`}</h3>
            <p className="muted">{open.length === 2 ? "Two admirals, one sea each. Sit down and someone else takes the other side." : "Placing starts as soon as you sit down."}</p>
            <button className="btn primary big" disabled={!connected || busy} onClick={() => send({ type: "sit", seat: open[0]! })}>
              Take a seat
            </button>
          </div>
        )}
        {prompt === "wait" && (
          <div className="bs-prompt box" role="status">
            <h3 className="display">Waiting for an opponent</h3>
            <p className="muted">Share the room link (Copy invite link, at the top) so someone can take the other side.</p>
          </div>
        )}
      </div>

      {view.phase !== "waiting" && (
        <ActionTray testId="bs-tray" aside={<TrayAside view={view} mySeat={mySeat} busy={busy} connected={connected} send={send} />}>
          {placing ? (
            myBoard!.ready ? (
              <span className="bs-tray-text">
                Your fleet is hidden and ready.{" "}
                {view.boards.some((b) => b && !b.ready) ? `Waiting for ${name(view.boards.find((b) => b && !b.ready)!.playerId)} to finish placing…` : ""}
              </span>
            ) : (
              <Dock placement={placement} disabled={!connected || busy} send={send} />
            )
          ) : (
            <span className="bs-tray-text" data-testid="bs-status">
              {trayStatus(view, me, name, myTurn)}
            </span>
          )}
        </ActionTray>
      )}

      <TableFooter
        log={
          view.log.length > 0 && (
            <GameLog title="Shots fired">
              {view.log.map((e, i) => (
                <li key={i}>{describe(e, me, name, myBoard)}</li>
              ))}
            </GameLog>
          )
        }
        actions={
          mySeat !== null && (
            <button className="btn ghost small" disabled={!connected || busy} onClick={() => send({ type: "leave" })}>
              {view.phase === "firing" ? "Forfeit & leave" : view.phase === "placing" ? "Leave (calls the game off)" : "Leave seat"}
            </button>
          )
        }
      />
    </div>
  );
}

/**
 * The shot that just came in, so it can land on its cell (and sink its ship). Only one
 * that arrived live: nothing replays on first render, a refresh or a reconnect catching up.
 */
function useLanding(view: BsView, connected: boolean): Shot | null {
  const fired = view.boards.reduce((n, b) => n + (b?.shots.length ?? 0), 0);
  const [landing, setLanding] = useState<Shot | null>(null);
  const seen = useRef({ fired, connected });
  useLayoutEffect(() => {
    const before = seen.current;
    seen.current = { fired, connected };
    if (fired === before.fired) return;
    const shot = view.log.findLast((e): e is Shot => e.type === "shot") ?? null;
    setLanding(fired === before.fired + 1 && before.connected && connected ? shot : null);
  }, [fired, connected]);
  return landing;
}

// --- placing ----------------------------------------------------------------

interface Placement {
  ships: ShipPlacement[];
  /** The ship that goes where you click next (the one you picked, or the next unplaced one). */
  active: ShipId | null;
  vertical: boolean;
  hover: number | null;
  select(id: ShipId): void;
  rotate(): void;
  setHover(cell: number | null): void;
  click(cell: number): void;
  /** Cells the active ship would cover with its bow at `cell`, clipped to the grid, and whether that's allowed. */
  preview(cell: number): { cells: number[]; ok: boolean } | null;
}

function usePlacement(view: BsView, board: BoardView | null, send: (op: BsOp) => Promise<boolean>): Placement | null {
  const [picked, setPicked] = useState<ShipId | null>(null);
  const [vertical, setVertical] = useState(false);
  const [hover, setHover] = useState<number | null>(null);
  const ships = board?.ships ?? [];
  const active = picked ?? FLEET.find((s) => !ships.some((p) => p.id === s.id))?.id ?? null;
  const placing = board !== null;

  useEffect(() => {
    if (!placing) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.metaKey || e.ctrlKey || e.altKey || t?.closest("input, textarea, select, [contenteditable]")) return;
      if (e.key === "r" || e.key === "R") setVertical((v) => !v);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [placing]);

  if (!board) return null;
  const candidate = (cell: number): ShipPlacement | null => (active ? { id: active, row: rowOf(cell), col: colOf(cell), vertical } : null);
  const without = (id: ShipId) => ships.filter((s) => s.id !== id);
  const shipOn = (cell: number) => ships.find((s) => shipCells(s)!.includes(cell));

  return {
    ships,
    active,
    vertical,
    hover,
    select: (id) => {
      setPicked(id);
      const placed = ships.find((s) => s.id === id);
      if (placed) setVertical(placed.vertical);
    },
    rotate: () => setVertical((v) => !v),
    setHover,
    click(cell) {
      const c = candidate(cell);
      if (c && !layoutError([...without(c.id), c], view.config.shipsMayTouch)) {
        setPicked(null);
        void send({ type: "arrange", ships: [...without(c.id), c] });
        return;
      }
      // Clicking a placed ship picks it up, to move or turn it.
      const hit = shipOn(cell);
      if (hit) {
        setPicked(hit.id);
        setVertical(hit.vertical);
        void send({ type: "arrange", ships: without(hit.id) });
      }
    },
    preview(cell) {
      const c = candidate(cell);
      if (!c) return null;
      const n = shipSize(c.id);
      const cells: number[] = [];
      for (let i = 0; i < n; i++) {
        const r = c.row + (vertical ? i : 0);
        const col = c.col + (vertical ? 0 : i);
        if (r < SIZE && col < SIZE) cells.push(cellOf(r, col));
      }
      return { cells, ok: !layoutError([...without(c.id), c], view.config.shipsMayTouch) };
    },
  };
}

function Dock({ placement, disabled, send }: { placement: Placement | null; disabled: boolean; send: (op: BsOp) => Promise<boolean> }) {
  if (!placement) return null;
  const { ships, active } = placement;
  const done = ships.length === FLEET.length;
  return (
    <div className="bs-dock" data-testid="bs-dock">
      <div className="bs-dock-ships" role="group" aria-label="Your fleet">
        {FLEET.map((s) => {
          const placed = ships.some((p) => p.id === s.id);
          return (
            <button
              key={s.id}
              type="button"
              className={`bs-dock-ship ${active === s.id ? "on" : ""} ${placed ? "placed" : ""}`}
              aria-pressed={active === s.id}
              disabled={disabled}
              onClick={() => placement.select(s.id)}
            >
              <span className="bs-dock-hull" aria-hidden>
                {Array.from({ length: s.size }, (_, i) => (
                  <i key={i} />
                ))}
              </span>
              <span className="bs-dock-name">
                {s.name} <span className="bs-dock-size">{s.size}</span>
              </span>
              {placed && <span className="bs-dock-check" aria-label="placed">✓</span>}
            </button>
          );
        })}
      </div>
      <div className="bs-dock-actions">
        <span className="bs-hint">
          {done ? "All at sea. Click a ship to move it, or you're ready." : `Click your waters to place the ${shipName(active!)}.`} <kbd>R</kbd> turns it.
        </span>
        <span className="row wrap">
          <button type="button" className="btn subtle small" disabled={disabled} onClick={placement.rotate}>
            Rotate ({placement.vertical ? "down" : "across"})
          </button>
          <button type="button" className="btn subtle small" disabled={disabled} onClick={() => send({ type: "random" })}>
            Random
          </button>
          <button type="button" className="btn subtle small" disabled={disabled || ships.length === 0} onClick={() => send({ type: "arrange", ships: [] })}>
            Clear
          </button>
          <button type="button" className="btn primary" disabled={disabled || !done} onClick={() => send({ type: "ready" })}>
            Ready
          </button>
        </span>
      </div>
    </div>
  );
}

// --- the boards ---------------------------------------------------------------

function Board(props: {
  view: BsView;
  side: Side;
  board: BoardView | null;
  mine: boolean;
  /** You're aiming at it. */
  target: boolean;
  /** Whoever's shooting is aiming at it. */
  underFire: boolean;
  placement: Placement | null;
  /** The shot landing on this sea right now, if any. */
  landing: Shot | null;
  disabled: boolean;
  onFire(cell: number): void;
  caption: ReactNode;
  /** Shown over the sea while it's resting (the other side, while fleets are placed). */
  note: string | null;
}) {
  const { view, side, board, placement } = props;
  const shots = new Map((board?.shots ?? []).map((s) => [s.cell, s.hit]));
  const sunkIds = new Set((board?.sunk ?? []).map((s) => s.id));
  const sunkCells = new Set((board?.sunk ?? []).flatMap((s) => s.cells));
  const last = [...view.log].reverse().find((e) => e.type === "shot" && e.target === board?.playerId);
  const lastCell = last?.type === "shot" ? last.cell : null;
  // Ships you can see: your own, everyone's once it's over, and sunk ones.
  const ships: { id: ShipId; cells: number[]; vertical: boolean; sunk: boolean }[] = board?.ships
    ? board.ships.map((s) => ({ id: s.id, cells: shipCells(s)!, vertical: s.vertical, sunk: sunkIds.has(s.id) }))
    : (board?.sunk ?? []).map((s) => ({ id: s.id, cells: s.cells, vertical: s.cells.length > 1 && s.cells[1]! - s.cells[0]! === SIZE, sunk: true }));
  const preview = placement && placement.hover !== null ? placement.preview(placement.hover) : null;
  const previewCells = new Set(preview?.cells ?? []);
  const classes = ["bs-board", props.target && "target", props.underFire && "under-fire", placement && "placing", props.mine && "mine", props.note && "resting"].filter(Boolean).join(" ");

  return (
    <div className="bs-board-wrap">
      <div className={classes} data-testid={`bs-board-${side}`}>
        <div className="bs-grid" onPointerLeave={() => placement?.setHover(null)}>
          <div className="bs-water" aria-hidden />
          {Array.from({ length: SIZE }, (_, i) => (
            <span key={`c${i}`} className="bs-label" style={{ gridRow: 1, gridColumn: i + 2 }} aria-hidden>
              {LETTERS[i]}
            </span>
          ))}
          {Array.from({ length: SIZE }, (_, i) => (
            <span key={`r${i}`} className="bs-label" style={{ gridRow: i + 2, gridColumn: 1 }} aria-hidden>
              {i + 1}
            </span>
          ))}
          {ships.map((s) => {
            const r = rowOf(s.cells[0]!);
            const c = colOf(s.cells[0]!);
            return (
              <div
                key={s.id}
                className={`bs-ship ${s.vertical ? "vertical" : ""} ${s.sunk ? "sunk" : ""} ${props.landing?.ship === s.id ? "sinking" : ""} ${placement?.active === s.id && placement.hover !== null ? "moving" : ""}`}
                style={{ gridRow: s.vertical ? `${r + 2} / span ${s.cells.length}` : r + 2, gridColumn: s.vertical ? c + 2 : `${c + 2} / span ${s.cells.length}` }}
                data-ship={s.id}
                data-cells={s.cells.join(" ")}
                aria-hidden
              />
            );
          })}
          {Array.from({ length: SIZE * SIZE }, (_, cell) => {
            const hit = shots.get(cell);
            const fired = hit !== undefined;
            const canFire = props.target && !fired;
            const canPlace = !!placement;
            const cls = [
              "bs-cell",
              fired && (hit ? "hit" : "miss"),
              sunkCells.has(cell) && "sunk",
              cell === lastCell && "last",
              cell === props.landing?.cell && "landing",
              previewCells.has(cell) && (preview!.ok ? "preview" : "preview bad"),
            ]
              .filter(Boolean)
              .join(" ");
            return (
              <button
                key={cell}
                type="button"
                className={cls}
                style={{ gridRow: rowOf(cell) + 2, gridColumn: colOf(cell) + 2 }}
                disabled={props.disabled || !(canFire || canPlace)}
                onClick={() => (canPlace ? placement!.click(cell) : canFire && props.onFire(cell))}
                onPointerEnter={() => placement?.setHover(cell)}
                aria-label={`${coord(cell)}${fired ? (hit ? ", hit" : ", miss") : ""}`}
                data-testid={`bs-cell-${side}-${cell}`}
                data-shot={fired ? (hit ? "hit" : "miss") : undefined}
              >
                {fired && <span className="bs-peg" aria-hidden />}
              </button>
            );
          })}
        </div>
        {props.note && <div className="bs-note label">{props.note}</div>}
      </div>
      <div className="bs-caption">{props.caption}</div>
    </div>
  );
}

function caption(view: BsView, board: BoardView | null, mine: boolean, owner: string | null): ReactNode {
  const whose = mine ? "Your waters" : owner ? `${owner}'s waters` : "Open sea";
  if (!board || view.phase === "placing") return <span className="label">{whose}</span>;
  const afloat = FLEET.length - board.sunk.length;
  return (
    <span className="label">
      {whose} · {afloat} of {FLEET.length} ships afloat
    </span>
  );
}

function SidePlate(props: {
  view: BsView;
  side: Side;
  board: BoardView | null;
  ownerId: string | null;
  me: string;
  name(id: string): string;
  online: boolean;
  serverNow: number;
}) {
  const { view, side, board, ownerId } = props;
  const seat = view.seats[side];
  if (!ownerId) {
    return (
      <div className="bs-open-seat">
        <span className="label">Open seat</span>
      </div>
    );
  }
  const shooting = view.phase === "firing" && view.turn === side;
  const placing = view.phase === "placing" && board && !board.ready;
  const won = view.phase === "over" && view.result?.winner === ownerId;
  const wins = seat?.playerId === ownerId ? seat.wins : null;
  let status = "";
  if (view.phase === "placing") status = board?.ready ? "ready" : "placing…";
  else if (view.phase === "firing") status = shooting ? "aiming…" : "";
  else if (seat?.playerId !== ownerId) status = "left";
  const winsText = wins === null ? "" : `${wins} ${wins === 1 ? "win" : "wins"}`;
  return (
    <PlayerPlate
      playerId={ownerId}
      name={props.name(ownerId)}
      you={ownerId === props.me}
      online={props.online}
      active={shooting}
      winner={won}
      testId={`bs-plate-${side}`}
    >
      <div className={`plate-line status ${board?.ready && view.phase === "placing" ? "good" : ""}`}>{[status, winsText].filter(Boolean).join(" · ") || " "}</div>
      {shooting && <TurnTimer deadline={view.turnDeadline} totalMs={view.config.turnSeconds * 1000} serverNow={props.serverNow} />}
      {placing && <TurnTimer deadline={view.placeDeadline} totalMs={view.config.placeSeconds * 1000} serverNow={props.serverNow} />}
    </PlayerPlate>
  );
}

// --- words --------------------------------------------------------------------

/** One event, as the viewer should hear it. */
function describe(e: BsEvent, me: string, name: (id: string) => string, myBoard: BoardView | null): string {
  if (e.type === "forfeit") {
    const who = e.who === me ? "You" : name(e.who);
    return e.reason === "left" ? `${who} left the battle.` : `${who} ran out of time three times in a row.`;
  }
  const who = e.by === me ? "You" : name(e.by);
  const whose = e.target === me ? "your" : `${name(e.target)}'s`;
  const at = coord(e.cell);
  const auto = e.auto ? `Out of time: a random shot for ${e.by === me ? "you" : name(e.by)}. ` : "";
  if (e.result === "sunk") return `${auto}${at}: ${who} sank ${whose} ${shipName(e.ship!)}!`;
  if (e.result === "hit") {
    // Your own ships you know, so say which one was hit.
    const mine = e.target === me && myBoard?.ships?.find((s) => shipCells(s)!.includes(e.cell));
    return mine ? `${auto}${who} hit your ${shipName(mine.id)} at ${at}!` : `${auto}${who} fired at ${at}: hit!`;
  }
  return `${auto}${who} fired at ${at}: miss.`;
}

function News({ view, me, name, myBoard }: { view: BsView; me: string; name(id: string): string; myBoard: BoardView | null }) {
  if (view.phase === "over" && view.result) {
    const r = view.result;
    const winner = r.winner === me ? "You win!" : `${name(r.winner)} wins!`;
    const how =
      r.forfeit === "left"
        ? `${r.loser === me ? "You" : name(r.loser)} left the battle.`
        : r.forfeit === "timeouts"
          ? `${r.loser === me ? "You" : name(r.loser)} ran out of time three times in a row.`
          : `${r.winner === me ? "You" : name(r.winner)} sank ${r.loser === me ? "your" : `${name(r.loser)}'s`} whole fleet in ${r.shots} shots.`;
    return (
      <div data-testid="bs-result">
        <Herald big className="bs-news">
          <span>{winner}</span>
          <span className="bs-news-sub">{how} Both fleets are on show.</span>
        </Herald>
      </div>
    );
  }
  const recent = view.log.slice(-2);
  let lines: ReactNode;
  if (view.phase === "waiting") lines = <span>{view.game === 0 ? "Hide your fleet, then take turns firing blind." : "The game was called off. Waiting for two players."}</span>;
  else if (view.phase === "placing") lines = <span>Fleets are being hidden. Neither side can see the other's ships.</span>;
  else if (!recent.length) lines = <span>All fleets at sea. Open fire!</span>;
  else {
    lines = (
      <>
        {recent.length > 1 && <span className="muted">{describe(recent[0]!, me, name, myBoard)}</span>}
        <span className={`bs-latest ${recent.at(-1)!.type === "shot" ? (recent.at(-1) as { result: string }).result : ""}`}>{describe(recent.at(-1)!, me, name, myBoard)}</span>
      </>
    );
  }
  return (
    <Herald testId="bs-news" className="bs-news">
      {lines}
    </Herald>
  );
}

function trayStatus(view: BsView, me: string, name: (id: string) => string, myTurn: boolean): string {
  const shooter = view.turn !== null ? view.boards[view.turn]?.playerId : undefined;
  const target = view.turn !== null ? view.boards[1 - view.turn]?.playerId : undefined;
  if (view.phase === "firing") {
    if (myTurn) return `Your shot: pick a cell in ${name(target!)}'s waters.`;
    if (target === me) return `${name(shooter!)} is aiming at your waters…`;
    return `${name(shooter!)} is aiming at ${name(target!)}'s waters…`;
  }
  if (view.phase === "placing") return "Both sides are placing their fleets.";
  if (view.phase === "over") {
    if (view.you.seat === null) return view.seats.some((s) => !s) ? "Take the open seat to play the next game." : "You're watching.";
    return view.canRematch ? "Fancy another?" : "Waiting for an opponent to sit down.";
  }
  return "";
}

function TrayAside(props: { view: BsView; mySeat: Side | null; busy: boolean; connected: boolean; send(op: BsOp): void }) {
  const { view, mySeat } = props;
  const disabled = props.busy || !props.connected;
  if (view.phase === "placing" && mySeat !== null && view.boards[mySeat]?.ready) {
    return (
      <button className="btn subtle" disabled={disabled} onClick={() => props.send({ type: "unready" })}>
        Change fleet
      </button>
    );
  }
  if (view.phase !== "over") return null;
  if (mySeat === null) {
    const open = SIDES.find((s) => !view.seats[s]);
    return open === undefined ? null : (
      <button className="btn subtle" disabled={disabled} onClick={() => props.send({ type: "sit", seat: open })}>
        Take the open seat
      </button>
    );
  }
  return view.canRematch ? (
    <button className="btn primary" disabled={disabled} onClick={() => props.send({ type: "rematch" })}>
      Play again
    </button>
  ) : null;
}
