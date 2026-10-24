import { type CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import { reducedMotion } from "../../kit/ui/Flights";
import { Clock } from "../../kit/ui/Clock";
import { GameOver } from "../../kit/ui/GameOver";
import { PlayerPlate } from "../../kit/ui/PlayerPlate";
import { playerStyle, usePlayerColors } from "../../../ui";
import type { GameUIProps } from "../../ui";
import { type FourView, resultText, type Side } from "../engine";
import type { FourOp } from "../index";
import { drop, fourThrough, landing, other, type Piece } from "../rules";
import { Board } from "./Board";
import { discColors } from "./colors";
import "./fourinarow.css";

type Props = GameUIProps<FourView, FourOp>;

/** How long the winning line shows before the results come up over it, for a game that ends while you watch. */
const RESULT_DELAY_MS = 1600;

export function FourGame({ view, me, members, connected, sendOp, serverNow }: Props) {
  const name = (id: string) => members.get(id)?.name ?? "Player";
  const [busy, setBusy] = useState(false);
  const send = async (op: FourOp) => {
    setBusy(true);
    const ok = await sendOp(op);
    setBusy(false);
    return ok;
  };

  const myPiece = view.you.piece;
  const size = view.size;
  // Your move shows at once; it's taken back if the server says no.
  const [pending, setPending] = useState<{ base: string; column: number } | null>(null);
  const shown = useMemo((): { board: string; last: number | null; line: number[] } => {
    const line = view.result?.cells ?? [];
    const fromView = { board: view.board, last: view.lastMove?.cell ?? null, line };
    if (!pending || pending.base !== view.board || !myPiece || landing(view.board, size, pending.column - 1) === null) return fromView;
    const after = drop(view.board, size, myPiece, pending.column - 1);
    return { board: after.board, last: after.cell, line: fourThrough(after.board, size, after.cell) };
  }, [pending, view.board, view.lastMove, view.result, myPiece, size]);
  const move = async (column: number) => {
    setPending({ base: view.board, column });
    if (!(await sendOp({ type: "drop", column }))) setPending(null);
  };

  const mySeat = view.you.seat;
  const playing = view.phase === "playing";
  const myTurn = playing && myPiece === view.turn;
  const open = ([0, 1] as Side[]).filter((s) => !view.seats[s]);
  const prompt: "pick" | "wait" | null = view.phase !== "waiting" ? null : mySeat === null ? "pick" : "wait";
  const bottom: Piece = myPiece ?? "x";

  /** Who plays a piece: whoever's in its seat, or (after a game) whoever played it. */
  const playerOf = (p: Piece): string | null => {
    const seat = p === "x" ? view.xSeat : 1 - view.xSeat;
    return view.seats[seat]?.playerId ?? (view.phase === "over" ? (view.sides?.[p] ?? null) : null);
  };
  const colorOf = usePlayerColors();
  const colorFor = (p: Piece) => {
    const id = playerOf(p);
    // An open seat gets a stand-in color, far from the other side's.
    return id ? colorOf(id) : p === "x" ? 0 : 6;
  };
  const colors = discColors({ x: colorFor("x"), o: colorFor("o") }, myPiece ?? "x");

  // The results wait a moment after a game ends on the board while you watch, so the winning line is seen first.
  const over = view.phase === "over" && !!view.result;
  const [showResult, setShowResult] = useState(over);
  const was = useRef({ phase: view.phase, game: view.game });
  useEffect(() => {
    const before = was.current;
    was.current = { phase: view.phase, game: view.game };
    if (!over) return setShowResult(false);
    const live = before.phase === "playing" && before.game === view.game && (view.result!.reason === "four" || view.result!.reason === "full");
    if (!live || reducedMotion()) return setShowResult(true);
    const t = setTimeout(() => setShowResult(true), RESULT_DELAY_MS);
    return () => clearTimeout(t);
  }, [over, view.game]);

  const side = (p: Piece, where: "top" | "bottom") => (
    <SidePlate key={p} where={where} piece={p} color={colors[p]} view={view} playerId={playerOf(p)} me={me} name={name} online={(id) => members.get(id)?.online !== false} serverNow={serverNow} />
  );

  return (
    <div className="fiar" style={{ "--ratio": (size.columns + 0.6) / (size.rows + 1.74) } as CSSProperties} data-testid="fiar">
      <div className="fiar-grid">
        {side(other(bottom), "top")}
        <div className="fiar-board-wrap">
          <Board
            size={size}
            board={shown.board}
            game={view.game}
            last={view.phase === "waiting" ? null : shown.last}
            line={shown.line}
            colors={colors}
            movable={myTurn && connected && shown.board === view.board ? myPiece : null}
            onDrop={move}
          >
            {prompt && (
              <div className="fiar-prompt-backdrop">
                {prompt === "pick" ? (
                  <div className="fiar-prompt box" role="dialog" aria-label="Take a seat">
                    <h3 className="display">{open.length === 2 ? "Play Four in a Row" : `Take on ${name(view.seats[1 - open[0]!]!.playerId)}`}</h3>
                    <p className="muted">{open.length === 2 ? "Sit down and someone else takes the other side. Your discs are your color." : "The game starts as soon as you sit down."}</p>
                    <button className="btn primary big" disabled={!connected || busy} onClick={() => send({ type: "sit", seat: open[0]! })} data-testid="fiar-sit">
                      Take a seat
                    </button>
                  </div>
                ) : (
                  <div className="fiar-prompt box" role="status">
                    <h3 className="display">Waiting for an opponent</h3>
                    <p className="muted">Share the room link (Copy invite link, at the top) so someone can take the other side.</p>
                  </div>
                )}
              </div>
            )}
          </Board>
        </div>
        {side(bottom, "bottom")}

        <div className="fiar-panel box">
          <Moves moves={view.moves} colors={colors} />
          {view.lastMove && view.phase !== "waiting" && <LastMoveLine view={view} color={colors[view.lastMove.by]} me={me} name={name} />}
          <Status view={view} me={me} name={name} myTurn={myTurn} />
          <Controls view={view} busy={busy} connected={connected} send={send} />
        </div>
      </div>

      <FourResult view={view} open={showResult} me={me} name={name} rematch={view.canRematch && mySeat !== null ? () => send({ type: "rematch" }) : null} disabled={busy || !connected} />

      {mySeat !== null && (
        <div className="table-footer">
          <div className="table-footer-log" />
          <div className="table-footer-actions">
            <button className="btn ghost small" disabled={!connected || busy} onClick={() => send({ type: "leave" })}>
              {playing ? (view.moves.some((m) => m.by === myPiece) ? "Resign & leave" : "Leave (calls the game off)") : "Leave seat"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** A disc in a palette color, for names and lists. */
function Mini({ color, label }: { color: number; label?: string }) {
  return <i className="fiar-mini" style={playerStyle(color)} aria-label={label} aria-hidden={label ? undefined : true} />;
}

// --- the players --------------------------------------------------------------

function SidePlate(props: {
  where: "top" | "bottom";
  piece: Piece;
  color: number;
  view: FourView;
  playerId: string | null;
  me: string;
  name(id: string): string;
  online(id: string): boolean;
  serverNow: number;
}) {
  const { view, piece: p, playerId } = props;
  const seat = view.seats.find((s) => s?.playerId === playerId) ?? null;
  const won = view.phase === "over" && view.result?.winner === p;
  const toMove = view.phase === "playing" && view.turn === p;
  const order = view.phase === "over" ? (p === "x" ? "Started" : "Second") : p === "x" ? "Starts" : "Second";
  return (
    <div className={`fiar-side ${props.where}`} data-testid={`fiar-side-${p}`}>
      {playerId ? (
        <PlayerPlate playerId={playerId} name={props.name(playerId)} you={playerId === props.me} online={props.online(playerId)} active={toMove} winner={won} dim={!seat}>
          <div className="plate-line fiar-plate-line">
            <span className="fiar-plate-disc">
              <Mini color={props.color} />
              {order}
            </span>
            <span className="fiar-wins">{seat ? `${seat.wins} ${seat.wins === 1 ? "win" : "wins"}` : "left"}</span>
          </div>
        </PlayerPlate>
      ) : (
        <div className="fiar-open-seat">
          <span className="label">Open seat</span>
        </div>
      )}
      {view.clock && <Clock clock={view.clock} side={p} serverNow={props.serverNow} testId={`fiar-clock-${p}`} />}
    </div>
  );
}

// --- the panel ----------------------------------------------------------------

function Moves({ moves, colors }: { moves: FourView["moves"]; colors: { x: number; o: number } }) {
  const ref = useRef<HTMLOListElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTo({ top: el.scrollHeight, left: el.scrollWidth });
  }, [moves.length]);
  return (
    <ol className="fiar-moves" ref={ref} aria-label="Moves (the column of each disc)" data-testid="fiar-moves">
      {moves.length === 0 && <li className="fiar-moves-empty muted">No discs yet.</li>}
      {moves.map((m, i) => (
        <li key={i} className={i === moves.length - 1 ? "last" : ""}>
          <span className="fiar-move-num">{i + 1}</span>
          <Mini color={colors[m.by]} />
          {m.column}
        </li>
      ))}
    </ol>
  );
}

/** The last move in words: "Bob dropped a disc in column 4." */
function LastMoveLine({ view, color, me, name }: { view: FourView; color: number; me: string; name(id: string): string }) {
  const last = view.lastMove!;
  const id = view.sides?.[last.by];
  const who = id === me ? "You" : id ? name(id) : "Someone";
  return (
    <div className="fiar-last" data-testid="fiar-last">
      <Mini color={color} /> {who} dropped a disc in column {last.column}.
    </div>
  );
}

function Status({ view, me, name, myTurn }: { view: FourView; me: string; name(id: string): string; myTurn: boolean }) {
  let text: string;
  let tone = "";
  if (view.phase === "over" && view.result) {
    const who = (p: Piece) => (view.sides?.[p] === me ? "You" : name(view.sides?.[p] ?? ""));
    text = resultText(view.result, who).replace("You wins", "You win");
    tone = view.result.winner === null ? "draw" : view.sides?.[view.result.winner] === me ? "won" : view.you.piece ? "lost" : "";
  } else if (view.phase === "playing") {
    const mover = view.sides?.[view.turn];
    text = myTurn ? "Your move." : `${mover ? name(mover) : "The other side"} to move…`;
    if (myTurn) tone = "turn";
  } else text = view.game === 0 ? "Get four in a row: across, up and down, or diagonally." : "The game was called off. Waiting for two players.";
  return (
    <div className={`fiar-status ${tone}`} aria-live="polite" data-testid="fiar-status">
      {text}
    </div>
  );
}

function Controls(props: { view: FourView; busy: boolean; connected: boolean; send(op: FourOp): Promise<boolean> }) {
  const { view, send } = props;
  const [confirm, setConfirm] = useState(false);
  const disabled = props.busy || !props.connected;
  const playing = view.phase === "playing" && view.you.piece !== null;
  useEffect(() => setConfirm(false), [view.phase, view.game]);

  if (playing && confirm) {
    return (
      <div className="fiar-controls">
        <span>Resign this game?</span>
        <span className="row">
          <button className="btn danger small" disabled={disabled} onClick={() => send({ type: "resign" })} data-testid="fiar-resign-yes">
            Resign
          </button>
          <button className="btn small" onClick={() => setConfirm(false)}>
            Keep playing
          </button>
        </span>
      </div>
    );
  }
  if (playing) {
    return (
      <div className="fiar-controls">
        <button className="btn small" disabled={disabled} onClick={() => setConfirm(true)} data-testid="fiar-resign">
          ⚑ Resign
        </button>
        <span className="muted fiar-keys">← → and Enter to play</span>
      </div>
    );
  }
  const openSeat = ([0, 1] as Side[]).find((s) => !view.seats[s]);
  if (view.phase !== "over") return null;
  if (view.you.seat !== null && !view.canRematch) {
    return (
      <div className="fiar-controls">
        <span className="muted">Waiting for an opponent to sit down.</span>
      </div>
    );
  }
  if (view.you.seat === null && openSeat !== undefined) {
    return (
      <div className="fiar-controls">
        <button className="btn" disabled={disabled} onClick={() => send({ type: "sit", seat: openSeat })}>
          Take the open seat
        </button>
      </div>
    );
  }
  return null;
}

const HOW = { resign: "by resignation", timeout: "on time", left: "(the other player left)" } as const;

/** The end of a game: who won and how, and the score between the two in this room. */
function FourResult(props: { view: FourView; open: boolean; me: string; name(id: string): string; rematch: (() => void) | null; disabled: boolean }) {
  const { view, me, name } = props;
  const r = view.result;
  const sides = view.sides;
  let title = "";
  let subtitle = "";
  if (r && sides) {
    if (r.winner) {
      title = sides[r.winner] === me ? "You win!" : `${name(sides[r.winner])} wins!`;
      subtitle = r.reason === "four" ? `Four in a row, with disc ${view.moves.length}.` : `Won ${HOW[r.reason as keyof typeof HOW]}, after ${view.moves.length} discs.`;
    } else {
      title = "A draw";
      subtitle = "The board is full and nobody got four in a row.";
    }
  }
  const order: Piece[] = r?.winner === "o" ? ["o", "x"] : ["x", "o"];
  // Who starts the next game, for the button.
  const nextStarter = view.seats[view.nextXSeat]?.playerId;
  const starts = nextStarter === me ? "you start" : nextStarter ? `${name(nextStarter)} starts` : "";
  return (
    <GameOver
      open={props.open && view.phase === "over" && !!r && !!sides}
      gameKey={view.game}
      me={me}
      testId="fiar-result"
      title={title}
      subtitle={subtitle}
      columns={["Played", "Discs", "Wins here"]}
      rows={order.flatMap((p) => {
        const id = sides?.[p];
        if (!id || !r) return [];
        const seat = view.seats.find((s) => s?.playerId === id);
        return [{ playerId: id, name: name(id), winner: r.winner === p, left: !seat, cells: [p === "x" ? "First" : "Second", view.moves.filter((m) => m.by === p).length, seat?.wins ?? "–"] }];
      })}
      actions={
        props.rematch && (
          <button className="btn primary" disabled={props.disabled} onClick={props.rematch}>
            Play again{starts && ` (${starts})`}
          </button>
        )
      }
    />
  );
}
