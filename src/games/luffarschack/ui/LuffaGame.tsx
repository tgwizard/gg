import { type CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import { reducedMotion } from "../../kit/ui/Flights";
import { GameOver } from "../../kit/ui/GameOver";
import { PlayerPlate } from "../../kit/ui/PlayerPlate";
import { TurnTimer } from "../../kit/ui/TurnTimer";
import { playerStyle, usePlayerColors } from "../../../ui";
import type { GameUIProps } from "../../ui";
import { type LuffaView, resultText, type Side } from "../engine";
import type { LuffaOp } from "../index";
import { other, parseSquare, type Piece, place, winningRuns } from "../rules";
import { circlePath, crossPaths } from "./ink";
import { inkColors } from "./inkColors";
import { Sheet, sheetRatio } from "./Sheet";
import "./luffarschack.css";

type Props = GameUIProps<LuffaView, LuffaOp>;

/** How long the ringed five shows before the results come up over it, for a game that ends while you watch (the loop is done at 1.3 s). */
const RESULT_DELAY_MS = 2000;

const NAMES = { x: "cross", o: "circle" } as const;

export function LuffaGame({ view, me, members, connected, sendOp, serverNow }: Props) {
  const name = (id: string) => members.get(id)?.name ?? "Player";
  const [busy, setBusy] = useState(false);
  const send = async (op: LuffaOp) => {
    setBusy(true);
    const ok = await sendOp(op);
    setBusy(false);
    return ok;
  };

  const myPiece = view.you.piece;
  const n = view.size;
  // Your mark shows at once; it's taken back if the server says no.
  const [pending, setPending] = useState<{ base: string; cell: number } | null>(null);
  const shown = useMemo(() => {
    const fromView = { board: view.board, order: view.moves.map((m) => parseSquare(m.square, n)!), last: view.lastMove?.cell ?? null, runs: view.result?.runs ?? [], winner: view.result?.winner ?? null };
    if (!pending || pending.base !== view.board || !myPiece || view.board[pending.cell] !== ".") return fromView;
    const board = place(view.board, pending.cell, myPiece);
    const runs = winningRuns(board, n, pending.cell);
    return { board, order: [...fromView.order, pending.cell], last: pending.cell, runs, winner: runs.length ? myPiece : null };
  }, [pending, view.board, view.moves, view.lastMove, view.result, myPiece, n]);
  const mark = async (square: string) => {
    const cell = parseSquare(square, n);
    if (cell === null) return;
    setPending({ base: view.board, cell });
    if (!(await sendOp({ type: "mark", square }))) setPending(null);
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
    return id ? colorOf(id) : p === "x" ? 5 : 0;
  };
  const colors = inkColors({ x: colorFor("x"), o: colorFor("o") }, myPiece ?? "x");

  // The results wait a moment after a game ends on the paper while you watch, so the ringed five is seen first.
  const over = view.phase === "over" && !!view.result;
  const [showResult, setShowResult] = useState(over);
  const was = useRef({ phase: view.phase, game: view.game });
  useEffect(() => {
    const before = was.current;
    was.current = { phase: view.phase, game: view.game };
    if (!over) return setShowResult(false);
    const live = before.phase === "playing" && before.game === view.game && (view.result!.reason === "five" || view.result!.reason === "full");
    if (!live || reducedMotion()) return setShowResult(true);
    const t = setTimeout(() => setShowResult(true), RESULT_DELAY_MS);
    return () => clearTimeout(t);
  }, [over, view.game]);

  const side = (p: Piece, where: "top" | "bottom") => (
    <SidePlate key={p} where={where} piece={p} color={colors[p]} view={view} playerId={playerOf(p)} me={me} name={name} online={(id) => members.get(id)?.online !== false} />
  );

  return (
    <div className="lfs" style={{ "--ratio": sheetRatio(n) } as CSSProperties} data-testid="lfs">
      <div className="lfs-grid">
        {side(other(bottom), "top")}
        <div className="lfs-sheet-wrap">
          <Sheet
            n={n}
            board={shown.board}
            game={view.game}
            order={shown.order}
            last={view.phase === "waiting" ? null : shown.last}
            runs={shown.runs}
            winner={shown.winner}
            colors={colors}
            movable={myTurn && connected && shown.board === view.board ? myPiece : null}
            onMark={mark}
          >
            {prompt && (
              <div className="lfs-prompt-backdrop">
                {prompt === "pick" ? (
                  <div className="lfs-prompt box" role="dialog" aria-label="Take a seat">
                    <h3 className="display">{open.length === 2 ? "Play Luffarschack" : `Take on ${name(view.seats[1 - open[0]!]!.playerId)}`}</h3>
                    <p className="muted">{open.length === 2 ? "Sit down and someone else takes the other side. Your marks are inked in your color." : "The game starts as soon as you sit down."}</p>
                    <button className="btn primary big" disabled={!connected || busy} onClick={() => send({ type: "sit", seat: open[0]! })} data-testid="lfs-sit">
                      Take a seat
                    </button>
                  </div>
                ) : (
                  <div className="lfs-prompt box" role="status">
                    <h3 className="display">Waiting for an opponent</h3>
                    <p className="muted">Share the room link (the people icon by the room name, at the top) so someone can take the other side.</p>
                  </div>
                )}
              </div>
            )}
          </Sheet>
        </div>
        {side(bottom, "bottom")}

        <div className="lfs-panel box">
          {view.lastMove && view.phase !== "waiting" && <LastMoveLine view={view} color={colors[view.lastMove.by]} me={me} name={name} />}
          <Status view={view} me={me} name={name} myTurn={myTurn} />
          {playing && view.config.turnSeconds > 0 && (
            <div className="lfs-timer">
              <TurnTimer deadline={view.turnDeadline} totalMs={view.config.turnSeconds * 1000} serverNow={serverNow} />
            </div>
          )}
          <Controls view={view} busy={busy} connected={connected} send={send} />
        </div>
      </div>

      <LuffaResult view={view} open={showResult} me={me} name={name} rematch={view.canRematch && mySeat !== null ? () => send({ type: "rematch" }) : null} disabled={busy || !connected} />

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

/** A small inked cross or circle, for names and lines of text. */
export function Glyph({ piece, color, seed = 7, label }: { piece: Piece; color: number; seed?: number; label?: string }) {
  return (
    <svg className={`lfs-glyph ${piece}`} viewBox="8 8 84 84" style={playerStyle(color)} role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      {(piece === "x" ? crossPaths(seed) : [circlePath(seed)]).map((d, i) => (
        <path key={i} d={d} />
      ))}
    </svg>
  );
}

// --- the players --------------------------------------------------------------

function SidePlate(props: { where: "top" | "bottom"; piece: Piece; color: number; view: LuffaView; playerId: string | null; me: string; name(id: string): string; online(id: string): boolean }) {
  const { view, piece: p, playerId } = props;
  const seat = view.seats.find((s) => s?.playerId === playerId) ?? null;
  const won = view.phase === "over" && view.result?.winner === p;
  const toMove = view.phase === "playing" && view.turn === p;
  const what = p === "x" ? "Crosses" : "Circles";
  const order = view.phase === "over" ? (p === "x" ? "started" : "") : p === "x" ? "starts" : "";
  return (
    <div className={`lfs-side ${props.where}`} data-testid={`lfs-side-${p}`}>
      {playerId ? (
        <PlayerPlate playerId={playerId} name={props.name(playerId)} you={playerId === props.me} online={props.online(playerId)} active={toMove} winner={won} dim={!seat}>
          <div className="plate-line lfs-plate-line">
            <span className="lfs-plate-piece">
              <Glyph piece={p} color={props.color} seed={p === "x" ? 11 : 5} />
              {what}
              {order && <span className="lfs-plate-order">, {order}</span>}
            </span>
            <span className="lfs-wins">{seat ? `${seat.wins} ${seat.wins === 1 ? "win" : "wins"}` : "left"}</span>
          </div>
        </PlayerPlate>
      ) : (
        <div className="lfs-open-seat">
          <span className="label">Open seat</span>
        </div>
      )}
    </div>
  );
}

// --- the panel ----------------------------------------------------------------

/** The last mark in words: "Bob drew a circle on H8." */
function LastMoveLine({ view, color, me, name }: { view: LuffaView; color: number; me: string; name(id: string): string }) {
  const last = view.lastMove!;
  const id = view.sides?.[last.by];
  const who = id === me ? "You" : id ? name(id) : "Someone";
  return (
    <div className="lfs-last-line" data-testid="lfs-last">
      <Glyph piece={last.by} color={color} /> {who} drew a {NAMES[last.by]} on {last.square}.<span className="lfs-count muted"> Mark {view.moves.length}.</span>
    </div>
  );
}

function Status({ view, me, name, myTurn }: { view: LuffaView; me: string; name(id: string): string; myTurn: boolean }) {
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
  } else text = view.game === 0 ? "Get five in a row: across, up and down, or diagonally." : "The game was called off. Waiting for two players.";
  return (
    <div className={`lfs-status ${tone}`} aria-live="polite" data-testid="lfs-status">
      {text}
    </div>
  );
}

function Controls(props: { view: LuffaView; busy: boolean; connected: boolean; send(op: LuffaOp): Promise<boolean> }) {
  const { view, send } = props;
  const [confirm, setConfirm] = useState(false);
  const disabled = props.busy || !props.connected;
  const playing = view.phase === "playing" && view.you.piece !== null;
  useEffect(() => setConfirm(false), [view.phase, view.game]);

  if (playing && confirm) {
    return (
      <div className="lfs-controls">
        <span>Resign this game?</span>
        <span className="row">
          <button className="btn danger small" disabled={disabled} onClick={() => send({ type: "resign" })} data-testid="lfs-resign-yes">
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
      <div className="lfs-controls">
        <button className="btn small" disabled={disabled} onClick={() => setConfirm(true)} data-testid="lfs-resign">
          ⚑ Resign
        </button>
        <span className="muted lfs-keys">Arrow keys and Enter to play</span>
      </div>
    );
  }
  const openSeat = ([0, 1] as Side[]).find((s) => !view.seats[s]);
  if (view.phase !== "over") return null;
  if (view.you.seat !== null && !view.canRematch) {
    return (
      <div className="lfs-controls">
        <span className="muted">Waiting for an opponent to sit down.</span>
      </div>
    );
  }
  if (view.you.seat === null && openSeat !== undefined) {
    return (
      <div className="lfs-controls">
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
function LuffaResult(props: { view: LuffaView; open: boolean; me: string; name(id: string): string; rematch: (() => void) | null; disabled: boolean }) {
  const { view, me, name } = props;
  const r = view.result;
  const sides = view.sides;
  let title = "";
  let subtitle = "";
  if (r && sides) {
    if (r.winner) {
      title = sides[r.winner] === me ? "You win!" : `${name(sides[r.winner])} wins!`;
      subtitle = r.reason === "five" ? `${r.squares.length > 5 ? `${r.squares.length} in a row` : "Five in a row"} (${r.squares[0]}–${r.squares.at(-1)}), with mark ${view.moves.length}.` : `Won ${HOW[r.reason as keyof typeof HOW]}, after ${view.moves.length} marks.`;
    } else {
      title = "A draw";
      subtitle = "The sheet is full and nobody got five in a row.";
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
      testId="lfs-result"
      title={title}
      subtitle={subtitle}
      columns={["Played", "Marks", "Wins here"]}
      rows={order.flatMap((p) => {
        const id = sides?.[p];
        if (!id || !r) return [];
        const seat = view.seats.find((s) => s?.playerId === id);
        return [{ playerId: id, name: name(id), winner: r.winner === p, left: !seat, cells: [p === "x" ? "Crosses" : "Circles", view.moves.filter((m) => m.by === p).length, seat?.wins ?? "–"] }];
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
