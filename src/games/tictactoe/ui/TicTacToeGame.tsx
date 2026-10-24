import { type CSSProperties, useLayoutEffect, useRef, useState } from "react";
import { play, playerStyle, usePlayerColors } from "../../../ui";
import { useOnChange } from "../../kit/ui/Flights";
import { Herald } from "../../kit/ui/GameParts";
import { PlayerPlate } from "../../kit/ui/PlayerPlate";
import { TurnTimer } from "../../kit/ui/TurnTimer";
import type { GameUIProps } from "../../ui";
import type { Mark, TttOp, TttView } from "../index";
import "./tictactoe.css";

const MARKS = ["X", "O"] as const;

export function TicTacToeGame({ view, me, members, connected, sendOp, serverNow }: GameUIProps<TttView, TttOp>) {
  const nameOf = (id: string) => members.get(id)?.name ?? "Player";
  const mySeat = view.you.seat;
  const colorOf = usePlayerColors();
  // Marks are drawn in their player's color (or a default once they've left).
  const markStyle = (m: Mark) => {
    const seat = view.seats[m];
    return seat ? playerStyle(colorOf(seat.playerId)) : undefined;
  };
  const myTurn = view.status === "playing" && view.turn === mySeat;
  const winLine = new Set(view.result?.line ?? []);
  const fresh = useFreshMove(view.board, connected);
  // The end of a round: a fanfare for the winner, a sigh for the other, a chime for a draw or anyone watching.
  useOnChange(view.status === "over" && view.result ? view.round : null, () => {
    const w = view.result!.winner;
    play(mySeat === null || w === null ? "good" : w === mySeat ? "win" : "lose", 0.35);
  });
  const nextIn = view.nextRoundAt ? Math.max(0, Math.ceil((view.nextRoundAt - serverNow) / 1000)) : null;
  const open = ([0, 1] as Mark[]).filter((m) => !view.seats[m]);
  const opponentOf = (m: Mark) => view.seats[(1 - m) as Mark];
  // Between rounds with a seat open, the board waits for players: grey it out and say what to do.
  const prompt: "pick" | "wait" | null = open.length === 0 || view.status === "playing" ? null : mySeat === null ? "pick" : "wait";

  let status: string;
  if (view.status === "playing") {
    const turnName = nameOf(view.seats[view.turn]!.playerId);
    status = myTurn ? `Your move (${MARKS[view.turn]})` : `${turnName} is thinking…`;
  } else if (view.status === "over" && view.result) {
    const w = view.result.winner;
    status = w === null ? "A draw." : `${nameOf(view.seats[w]?.playerId ?? "")} wins${view.result.forfeit ? " by forfeit" : ""}!`;
    if (nextIn !== null) status += ` Next round in ${nextIn}s.`;
    else if (!view.seats.every(Boolean)) status += " Waiting for an opponent.";
  } else {
    status = mySeat === null ? "Pick X or O to play." : `Waiting for someone to play as ${MARKS[open[0] ?? 0]}.`;
  }
  if (mySeat === null && open.length === 0) status = `You're watching. ${status}`;

  return (
    <div className="ttt">
      <div className="ttt-players">
        {([0, 1] as Mark[]).map((m) => {
          const seat = view.seats[m];
          const turn = view.status === "playing" && view.turn === m;
          return (
            <div key={m} className="ttt-player" data-testid={`ttt-seat-${m}`}>
              <span className={`ttt-mark display mark-${m}`} style={markStyle(m)} aria-hidden>
                {MARKS[m]}
              </span>
              {seat ? (
                <PlayerPlate
                  playerId={seat.playerId}
                  name={nameOf(seat.playerId)}
                  you={m === mySeat}
                  online={members.get(seat.playerId)?.online !== false}
                  active={turn}
                  winner={view.status === "over" && view.result?.winner === m}
                >
                  <div className="plate-line status">
                    {seat.wins} {seat.wins === 1 ? "win" : "wins"}
                  </div>
                  {turn && <TurnTimer deadline={view.turnDeadline} totalMs={view.config.turnSeconds * 1000} serverNow={serverNow} />}
                </PlayerPlate>
              ) : (
                <div className="ttt-open-seat">
                  <span className="label">Open seat</span>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* The prompt over the board says it better while it's up. */}
      {!prompt && <Herald testId="ttt-status">{status}</Herald>}

      <div className="ttt-board-wrap">
      <div className={`ttt-board box ${prompt ? "idle" : ""}`} role="grid" aria-label="Board">
        {view.board.map((cell, i) => (
          <button
            key={i}
            className={`ttt-cell ${cell !== null ? `mark-${cell}` : ""} ${winLine.has(i) ? "win" : ""} ${i === fresh ? "fresh" : ""}`}
            style={cell !== null ? markStyle(cell) : undefined}
            disabled={!myTurn || cell !== null || !connected}
            onClick={() => sendOp({ type: "place", cell: i })}
            aria-label={cell === null ? `Empty square ${i + 1}` : `${MARKS[cell]} in square ${i + 1}`}
            data-testid={`ttt-cell-${i}`}
          >
            {cell === null ? "" : <span className="ttt-glyph">{MARKS[cell]}</span>}
          </button>
        ))}
        {view.result?.line && view.result.winner !== null && (
          <WinLine line={view.result.line} live={fresh !== null && winLine.has(fresh)} className={`mark-${view.result.winner}`} style={markStyle(view.result.winner)} />
        )}
      </div>
      {prompt === "pick" && (
        <div className="ttt-prompt box" role="dialog" aria-label="Pick a side">
          <h3 className="display">{open.length === 2 ? "Pick a side" : `Take on ${nameOf(opponentOf(open[0]!)!.playerId)}`}</h3>
          <p className="muted">{open.length === 2 ? "X moves first. Someone else takes the other side." : "The round starts as soon as you sit down."}</p>
          <div className="ttt-prompt-actions">
            {open.map((m) => (
              <button key={m} className="btn primary big ttt-pick" style={playerStyle(colorOf(me))} disabled={!connected} onClick={() => sendOp({ type: "sit", seat: m })}>
                <span className="ttt-pick-mark display">{MARKS[m]}</span>
                Play as {MARKS[m]}
              </button>
            ))}
          </div>
        </div>
      )}
      {prompt === "wait" && (
        <div className="ttt-prompt box" role="status">
          <h3 className="display">Waiting for an opponent</h3>
          <p className="muted">Share the room link (the people icon by the room name, at the top) so someone can play {MARKS[open[0]!]}.</p>
        </div>
      )}
      </div>

      <div className="ttt-footer">
        {view.round > 0 && (
          <span className="label">
            Round {view.round} · {view.draws} {view.draws === 1 ? "draw" : "draws"}
          </span>
        )}
        {mySeat !== null && (
          <button className="btn ghost small" disabled={!connected} onClick={() => sendOp({ type: "leave" })}>
            {view.status === "playing" ? "Forfeit & leave" : "Leave seat"}
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * The square just played, so its mark can pop in. Only a move that arrived live: nothing
 * replays on first render, a refresh or a reconnect catching up.
 */
function useFreshMove(board: (Mark | null)[], connected: boolean): number | null {
  const key = board.map((c) => c ?? "-").join("");
  const [fresh, setFresh] = useState<number | null>(null);
  const seen = useRef({ key, connected });
  useLayoutEffect(() => {
    const before = seen.current;
    seen.current = { key, connected };
    if (key === before.key) return;
    const changed = [...key].flatMap((c, i) => (c === before.key[i] ? [] : [i]));
    const one = changed.length === 1 && before.key[changed[0]!] === "-";
    const live = one && before.connected && connected;
    setFresh(live ? changed[0]! : null);
    if (live) play("place");
  }, [key, connected]);
  return fresh;
}

/** A stroke through the winning three, drawn across them when the win comes in live. */
function WinLine({ line, live, className, style }: { line: number[]; live: boolean; className: string; style?: CSSProperties }) {
  const at = (i: number) => [(i % 3) + 0.5, Math.floor(i / 3) + 0.5] as const;
  const [[x1, y1], [x2, y2]] = [at(line[0]!), at(line[line.length - 1]!)];
  // Run a little past the centers of the end squares.
  const [dx, dy] = [Math.sign(x2 - x1) * 0.3, Math.sign(y2 - y1) * 0.3];
  return (
    <svg className={`ttt-line ${live ? "live" : ""} ${className}`} style={style} viewBox="0 0 3 3" aria-hidden>
      {["edge", "ink"].map((k) => (
        <line key={k} className={k} x1={x1 - dx} y1={y1 - dy} x2={x2 + dx} y2={y2 + dy} pathLength={1} />
      ))}
    </svg>
  );
}
