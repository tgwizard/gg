import { useMemo, useState } from "react";
import { Clock } from "../../kit/ui/Clock";
import { DuelControls, DuelFooter, DuelMoves, DuelResult, DuelSide, DuelStatus, DuelTable, playerOf, SeatPrompt, winsText } from "../../kit/ui/Duel";
import { useSend } from "../../kit/ui/useSend";
import type { GameUIProps } from "../../ui";
import { type LastMove, type OthelloView, resultText, SPEC } from "../engine";
import type { OthelloOp } from "../index";
import { type Color, count, flipsFor, other, parseSquare, play, squareName } from "../rules";
import { Board } from "./Board";
import "./othello.css";

type Props = GameUIProps<OthelloView, OthelloOp>;
const COLOR_NAME = { b: "Black", w: "White" } as const;

export function OthelloGame({ view, me, members, connected, sendOp, serverNow }: Props) {
  const name = (id: string) => members.get(id)?.name ?? "Player";
  const online = (id: string) => members.get(id)?.online !== false;
  const { busy, send } = useSend(sendOp);

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

  const myTurn = view.phase === "playing" && myColor === view.turn;
  const bottom: Color = myColor ?? "b";
  const score = useMemo(() => count(shown.board), [shown.board]);

  const side = (c: Color, where: "top" | "bottom") => (
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
      testId={`othello-side-${c}`}
      clock={view.clock && <Clock clock={view.clock} side={c} serverNow={serverNow} testId={`othello-clock-${c}`} />}
    >
      <span className="oth-count" data-testid={`othello-count-${c}`}>
        <i className={`oth-mini ${c}`} aria-hidden />
        {view.phase === "waiting" ? "–" : score[c]}
        <span className="visually-hidden"> {score[c] === 1 ? "disc" : "discs"}</span>
      </span>
      <span className="duel-wins">
        {COLOR_NAME[c]} · {winsText(view.seats.find((s) => s?.playerId === playerOf(view, SPEC.colors, c)))}
      </span>
    </DuelSide>
  );

  return (
    <DuelTable
      className="othello"
      testId="othello"
      max={860}
      top={side(other(bottom), "top")}
      bottom={side(bottom, "bottom")}
      board={
        <div className="oth-board-wrap">
          <Board
            board={shown.board}
            game={view.game}
            lastMove={view.phase === "waiting" ? null : shown.lastMove}
            movable={myTurn && connected && shown.board === view.board ? myColor : null}
            onMove={move}
          >
            <SeatPrompt view={view} game="Othello" blurb="Sit down and someone else takes the other side. Colors swap every game." name={name} disabled={!connected || busy} send={send} testId="othello-sit" />
          </Board>
        </div>
      }
      panel={
        <>
          <ScoreBar b={score.b} w={score.w} />
          <DuelMoves count={view.moves.length} label="Moves" testId="othello-moves">
            <MoveItems moves={view.moves} />
          </DuelMoves>
          {shown.lastMove && view.phase !== "waiting" && <LastMoveLine last={shown.lastMove} passed={shown.passed} view={view} me={me} name={name} />}
          <DuelStatus
            view={view}
            me={me}
            name={name}
            myTurn={myTurn}
            result={(who) => resultText(view.result!, who)}
            intro="Black moves first. Colors swap every game."
            label={(c) => COLOR_NAME[c]}
            testId="othello-status"
          />
          <DuelControls view={view} busy={busy} connected={connected} send={send} testId="othello" />
        </>
      }
    >
      <OthelloResult view={view} me={me} name={name} busy={busy} connected={connected} send={send} />
      <DuelFooter view={view} moved={view.moves.some((m) => m.by === myColor && m.square)} busy={busy} connected={connected} send={send} />
    </DuelTable>
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

function MoveItems({ moves }: { moves: OthelloView["moves"] }) {
  let n = 0;
  return moves.map((m, i) => (
    <li key={i} className={`${m.square ? "" : "pass"} ${i === moves.length - 1 ? "last" : ""}`}>
      {m.square && <span className="duel-move-num">{++n}</span>}
      <i className={`oth-mini ${m.by}`} aria-label={COLOR_NAME[m.by]} />
      {m.square ?? "pass"}
    </li>
  ));
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
    <div className="duel-last" data-testid="othello-last">
      <i className={`oth-mini ${last.by}`} aria-hidden /> {who(last.by)} played {last.square} and turned over {n} {n === 1 ? "disc" : "discs"}.{" "}
      {pass && <span className="oth-pass-tag">{pass}</span>}
    </div>
  );
}

const HOW = { resign: "by resignation", timeout: "on time", left: "(the other player left)" } as const;

/** The end of a game: who won and by how many discs, and the score between the two in this room. */
function OthelloResult(props: { view: OthelloView; me: string; name(id: string): string; busy: boolean; connected: boolean; send(op: OthelloOp): unknown }) {
  const r = props.view.result;
  let subtitle = "";
  if (r) {
    const { b, w } = r.score;
    if (r.winner) {
      const [hi, lo] = r.winner === "b" ? [b, w] : [w, b];
      subtitle = r.reason === "board" ? `${COLOR_NAME[r.winner]} wins ${hi}–${lo}.` : `${COLOR_NAME[r.winner]} wins ${HOW[r.reason]}, with ${b}–${w} on the board.`;
    } else subtitle = `${b}–${b}: the board is split evenly.`;
  }
  return (
    <DuelResult
      {...props}
      colors={SPEC.colors}
      subtitle={subtitle}
      columns={["Played", "Wins here", "Discs"]}
      cells={(c, seat) => [COLOR_NAME[c], seat?.wins ?? "–", r?.score[c] ?? "–"]}
      again="swap colors"
      testId="othello-result"
    />
  );
}
