/**
 * The parts of a two-player board game's page (kit/duel games: chess, Othello, Go, Four
 * in a Row, Luffarschack): the board with a player above and below it (beside it, on a
 * wide screen), a panel of moves, status and controls, the result, and the footer.
 * The game brings its board and whatever is its own; these bring the table around it.
 */
import { type CSSProperties, type ReactNode, useEffect, useRef, useState } from "react";
import type { DuelSeat, DuelView, Side } from "../duel";
import { Button, busyWhy } from "../../../ui";
import { reducedMotion } from "./Flights";
import { GameOver } from "./GameOver";
import { PlayerPlate } from "./PlayerPlate";
import { TableFooter } from "./GameParts";
import "./duel.css";

/** What these parts need of a game's view. */
type Table<C extends string> = DuelView<C, string> & { turn: C; result: { winner: C | null } | null };

/** The table moves these parts send. */
type DuelOp = { type: "sit"; seat: number } | { type: "leave" } | { type: "resign" } | { type: "rematch" };

/** Who sits on a color's side: whoever's in its seat, or (after a game) whoever played it. */
export function playerOf<C extends string>(view: Table<C>, colors: readonly [C, C], c: C): string | null {
  const seat = c === colors[0] ? view.openerSeat : 1 - view.openerSeat;
  return view.seats[seat]?.playerId ?? (view.phase === "over" ? (view.sides?.[c] ?? null) : null);
}

/** "3 wins", or "left" for someone who's stood up since. */
export const winsText = (seat: DuelSeat | null | undefined) => (seat ? `${seat.wins} ${seat.wins === 1 ? "win" : "wins"}` : "left");

/**
 * The page. `ratio` is the board's width over its height, and `max` its widest (px).
 * `children` go under the table (the result, the footer).
 */
export function DuelTable(props: {
  className: string;
  testId: string;
  ratio?: number;
  max?: number;
  top: ReactNode;
  board: ReactNode;
  bottom: ReactNode;
  panel: ReactNode;
  children?: ReactNode;
}) {
  const style = { "--duel-ratio": props.ratio ?? 1, "--duel-max": `${props.max ?? 920}px` } as CSSProperties;
  return (
    <div className={`duel ${props.className}`} style={style} data-testid={props.testId}>
      <div className="duel-grid">
        {props.top}
        <div className="duel-board">{props.board}</div>
        {props.bottom}
        <div className="duel-panel box">{props.panel}</div>
      </div>
      {props.children}
    </div>
  );
}

/** A player's side of the table: their plate (or an open seat), and their clock. */
export function DuelSide<C extends string>(props: {
  view: Table<C>;
  colors: readonly [C, C];
  color: C;
  where: "top" | "bottom";
  me: string;
  name(id: string): string;
  online(id: string): boolean;
  testId: string;
  /** For the open seat: "Open seat · White". */
  label?: string;
  clock?: ReactNode;
  /** The plate's own line (pieces taken, discs, wins). */
  children?: ReactNode;
}) {
  const { view, color: c } = props;
  const playerId = playerOf(view, props.colors, c);
  const seated = view.seats.some((s) => s?.playerId === playerId);
  return (
    <div className={`duel-side ${props.where}`} data-testid={props.testId}>
      {playerId ? (
        <PlayerPlate
          playerId={playerId}
          name={props.name(playerId)}
          you={playerId === props.me}
          online={props.online(playerId)}
          active={view.phase === "playing" && view.turn === c}
          winner={view.phase === "over" && view.result?.winner === c}
          dim={!seated}
        >
          <div className="plate-line duel-plate-line">{props.children}</div>
        </PlayerPlate>
      ) : (
        <div className="duel-open-seat">
          <span className="label">Open seat{props.label ? ` · ${props.label}` : ""}</span>
        </div>
      )}
      {props.clock}
    </div>
  );
}

/** Over the board while the game waits for players: take a seat, or wait for someone to. */
export function SeatPrompt(props: {
  view: Table<string>;
  /** "Chess", for "Play chess". */
  game: string;
  /** What sitting down means, before anyone has. */
  blurb: string;
  name(id: string): string;
  /** Why sitting down can't be done this moment (`busyWhy`), if it can't. */
  why: string | null;
  send(op: DuelOp): unknown;
  testId: string;
}) {
  const { view } = props;
  if (view.phase !== "waiting") return null;
  const open = ([0, 1] as Side[]).filter((s) => !view.seats[s]);
  return (
    <div className="duel-prompt-backdrop">
      {view.you.seat === null ? (
        <div className="duel-prompt box" role="dialog" aria-label="Take a seat">
          <h3 className="display">{open.length === 2 ? `Play ${props.game}` : `Take on ${props.name(view.seats[1 - open[0]!]!.playerId)}`}</h3>
          <p className="muted">{open.length === 2 ? props.blurb : "The game starts as soon as you sit down."}</p>
          <Button className="btn primary big" why={props.why} onClick={() => props.send({ type: "sit", seat: open[0]! })} data-testid={props.testId}>
            Take a seat
          </Button>
        </div>
      ) : (
        <div className="duel-prompt box" role="status">
          <h3 className="display">Waiting for an opponent</h3>
          <p className="muted">Share the room link (the people icon by the room name, at the top) so someone can take the other side.</p>
        </div>
      )}
    </div>
  );
}

/**
 * The line saying where the game is: the result, whose move it is, or what's to come.
 * `result` words it with "You" for you; `label` names a color ("White to move (Bob)…").
 */
export function DuelStatus<C extends string>(props: {
  view: Table<C>;
  me: string;
  name(id: string): string;
  myTurn: boolean;
  result(who: (c: C) => string): string;
  /** Before the first game. */
  intro: string;
  label?(c: C): string;
  yourMove?: string;
  /** Overrides, for a phase of the game's own (counting) or a twist (check). */
  text?: string;
  tone?: string;
  testId: string;
}) {
  const { view, me, name } = props;
  let text: string;
  let tone = "";
  if (props.text !== undefined) text = props.text;
  else if (view.phase === "over" && view.result) {
    const who = (c: C) => (view.sides?.[c] === me ? "You" : name(view.sides?.[c] ?? ""));
    text = props.result(who).replace("You wins", "You win");
    const w = view.result.winner;
    tone = w === null ? "draw" : view.sides?.[w] === me ? "won" : view.you.color ? "lost" : "";
  } else if (view.phase === "playing") {
    const mover = view.sides?.[view.turn];
    const who = mover ? name(mover) : null;
    text = props.myTurn ? (props.yourMove ?? "Your move.") : props.label ? `${props.label(view.turn)} to move${who ? ` (${who})` : ""}…` : `${who ?? "The other side"} to move…`;
    if (props.myTurn) tone = "turn";
  } else if (view.phase === "waiting") text = view.game === 0 ? props.intro : "The game was called off. Waiting for two players.";
  else text = "";
  return (
    <div className={`duel-status ${props.tone ?? tone}`} aria-live="polite" data-testid={props.testId}>
      {text}
    </div>
  );
}

/**
 * Your controls: while you're playing, the game's own (`children`) and resigning (behind
 * a confirm); after a game, a seat to take or the wait for an opponent. `aside` is
 * always there, on the right (a flip button, a keyboard hint).
 */
export function DuelControls(props: {
  view: Table<string>;
  busy: boolean;
  connected: boolean;
  send(op: DuelOp): unknown;
  /** Prefix for test ids: `${testId}-resign`, `${testId}-resign-yes`. */
  testId: string;
  /** In a game you can resign from (default: you're playing). */
  playing?: boolean;
  children?: ReactNode;
  aside?: ReactNode;
}) {
  const { view, send } = props;
  const [confirm, setConfirm] = useState(false);
  const why = busyWhy(props);
  const playing = props.playing ?? (view.phase === "playing" && view.you.color !== null);
  useEffect(() => setConfirm(false), [view.phase, view.game]);

  let main: ReactNode = null;
  if (playing && confirm) {
    return (
      <div className="duel-controls">
        <span>Resign this game?</span>
        <span className="row">
          <Button className="btn danger small" why={why} onClick={() => send({ type: "resign" })} data-testid={`${props.testId}-resign-yes`}>
            Resign
          </Button>
          <button className="btn small" onClick={() => setConfirm(false)}>
            Keep playing
          </button>
        </span>
      </div>
    );
  }
  if (playing) {
    main = (
      <span className="row">
        {props.children}
        <Button className="btn small" why={why} onClick={() => setConfirm(true)} data-testid={`${props.testId}-resign`}>
          ⚑ Resign
        </Button>
      </span>
    );
  } else if (view.phase === "over") {
    const openSeat = ([0, 1] as Side[]).find((s) => !view.seats[s]);
    if (view.you.seat !== null && !view.canRematch) main = <span className="muted">Waiting for an opponent to sit down.</span>;
    else if (view.you.seat === null && openSeat !== undefined) {
      main = (
        <Button className="btn" why={why} onClick={() => send({ type: "sit", seat: openSeat })}>
          Take the open seat
        </Button>
      );
    }
  }
  if (!main && !props.aside) return null;
  return (
    <div className="duel-controls">
      {main ?? <span />}
      {props.aside}
    </div>
  );
}

/** A list of moves that keeps the latest in sight. */
export function DuelMoves(props: { count: number; label: string; testId: string; className?: string; children: ReactNode }) {
  const ref = useRef<HTMLOListElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTo({ top: el.scrollHeight, left: el.scrollWidth });
  }, [props.count]);
  return (
    <ol className={`duel-moves ${props.className ?? ""}`} ref={ref} aria-label={props.label} data-testid={props.testId}>
      {props.count === 0 && <li className="duel-moves-empty muted">No moves yet.</li>}
      {props.children}
    </ol>
  );
}

/**
 * The end of a game: who won, how (`subtitle`), the two players with the game's
 * `columns` (`cells` for each color), and "Play again" (`again`: what that changes).
 */
export function DuelResult<C extends string>(props: {
  view: Table<C>;
  colors: readonly [C, C];
  me: string;
  name(id: string): string;
  subtitle: string;
  columns: string[];
  cells(c: C, seat: DuelSeat | undefined): ReactNode[];
  again: string;
  busy: boolean;
  connected: boolean;
  send(op: DuelOp): unknown;
  testId: string;
  /** False to hold it back for a moment (see `useResultDelay`). */
  open?: boolean;
}) {
  const { view, me, name } = props;
  const r = view.result;
  const sides = view.sides;
  const title = !r || !sides ? "" : r.winner === null ? "A draw" : sides[r.winner] === me ? "You win!" : `${name(sides[r.winner])} wins!`;
  const order: C[] = r?.winner === props.colors[1] ? [props.colors[1], props.colors[0]] : [...props.colors];
  return (
    <GameOver
      open={(props.open ?? true) && view.phase === "over" && !!r && !!sides}
      gameKey={view.game}
      me={me}
      testId={props.testId}
      title={title}
      subtitle={props.subtitle}
      columns={props.columns}
      rows={order.flatMap((c) => {
        const id = sides?.[c];
        if (!id || !r) return [];
        const seat = view.seats.find((s) => s?.playerId === id) ?? undefined;
        return [{ playerId: id, name: name(id), winner: r.winner === c, left: !seat, cells: props.cells(c, seat) }];
      })}
      actions={
        view.canRematch &&
        view.you.seat !== null && (
          <Button className="btn primary" why={busyWhy(props)} onClick={() => props.send({ type: "rematch" })}>
            Play again{props.again && ` (${props.again})`}
          </Button>
        )
      }
    />
  );
}

/** "you start" / "Bob starts", for the next game's button. */
export function nextStarter(view: Table<string>, me: string, name: (id: string) => string): string {
  const id = view.seats[view.nextOpenerSeat]?.playerId;
  return id === me ? "you start" : id ? `${name(id)} starts` : "";
}

/** Under the table: the game's own (`log`), and giving up your seat. */
export function DuelFooter(props: { view: Table<string>; moved: boolean; busy: boolean; connected: boolean; send(op: DuelOp): unknown; log?: ReactNode }) {
  const { view } = props;
  const inGame = view.phase !== "waiting" && view.phase !== "over";
  if (view.you.seat === null && !props.log) return null;
  return (
    <TableFooter
      log={props.log}
      actions={
        view.you.seat !== null && (
          <Button className="btn ghost small" why={busyWhy(props)} onClick={() => props.send({ type: "leave" })}>
            {inGame ? (props.moved ? "Resign & leave" : "Leave (calls the game off)") : "Leave seat"}
          </Button>
        )
      }
    />
  );
}

/**
 * Whether to show a game's result yet: after a game that ends on the board while you
 * watch (`onBoard`), a moment (`ms`) to see how before the results cover it.
 */
export function useResultDelay(view: Table<string> & { result: { reason: string } | null }, onBoard: (reason: string) => boolean, ms: number) {
  const over = view.phase === "over" && !!view.result;
  const [show, setShow] = useState(over);
  const was = useRef({ phase: view.phase, game: view.game });
  useEffect(() => {
    const before = was.current;
    was.current = { phase: view.phase, game: view.game };
    if (!over) return setShow(false);
    const live = before.phase === "playing" && before.game === view.game && onBoard(view.result!.reason);
    if (!live || reducedMotion()) return setShow(true);
    const t = setTimeout(() => setShow(true), ms);
    return () => clearTimeout(t);
  }, [over, view.game]);
  return show;
}
