import { useEffect, useMemo, useRef, useState } from "react";
import { ByoYomiClock } from "../../kit/ui/Clock";
import { GameOver } from "../../kit/ui/GameOver";
import { PlayerPlate } from "../../kit/ui/PlayerPlate";
import type { GameUIProps } from "../../ui";
import { formatClock } from "../../kit/ui/Clock";
import { type GoView, type LastMove, resultText, type Side } from "../engine";
import type { GoOp } from "../index";
import { type Color, other, parsePoint, pointName, tryPlay } from "../rules";
import { Board, type Counting } from "./Board";
import "./go.css";

type Props = GameUIProps<GoView, GoOp>;
const COLOR_NAME = { b: "Black", w: "White" } as const;

export function GoGame({ view, me, members, connected, sendOp, serverNow }: Props) {
  const name = (id: string) => members.get(id)?.name ?? "Player";
  const [busy, setBusy] = useState(false);
  const send = async (op: GoOp) => {
    setBusy(true);
    const ok = await sendOp(op);
    setBusy(false);
    return ok;
  };

  const myColor = view.you.color;
  const played = view.moves.filter((m) => m.point).length;
  // Your stone shows at once; it's taken back if the server says no.
  const [pending, setPending] = useState<{ base: string; point: string } | null>(null);
  const shown = useMemo((): { board: string; lastMove: LastMove | null; played: number } => {
    const p = pending && pending.base === view.board && myColor ? parsePoint(pending.point, view.size) : null;
    const after = p === null || !myColor ? null : tryPlay(view.board, myColor, p);
    if (!after || "illegal" in after) return { board: view.board, lastMove: view.lastMove, played };
    return { board: after.board, lastMove: { by: myColor!, point: pending!.point, captured: after.captured.map((q) => pointName(q, view.size)) }, played: played + 1 };
  }, [pending, view.board, view.lastMove, view.size, played, myColor]);
  const move = async (point: string) => {
    setPending({ base: view.board, point });
    if (!(await sendOp({ type: "play", point }))) setPending(null);
  };

  const mySeat = view.you.seat;
  const playing = view.phase === "playing";
  const myTurn = playing && myColor === view.turn;
  const open = ([0, 1] as Side[]).filter((s) => !view.seats[s]);
  const prompt: "pick" | "wait" | null = view.phase !== "waiting" ? null : mySeat === null ? "pick" : "wait";
  const bottom: Color = myColor ?? "b";
  const counting: Counting | null = useMemo(
    () => (view.scoring ? { dead: new Set(view.scoring.dead.map((n) => parsePoint(n, view.size)!)), owner: view.scoring.owner } : null),
    [view.scoring, view.size],
  );

  /** Who sits on a color's side: whoever's in its seat, or (after a game) whoever played it. */
  const playerOf = (c: Color): string | null => {
    const seat = c === "b" ? view.blackSeat : 1 - view.blackSeat;
    return view.seats[seat]?.playerId ?? (view.phase === "over" ? (view.sides?.[c] ?? null) : null);
  };

  const side = (c: Color, where: "top" | "bottom") => (
    <SidePlate
      key={c}
      where={where}
      color={c}
      view={view}
      playerId={playerOf(c)}
      me={me}
      name={name}
      online={(id) => members.get(id)?.online !== false}
      serverNow={serverNow}
    />
  );

  return (
    <div className="go" data-testid="go">
      <div className="go-layout">
        {side(other(bottom), "top")}
        <div className="go-board-wrap">
          <Board
            size={view.size}
            board={shown.board}
            game={view.game}
            played={shown.played}
            lastMove={view.phase === "waiting" ? null : shown.lastMove}
            movable={myTurn && connected && shown.board === view.board ? myColor : null}
            ko={myTurn ? view.ko : []}
            onPlay={move}
            counting={view.phase === "waiting" ? null : counting}
            onMark={view.phase === "scoring" && myColor && connected && !busy ? (point) => send({ type: "mark", point }) : null}
          >
            {prompt && (
              <div className="go-prompt-backdrop">
                {prompt === "pick" ? (
                  <div className="go-prompt box" role="dialog" aria-label="Take a seat">
                    <h3 className="display">{open.length === 2 ? "Play Go" : `Take on ${name(view.seats[1 - open[0]!]!.playerId)}`}</h3>
                    <p className="muted">{open.length === 2 ? "Sit down and someone else takes the other side. Colors swap every game." : "The game starts as soon as you sit down."}</p>
                    <button className="btn primary big" disabled={!connected || busy} onClick={() => send({ type: "sit", seat: open[0]! })} data-testid="go-sit">
                      Take a seat
                    </button>
                  </div>
                ) : (
                  <div className="go-prompt box" role="status">
                    <h3 className="display">Waiting for an opponent</h3>
                    <p className="muted">Share the room link (Copy invite link, at the top) so someone can take the other side.</p>
                  </div>
                )}
              </div>
            )}
          </Board>
        </div>
        {side(bottom, "bottom")}

        <div className="go-panel box">
          <div className="go-info">
            <span>
              {view.size}×{view.size}
            </span>
            <span>Komi {view.komi}</span>
            <span>{view.phase === "waiting" ? "" : `Move ${view.moves.length}`}</span>
          </div>
          {view.scoring && <ScoreBar b={view.scoring.score.b} w={view.scoring.score.w} komi={view.komi} />}
          <Moves moves={view.moves} />
          {view.phase !== "waiting" && <LastMoveLine view={view} last={shown.lastMove} me={me} name={name} />}
          <Status view={view} me={me} name={name} myTurn={myTurn} />
          <Controls view={view} me={me} name={name} busy={busy} connected={connected} send={send} serverNow={serverNow} />
        </div>
      </div>

      <GoResult view={view} me={me} name={name} rematch={view.canRematch && mySeat !== null ? () => send({ type: "rematch" }) : null} disabled={busy || !connected} />

      {mySeat !== null && (
        <div className="table-footer">
          <div className="table-footer-log" />
          <div className="table-footer-actions">
            <button className="btn ghost small" disabled={!connected || busy} onClick={() => send({ type: "leave" })}>
              {playing || view.phase === "scoring" ? (view.moves.some((m) => m.by === myColor) ? "Resign & leave" : "Leave (calls the game off)") : "Leave seat"}
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
  view: GoView;
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
  const points = view.scoring?.score[c];
  return (
    <div className={`go-side ${props.where}`} data-testid={`go-side-${c}`}>
      {playerId ? (
        <PlayerPlate playerId={playerId} name={props.name(playerId)} you={playerId === props.me} online={props.online(playerId)} active={toMove} winner={won} dim={!seat}>
          <div className="plate-line go-plate-line">
            {points !== undefined ? (
              <span className="go-count" data-testid={`go-points-${c}`}>
                <i className={`go-mini ${c}`} aria-hidden />
                {points}
                <span className="go-count-label">{points === 1 ? "point" : "points"}</span>
              </span>
            ) : (
              <span className="go-count" data-testid={`go-captures-${c}`}>
                <i className={`go-mini ${other(c)}`} aria-hidden />
                {view.phase === "waiting" ? "–" : view.captures[c]}
                <span className="go-count-label">captured</span>
              </span>
            )}
            <span className="go-wins">
              {view.phase === "scoring" && view.scoring?.accepted[c] ? "✓ accepted · " : ""}
              {COLOR_NAME[c]} · {seat ? `${seat.wins} ${seat.wins === 1 ? "win" : "wins"}` : "left"}
            </span>
          </div>
        </PlayerPlate>
      ) : (
        <div className="go-open-seat">
          <span className="label">Open seat · {COLOR_NAME[c]}</span>
        </div>
      )}
      {view.clock && <ByoYomiClock clock={view.clock} side={c} serverNow={props.serverNow} testId={`go-clock-${c}`} />}
    </div>
  );
}

// --- the panel ----------------------------------------------------------------

/** Black's points against White's (with komi), while counting. */
function ScoreBar({ b, w, komi }: { b: number; w: number; komi: number }) {
  const share = b + w ? (b / (b + w)) * 100 : 50;
  return (
    <div className="go-scorebar" role="img" aria-label={`Black ${b}, White ${w} with komi`} data-testid="go-score">
      <div className="go-scorebar-b" style={{ width: `${share}%` }}>
        <span>{b}</span>
      </div>
      <div className="go-scorebar-w">
        <span>
          {w} <small>incl. {komi} komi</small>
        </span>
      </div>
    </div>
  );
}

function Moves({ moves }: { moves: GoView["moves"] }) {
  const ref = useRef<HTMLOListElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTo({ top: el.scrollHeight, left: el.scrollWidth });
  }, [moves.length]);
  return (
    <ol className="go-moves" ref={ref} aria-label="Moves" data-testid="go-moves">
      {moves.length === 0 && <li className="go-moves-empty muted">No moves yet.</li>}
      {moves.map((m, i) => (
        <li key={i} className={`${m.point ? "" : "pass"} ${i === moves.length - 1 ? "last" : ""}`}>
          <span className="go-move-num">{i + 1}</span>
          <i className={`go-mini ${m.by}`} aria-label={COLOR_NAME[m.by]} />
          {m.point ?? "pass"}
        </li>
      ))}
    </ol>
  );
}

/** The last move in words: "Bob played D4 and captured 2 stones." / "Bob passed." */
function LastMoveLine({ view, last, me, name }: { view: GoView; last: LastMove | null; me: string; name(id: string): string }) {
  const who = (c: Color) => (view.sides?.[c] === me ? "You" : view.sides ? name(view.sides[c]) : COLOR_NAME[c]);
  let text: string;
  let tag = "";
  if (view.passed) {
    text = `${who(view.passed)} passed.`;
    if (view.phase === "playing") tag = view.sides?.[other(view.passed)] === me ? "Pass too and play stops for counting." : "Another pass ends play.";
  } else if (last) {
    const n = last.captured.length;
    text = `${who(last.by)} played ${last.point}${n ? ` and captured ${n} ${n === 1 ? "stone" : "stones"}` : ""}.`;
  } else return null;
  return (
    <div className="go-last-line" data-testid="go-last">
      {last || view.passed ? <i className={`go-mini ${view.passed ?? last!.by}`} aria-hidden /> : null} {text} {tag && <span className="go-tag">{tag}</span>}
    </div>
  );
}

function Status({ view, me, name, myTurn }: { view: GoView; me: string; name(id: string): string; myTurn: boolean }) {
  let text: string;
  let tone = "";
  if (view.phase === "over" && view.result) {
    const who = (c: Color) => (view.sides?.[c] === me ? "You" : name(view.sides?.[c] ?? ""));
    text = resultText(view.result, who).replace("You wins", "You win");
    tone = view.sides?.[view.result.winner] === me ? "won" : view.you.color ? "lost" : "";
  } else if (view.phase === "scoring") {
    text = view.you.color ? "Counting: check the dead stones, then accept." : "Counting…";
    if (view.you.color && !view.scoring?.accepted[view.you.color]) tone = "turn";
  } else if (view.phase === "playing") {
    const mover = view.sides?.[view.turn];
    text = myTurn ? "Your move." : `${COLOR_NAME[view.turn]} to move${mover ? ` (${name(mover)})` : ""}…`;
    if (myTurn) tone = "turn";
  } else text = view.game === 0 ? "Black moves first. Colors swap every game." : "The game was called off. Waiting for two players.";
  return (
    <div className={`go-status ${tone}`} aria-live="polite" data-testid="go-status">
      {text}
    </div>
  );
}

function Controls(props: { view: GoView; me: string; name(id: string): string; busy: boolean; connected: boolean; send(op: GoOp): Promise<boolean>; serverNow: number }) {
  const { view, send } = props;
  const [confirm, setConfirm] = useState(false);
  const disabled = props.busy || !props.connected;
  const c = view.you.color;
  useEffect(() => setConfirm(false), [view.phase, view.game]);

  if (c && (view.phase === "playing" || view.phase === "scoring") && confirm) {
    return (
      <div className="go-controls">
        <span>Resign this game?</span>
        <span className="row">
          <button className="btn danger small" disabled={disabled} onClick={() => send({ type: "resign" })} data-testid="go-resign-yes">
            Resign
          </button>
          <button className="btn small" onClick={() => setConfirm(false)}>
            Keep playing
          </button>
        </span>
      </div>
    );
  }
  const resign = (
    <button className="btn small ghost" disabled={disabled} onClick={() => setConfirm(true)} data-testid="go-resign">
      ⚑ Resign
    </button>
  );
  if (c && view.phase === "playing") {
    const myTurn = view.turn === c;
    return (
      <div className="go-controls">
        <button className="btn small" disabled={disabled || !myTurn} onClick={() => send({ type: "pass" })} data-testid="go-pass">
          {myTurn && view.passed === other(c) ? "Pass & count" : "Pass"}
        </button>
        {resign}
      </div>
    );
  }
  if (c && view.phase === "scoring" && view.scoring) {
    const accepted = view.scoring.accepted;
    const them = view.sides?.[other(c)];
    const left = Math.max(0, view.scoring.deadline - props.serverNow);
    return (
      <div className="go-controls go-counting">
        <p className="go-hint">
          Click a group to mark it dead (or alive again). When you both accept, the score is final; if nothing changes, it's scored as marked in{" "}
          <span className="go-tnum">{formatClock(left)}</span>.
        </p>
        <span className="row">
          {accepted[c] ? (
            <span className="muted" data-testid="go-accepted">
              ✓ Accepted. Waiting for {them ? props.name(them) : "the other player"}.
            </span>
          ) : (
            <button className="btn primary small" disabled={disabled} onClick={() => send({ type: "accept" })} data-testid="go-accept">
              Accept score
            </button>
          )}
          <button className="btn small" disabled={disabled} onClick={() => send({ type: "resume" })} data-testid="go-resume">
            Resume play
          </button>
        </span>
      </div>
    );
  }
  const openSeat = ([0, 1] as Side[]).find((s) => !view.seats[s]);
  if (view.phase !== "over") return null;
  if (view.you.seat !== null && !view.canRematch) {
    return (
      <div className="go-controls">
        <span className="muted">Waiting for an opponent to sit down.</span>
      </div>
    );
  }
  if (view.you.seat === null && openSeat !== undefined) {
    return (
      <div className="go-controls">
        <button className="btn" disabled={disabled} onClick={() => send({ type: "sit", seat: openSeat })}>
          Take the open seat
        </button>
      </div>
    );
  }
  return null;
}

const HOW = { resign: "by resignation", timeout: "on time", left: "(the other player left)" } as const;

/** The end of a game: who won and by how much, and the score between the two in this room. */
function GoResult({ view, me, name, rematch, disabled }: { view: GoView; me: string; name(id: string): string; rematch: (() => void) | null; disabled: boolean }) {
  const r = view.result;
  const sides = view.sides;
  let title = "";
  let subtitle = "";
  if (r && sides) {
    title = sides[r.winner] === me ? "You win!" : `${name(sides[r.winner])} wins!`;
    if (r.reason === "score" && r.score) {
      const margin = Math.abs(r.score.b - r.score.w);
      subtitle = `${COLOR_NAME[r.winner]} wins by ${margin} ${margin === 1 ? "point" : "points"}: ${r.score.b} to ${r.score.w} with komi.`;
    } else subtitle = `${COLOR_NAME[r.winner]} wins ${HOW[r.reason as keyof typeof HOW]}.`;
  }
  const order: Color[] = r?.winner === "w" ? ["w", "b"] : ["b", "w"];
  return (
    <GameOver
      open={view.phase === "over" && !!r && !!sides}
      gameKey={view.game}
      me={me}
      testId="go-result"
      title={title}
      subtitle={subtitle}
      columns={["Played", "Wins here", "Points"]}
      rows={order.flatMap((c) => {
        const id = sides?.[c];
        if (!id || !r) return [];
        const seat = view.seats.find((s) => s?.playerId === id);
        return [{ playerId: id, name: name(id), winner: r.winner === c, left: !seat, cells: [COLOR_NAME[c], seat?.wins ?? "–", r.score?.[c] ?? "–"] }];
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
