import { playerStyle, usePlayerColors } from "../../../ui";
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
            className={`ttt-cell ${cell !== null ? `mark-${cell}` : ""} ${winLine.has(i) ? "win" : ""}`}
            style={cell !== null ? markStyle(cell) : undefined}
            disabled={!myTurn || cell !== null || !connected}
            onClick={() => sendOp({ type: "place", cell: i })}
            aria-label={cell === null ? `Empty square ${i + 1}` : `${MARKS[cell]} in square ${i + 1}`}
            data-testid={`ttt-cell-${i}`}
          >
            {cell === null ? "" : MARKS[cell]}
          </button>
        ))}
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
          <p className="muted">Share the room link (Copy invite link, at the top) so someone can play {MARKS[open[0]!]}.</p>
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
