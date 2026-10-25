import { useMemo, useState } from "react";
import { ByoYomiClock, formatClock } from "../../kit/ui/Clock";
import { DuelControls, DuelFooter, DuelMoves, DuelResult, DuelSide, DuelStatus, DuelTable, playerOf, SeatPrompt, winsText } from "../../kit/ui/Duel";
import type { GameUIProps } from "../../ui";
import { useSend } from "../../kit/ui/useSend";
import { type GoView, type LastMove, resultText, SPEC } from "../engine";
import type { GoOp } from "../index";
import { type Color, other, parsePoint, pointName, tryPlay } from "../rules";
import { Board, type Counting } from "./Board";
import "./go.css";

type Props = GameUIProps<GoView, GoOp>;
const COLOR_NAME = { b: "Black", w: "White" } as const;

export function GoGame({ view, me, members, connected, sendOp, serverNow }: Props) {
  const name = (id: string) => members.get(id)?.name ?? "Player";
  const online = (id: string) => members.get(id)?.online !== false;
  const { busy, send } = useSend(sendOp);

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

  const playing = view.phase === "playing";
  const myTurn = playing && myColor === view.turn;
  const bottom: Color = myColor ?? "b";
  const counting: Counting | null = useMemo(
    () => (view.scoring ? { dead: new Set(view.scoring.dead.map((n) => parsePoint(n, view.size)!)), owner: view.scoring.owner } : null),
    [view.scoring, view.size],
  );

  const side = (c: Color, where: "top" | "bottom") => {
    const points = view.scoring?.score[c];
    return (
      <DuelSide
        key={c}
        view={view}
        colors={SPEC.colors}
        color={c}
        where={where}
        me={me}
        name={name}
        online={online}
        label={COLOR_NAME[c]}
        testId={`go-side-${c}`}
        clock={view.clock && <ByoYomiClock clock={view.clock} side={c} serverNow={serverNow} testId={`go-clock-${c}`} />}
      >
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
        <span className="duel-wins">
          {view.phase === "scoring" && view.scoring?.accepted[c] ? "✓ accepted · " : ""}
          {COLOR_NAME[c]} · {winsText(view.seats.find((s) => s?.playerId === playerOf(view, SPEC.colors, c)))}
        </span>
      </DuelSide>
    );
  };

  return (
    <DuelTable
      className="go"
      testId="go"
      max={900}
      top={side(other(bottom), "top")}
      bottom={side(bottom, "bottom")}
      board={
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
            <SeatPrompt view={view} game="Go" blurb="Sit down and someone else takes the other side. Colors swap every game." name={name} disabled={!connected || busy} send={send} testId="go-sit" />
          </Board>
        </div>
      }
      panel={
        <>
          <div className="go-info">
            <span>
              {view.size}×{view.size}
            </span>
            <span>Komi {view.komi}</span>
            <span>{view.phase === "waiting" ? "" : `Move ${view.moves.length}`}</span>
          </div>
          {view.scoring && <ScoreBar b={view.scoring.score.b} w={view.scoring.score.w} komi={view.komi} />}
          <DuelMoves count={view.moves.length} label="Moves" testId="go-moves">
            {view.moves.map((m, i) => (
              <li key={i} className={`${m.point ? "" : "pass"} ${i === view.moves.length - 1 ? "last" : ""}`}>
                <span className="duel-move-num">{i + 1}</span>
                <i className={`go-mini ${m.by}`} aria-label={COLOR_NAME[m.by]} />
                {m.point ?? "pass"}
              </li>
            ))}
          </DuelMoves>
          {view.phase !== "waiting" && <LastMoveLine view={view} last={shown.lastMove} me={me} name={name} />}
          <DuelStatus
            view={view}
            me={me}
            name={name}
            myTurn={myTurn}
            result={(who) => resultText(view.result!, who)}
            intro="Black moves first. Colors swap every game."
            label={(c) => COLOR_NAME[c]}
            {...(view.phase === "scoring"
              ? {
                  text: myColor ? "Counting: check the dead stones, then accept." : "Counting…",
                  tone: myColor && !view.scoring?.accepted[myColor] ? "turn" : "",
                }
              : {})}
            testId="go-status"
          />
          {view.phase === "scoring" && myColor && view.scoring ? (
            <CountingControls view={view} name={name} busy={busy} connected={connected} send={send} serverNow={serverNow} />
          ) : (
            <DuelControls view={view} busy={busy} connected={connected} send={send} testId="go">
              {myColor && (
                <button className="btn small" disabled={busy || !connected || !myTurn} onClick={() => send({ type: "pass" })} data-testid="go-pass">
                  {myTurn && view.passed === other(myColor) ? "Pass & count" : "Pass"}
                </button>
              )}
            </DuelControls>
          )}
        </>
      }
    >
      <GoResult view={view} me={me} name={name} busy={busy} connected={connected} send={send} />
      <DuelFooter view={view} moved={view.moves.some((m) => m.by === myColor)} busy={busy} connected={connected} send={send} />
    </DuelTable>
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
    <div className="duel-last" data-testid="go-last">
      {last || view.passed ? <i className={`go-mini ${view.passed ?? last!.by}`} aria-hidden /> : null} {text} {tag && <span className="go-tag">{tag}</span>}
    </div>
  );
}

/** While counting: mark dead stones, accept the score, or go back to playing. */
function CountingControls(props: { view: GoView; name(id: string): string; busy: boolean; connected: boolean; send(op: GoOp): unknown; serverNow: number }) {
  const { view, send } = props;
  const c = view.you.color!;
  const disabled = props.busy || !props.connected;
  const accepted = view.scoring!.accepted;
  const them = view.sides?.[other(c)];
  const left = Math.max(0, view.scoring!.deadline - props.serverNow);
  return (
    <div className="duel-controls go-counting">
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

const HOW = { resign: "by resignation", timeout: "on time", left: "(the other player left)" } as const;

/** The end of a game: who won and by how much, and the score between the two in this room. */
function GoResult(props: { view: GoView; me: string; name(id: string): string; busy: boolean; connected: boolean; send(op: GoOp): unknown }) {
  const r = props.view.result;
  let subtitle = "";
  if (r?.reason === "score" && r.score) {
    const margin = Math.abs(r.score.b - r.score.w);
    subtitle = `${COLOR_NAME[r.winner]} wins by ${margin} ${margin === 1 ? "point" : "points"}: ${r.score.b} to ${r.score.w} with komi.`;
  } else if (r) subtitle = `${COLOR_NAME[r.winner]} wins ${HOW[r.reason as keyof typeof HOW]}.`;
  return (
    <DuelResult
      {...props}
      colors={SPEC.colors}
      subtitle={subtitle}
      columns={["Played", "Wins here", "Points"]}
      cells={(c, seat) => [COLOR_NAME[c], seat?.wins ?? "–", r?.score?.[c] ?? "–"]}
      again="swap colors"
      testId="go-result"
    />
  );
}
