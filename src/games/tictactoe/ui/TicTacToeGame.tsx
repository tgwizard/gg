import { TurnTimer } from "../../kit/ui/TurnTimer";
import type { GameUIProps } from "../../ui";
import type { Mark, TttOp, TttView } from "../index";
import "./tictactoe.css";

const MARKS = ["X", "O"] as const;

export function TicTacToeGame({ view, members, connected, sendOp, serverNow }: GameUIProps<TttView, TttOp>) {
  const nameOf = (id: string) => members.get(id)?.name ?? "Player";
  const mySeat = view.you.seat;
  const myTurn = view.status === "playing" && view.turn === mySeat;
  const winLine = new Set(view.result?.line ?? []);
  const nextIn = view.nextRoundAt ? Math.max(0, Math.ceil((view.nextRoundAt - serverNow) / 1000)) : null;

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
    status = "Waiting for two players.";
  }

  return (
    <div className="ttt">
      <div className="ttt-players">
        {([0, 1] as Mark[]).map((m) => {
          const seat = view.seats[m];
          return (
            <div key={m} className={`ttt-player ${view.status === "playing" && view.turn === m ? "turn" : ""}`} data-testid={`ttt-seat-${m}`}>
              <span className="ttt-mark">{MARKS[m]}</span>
              {seat ? (
                <>
                  <span className="ttt-name">
                    {nameOf(seat.playerId)}
                    {m === mySeat && <span className="tag">you</span>}
                  </span>
                  <span className="ttt-wins">{seat.wins} wins</span>
                  {view.status === "playing" && view.turn === m && (
                    <TurnTimer deadline={view.turnDeadline} totalMs={view.config.turnSeconds * 1000} serverNow={serverNow} />
                  )}
                </>
              ) : mySeat === null ? (
                <button className="btn small" disabled={!connected} onClick={() => sendOp({ type: "sit", seat: m })}>
                  Play as {MARKS[m]}
                </button>
              ) : (
                <span className="muted">Waiting…</span>
              )}
            </div>
          );
        })}
      </div>

      <p className="ttt-status" data-testid="ttt-status">
        {status}
      </p>

      <div className="ttt-board" role="grid" aria-label="Board">
        {view.board.map((cell, i) => (
          <button
            key={i}
            className={`ttt-cell ${cell !== null ? `mark-${cell}` : ""} ${winLine.has(i) ? "win" : ""}`}
            disabled={!myTurn || cell !== null || !connected}
            onClick={() => sendOp({ type: "place", cell: i })}
            aria-label={cell === null ? `Empty square ${i + 1}` : `${MARKS[cell]} in square ${i + 1}`}
            data-testid={`ttt-cell-${i}`}
          >
            {cell === null ? "" : MARKS[cell]}
          </button>
        ))}
      </div>

      <div className="ttt-footer">
        <span className="muted small">
          Round {view.round} · {view.draws} draws
        </span>
        {mySeat !== null && (
          <button className="btn ghost small" disabled={!connected} onClick={() => sendOp({ type: "leave" })}>
            {view.status === "playing" ? "Forfeit & leave" : "Leave seat"}
          </button>
        )}
      </div>
    </div>
  );
}
