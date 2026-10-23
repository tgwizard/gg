import { useEffect, useMemo, useRef, useState } from "react";
import { Clock } from "../../kit/ui/Clock";
import { GameOver } from "../../kit/ui/GameOver";
import { PlayerPlate } from "../../kit/ui/PlayerPlate";
import type { GameUIProps } from "../../ui";
import { type LastMove, type OthelloView, resultText, type Side } from "../engine";
import type { OthelloOp } from "../index";
import { type Color, count, flipsFor, other, parseSquare, play, squareName } from "../rules";
import { Board } from "./Board";
import "./othello.css";

type Props = GameUIProps<OthelloView, OthelloOp>;
const COLOR_NAME = { b: "Black", w: "White" } as const;

export function OthelloGame({ view, me, members, connected, sendOp, serverNow }: Props) {
  const name = (id: string) => members.get(id)?.name ?? "Player";
  const [busy, setBusy] = useState(false);
  const send = async (op: OthelloOp) => {
    setBusy(true);
    const ok = await sendOp(op);
    setBusy(false);
    return ok;
  };

  const myColor = view.you.color;
  // Your move shows at once; it's taken back if the server says no.
  const [pending, setPending] = useState<{ base: string; square: string } | null>(null);
  const shown = useMemo((): { board: string; lastMove: LastMove | null; passed: Color | null } => {
    const sq = pending && pending.base === view.board && myColor ? parseSquare(pending.square) : null;
    if (sq === null || !myColor || !flipsFor(view.board, myColor, sq).length) return { board: view.board, lastMove: view.lastMove, passed: view.passed };
    const after = play(view.board, myColor, sq);
    return { board: after.board, lastMove: { by: myColor, square: pending!.square, flipped: after.flips.map(squareName) }, passed: null };
  }, [pending, view.board, view.lastMove, view.passed, myColor]);
  const move = async (square: string) => {
    setPending({ base: view.board, square });
    if (!(await sendOp({ type: "move", square }))) setPending(null);
  };

  const mySeat = view.you.seat;
  const playing = view.phase === "playing";
  const myTurn = playing && myColor === view.turn;
  const open = ([0, 1] as Side[]).filter((s) => !view.seats[s]);
  const prompt: "pick" | "wait" | null = view.phase !== "waiting" ? null : mySeat === null ? "pick" : "wait";
  const bottom: Color = myColor ?? "b";

  /** Who sits on a color's side: whoever's in its seat, or (after a game) whoever played it. */
  const playerOf = (c: Color): string | null => {
    const seat = c === "b" ? view.blackSeat : 1 - view.blackSeat;
    return view.seats[seat]?.playerId ?? (view.phase === "over" ? (view.sides?.[c] ?? null) : null);
  };
  const score = useMemo(() => count(shown.board), [shown.board]);

  const side = (c: Color, where: "top" | "bottom") => (
    <SidePlate
      key={c}
      where={where}
      color={c}
      view={view}
      discs={score[c]}
      playerId={playerOf(c)}
      me={me}
      name={name}
      online={(id) => members.get(id)?.online !== false}
      serverNow={serverNow}
    />
  );

  return (
    <div className="othello" data-testid="othello">
      <div className="oth-grid">
        {side(other(bottom), "top")}
        <div className="oth-board-wrap">
          <Board
            board={shown.board}
            game={view.game}
            lastMove={view.phase === "waiting" ? null : shown.lastMove}
            movable={myTurn && connected && shown.board === view.board ? myColor : null}
            onMove={move}
          >
            {prompt && (
              <div className="oth-prompt-backdrop">
                {prompt === "pick" ? (
                  <div className="oth-prompt box" role="dialog" aria-label="Take a seat">
                    <h3 className="display">{open.length === 2 ? "Play Othello" : `Take on ${name(view.seats[1 - open[0]!]!.playerId)}`}</h3>
                    <p className="muted">{open.length === 2 ? "Sit down and someone else takes the other side. Colors swap every game." : "The game starts as soon as you sit down."}</p>
                    <button className="btn primary big" disabled={!connected || busy} onClick={() => send({ type: "sit", seat: open[0]! })} data-testid="othello-sit">
                      Take a seat
                    </button>
                  </div>
                ) : (
                  <div className="oth-prompt box" role="status">
                    <h3 className="display">Waiting for an opponent</h3>
                    <p className="muted">Share the room link (Copy invite link, at the top) so someone can take the other side.</p>
                  </div>
                )}
              </div>
            )}
          </Board>
        </div>
        {side(bottom, "bottom")}

        <div className="oth-panel box">
          <ScoreBar b={score.b} w={score.w} />
          <Moves moves={view.moves} />
          {shown.lastMove && view.phase !== "waiting" && <LastMoveLine last={shown.lastMove} passed={shown.passed} view={view} me={me} name={name} />}
          <Status view={view} me={me} name={name} myTurn={myTurn} />
          <Controls view={view} busy={busy} connected={connected} send={send} />
        </div>
      </div>

      <OthelloResult view={view} me={me} name={name} rematch={view.canRematch && mySeat !== null ? () => send({ type: "rematch" }) : null} disabled={busy || !connected} />

      {mySeat !== null && (
        <div className="table-footer">
          <div className="table-footer-log" />
          <div className="table-footer-actions">
            <button className="btn ghost small" disabled={!connected || busy} onClick={() => send({ type: "leave" })}>
              {playing ? (view.moves.some((m) => m.by === myColor && m.square) ? "Resign & leave" : "Leave (calls the game off)") : "Leave seat"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// --- the players --------------------------------------------------------------

function SidePlate(props: {
  where: "top" | "bottom";
  color: Color;
  view: OthelloView;
  discs: number;
  playerId: string | null;
  me: string;
  name(id: string): string;
  online(id: string): boolean;
  serverNow: number;
}) {
  const { view, color: c, playerId } = props;
  const seat = view.seats.find((s) => s?.playerId === playerId) ?? null;
  const won = view.phase === "over" && view.result?.winner === c;
  const toMove = view.phase === "playing" && view.turn === c;
  return (
    <div className={`oth-side ${props.where}`} data-testid={`othello-side-${c}`}>
      {playerId ? (
        <PlayerPlate playerId={playerId} name={props.name(playerId)} you={playerId === props.me} online={props.online(playerId)} active={toMove} winner={won} dim={!seat}>
          <div className="plate-line oth-plate-line">
            <span className="oth-count" data-testid={`othello-count-${c}`}>
              <i className={`oth-mini ${c}`} aria-hidden />
              {view.phase === "waiting" ? "–" : props.discs}
              <span className="visually-hidden"> {props.discs === 1 ? "disc" : "discs"}</span>
            </span>
            <span className="oth-wins">
              {COLOR_NAME[c]} · {seat ? `${seat.wins} ${seat.wins === 1 ? "win" : "wins"}` : "left"}
            </span>
          </div>
        </PlayerPlate>
      ) : (
        <div className="oth-open-seat">
          <span className="label">Open seat · {COLOR_NAME[c]}</span>
        </div>
      )}
      {view.clock && <Clock clock={view.clock} side={c} serverNow={props.serverNow} testId={`othello-clock-${c}`} />}
    </div>
  );
}

// --- the panel ----------------------------------------------------------------

/** Black's share of the discs against White's. */
function ScoreBar({ b, w }: { b: number; w: number }) {
  const share = b + w ? (b / (b + w)) * 100 : 50;
  return (
    <div className="oth-scorebar" role="img" aria-label={`Black ${b}, White ${w}`} data-testid="othello-score">
      <div className="oth-scorebar-b" style={{ width: `${share}%` }}>
        <span>{b}</span>
      </div>
      <div className="oth-scorebar-w">
        <span>{w}</span>
      </div>
    </div>
  );
}

function Moves({ moves }: { moves: OthelloView["moves"] }) {
  const ref = useRef<HTMLOListElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTo({ top: el.scrollHeight, left: el.scrollWidth });
  }, [moves.length]);
  let n = 0;
  return (
    <ol className="oth-moves" ref={ref} aria-label="Moves" data-testid="othello-moves">
      {moves.length === 0 && <li className="oth-moves-empty muted">No moves yet.</li>}
      {moves.map((m, i) => (
        <li key={i} className={`${m.square ? "" : "pass"} ${i === moves.length - 1 ? "last" : ""}`}>
          {m.square && <span className="oth-move-num">{++n}</span>}
          <i className={`oth-mini ${m.by}`} aria-label={COLOR_NAME[m.by]} />
          {m.square ?? "pass"}
        </li>
      ))}
    </ol>
  );
}

/** The last move in words: "Bob played f5 and turned over 3 discs." */
function LastMoveLine({ last, passed, view, me, name }: { last: LastMove; passed: Color | null; view: OthelloView; me: string; name(id: string): string }) {
  const isMe = (c: Color) => view.sides?.[c] === me;
  const who = (c: Color) => (isMe(c) ? "You" : view.sides ? name(view.sides[c]) : COLOR_NAME[c]);
  const n = last.flipped.length;
  let pass = "";
  if (passed) {
    if (isMe(passed)) pass = `You have no move, so ${who(last.by)} goes again.`;
    else if (isMe(last.by)) pass = `${who(passed)} has no move: your turn again.`;
    else pass = `${who(passed)} has no move, so ${who(last.by)} goes again.`;
  }
  return (
    <div className="oth-last" data-testid="othello-last">
      <i className={`oth-mini ${last.by}`} aria-hidden /> {who(last.by)} played {last.square} and turned over {n} {n === 1 ? "disc" : "discs"}.{" "}
      {pass && <span className="oth-pass-tag">{pass}</span>}
    </div>
  );
}

function Status({ view, me, name, myTurn }: { view: OthelloView; me: string; name(id: string): string; myTurn: boolean }) {
  let text: string;
  let tone = "";
  if (view.phase === "over" && view.result) {
    const who = (c: Color) => (view.sides?.[c] === me ? "You" : name(view.sides?.[c] ?? ""));
    text = resultText(view.result, who).replace("You wins", "You win");
    tone = view.result.winner === null ? "draw" : view.sides?.[view.result.winner] === me ? "won" : view.you.color ? "lost" : "";
  } else if (view.phase === "playing") {
    const mover = view.sides?.[view.turn];
    text = myTurn ? "Your move." : `${COLOR_NAME[view.turn]} to move${mover ? ` (${name(mover)})` : ""}…`;
    if (myTurn) tone = "turn";
  } else text = view.game === 0 ? "Black moves first. Colors swap every game." : "The game was called off. Waiting for two players.";
  return (
    <div className={`oth-status ${tone}`} aria-live="polite" data-testid="othello-status">
      {text}
    </div>
  );
}

function Controls(props: { view: OthelloView; busy: boolean; connected: boolean; send(op: OthelloOp): Promise<boolean> }) {
  const { view, send } = props;
  const [confirm, setConfirm] = useState(false);
  const disabled = props.busy || !props.connected;
  const playing = view.phase === "playing" && view.you.color !== null;
  useEffect(() => setConfirm(false), [view.phase, view.game]);

  if (playing && confirm) {
    return (
      <div className="oth-controls">
        <span>Resign this game?</span>
        <span className="row">
          <button className="btn danger small" disabled={disabled} onClick={() => send({ type: "resign" })} data-testid="othello-resign-yes">
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
      <div className="oth-controls">
        <button className="btn small" disabled={disabled} onClick={() => setConfirm(true)} data-testid="othello-resign">
          ⚑ Resign
        </button>
      </div>
    );
  }
  const openSeat = ([0, 1] as Side[]).find((s) => !view.seats[s]);
  if (view.phase !== "over") return null;
  if (view.you.seat !== null && !view.canRematch) {
    return (
      <div className="oth-controls">
        <span className="muted">Waiting for an opponent to sit down.</span>
      </div>
    );
  }
  if (view.you.seat === null && openSeat !== undefined) {
    return (
      <div className="oth-controls">
        <button className="btn" disabled={disabled} onClick={() => send({ type: "sit", seat: openSeat })}>
          Take the open seat
        </button>
      </div>
    );
  }
  return null;
}

const HOW = { resign: "by resignation", timeout: "on time", left: "(the other player left)" } as const;

/** The end of a game: who won and by how many discs, and the score between the two in this room. */
function OthelloResult({ view, me, name, rematch, disabled }: { view: OthelloView; me: string; name(id: string): string; rematch: (() => void) | null; disabled: boolean }) {
  const r = view.result;
  const sides = view.sides;
  let title = "";
  let subtitle = "";
  if (r && sides) {
    const { b, w } = r.score;
    if (r.winner) {
      title = sides[r.winner] === me ? "You win!" : `${name(sides[r.winner])} wins!`;
      const [hi, lo] = r.winner === "b" ? [b, w] : [w, b];
      subtitle = r.reason === "board" ? `${COLOR_NAME[r.winner]} wins ${hi}–${lo}.` : `${COLOR_NAME[r.winner]} wins ${HOW[r.reason]}, with ${b}–${w} on the board.`;
    } else {
      title = "A draw";
      subtitle = `${b}–${b}: the board is split evenly.`;
    }
  }
  const order: Color[] = r?.winner === "w" ? ["w", "b"] : ["b", "w"];
  return (
    <GameOver
      open={view.phase === "over" && !!r && !!sides}
      gameKey={view.game}
      me={me}
      testId="othello-result"
      title={title}
      subtitle={subtitle}
      columns={["Played", "Wins here", "Discs"]}
      rows={order.flatMap((c) => {
        const id = sides?.[c];
        if (!id || !r) return [];
        const seat = view.seats.find((s) => s?.playerId === id);
        return [{ playerId: id, name: name(id), winner: r.winner === c, left: !seat, cells: [COLOR_NAME[c], seat?.wins ?? "–", r.score[c]] }];
      })}
      actions={
        rematch && (
          <button className="btn primary" disabled={disabled} onClick={rematch}>
            Play again (swap colors)
          </button>
        )
      }
    />
  );
}
