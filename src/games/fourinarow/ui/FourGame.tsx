import { useMemo } from "react";
import { Clock } from "../../kit/ui/Clock";
import { DuelControls, DuelFooter, DuelMoves, DuelResult, DuelSide, DuelStatus, DuelTable, nextStarter, playerOf, SeatPrompt, useResultDelay, winsText } from "../../kit/ui/Duel";
import { usePending, useSend } from "../../kit/ui/useSend";
import { playerStyle, usePlayerColors } from "../../../ui";
import type { GameUIProps } from "../../ui";
import { type FourView, resultText, SPEC } from "../engine";
import type { FourOp } from "../index";
import { drop, fourThrough, landing, other, type Piece } from "../rules";
import { Board } from "./Board";
import { discColors } from "./colors";
import "./fourinarow.css";

type Props = GameUIProps<FourView, FourOp>;

/** How long the winning line shows before the results come up over it, for a game that ends while you watch. */
const RESULT_DELAY_MS = 1600;

export function FourGame({ view, snapshot, me, members, connected, sendOp, serverNow }: Props) {
  const name = (id: string) => members.get(id)?.name ?? "Player";
  const online = (id: string) => members.get(id)?.online !== false;
  const { busy, send } = useSend(sendOp);

  const myPiece = view.you.color;
  const size = view.size;
  // Your move shows at once; it's taken back if the server says no.
  const { pending, play } = usePending<number>(snapshot, me);
  const shown = useMemo((): { board: string; last: number | null; line: number[] } => {
    const line = view.result?.cells ?? [];
    const fromView = { board: view.board, last: view.lastMove?.cell ?? null, line };
    if (pending === null || !myPiece || landing(view.board, size, pending - 1) === null) return fromView;
    const after = drop(view.board, size, myPiece, pending - 1);
    return { board: after.board, last: after.cell, line: fourThrough(after.board, size, after.cell) };
  }, [pending, view.board, view.lastMove, view.result, myPiece, size]);
  const move = (column: number) => play(column, () => sendOp({ type: "drop", column }));

  const myTurn = view.phase === "playing" && myPiece === view.turn;
  const bottom: Piece = myPiece ?? "x";
  const colorOf = usePlayerColors();
  const colorFor = (p: Piece) => {
    const id = playerOf(view, SPEC.colors, p);
    // An open seat gets a stand-in color, far from the other side's.
    return id ? colorOf(id) : p === "x" ? 0 : 6;
  };
  const colors = discColors({ x: colorFor("x"), o: colorFor("o") }, myPiece ?? "x");
  // The results wait a moment after a game ends on the board while you watch, so the winning line is seen first.
  const showResult = useResultDelay(view, (reason) => reason === "four" || reason === "full", RESULT_DELAY_MS);

  const side = (p: Piece, where: "top" | "bottom") => {
    const order = view.phase === "over" ? (p === "x" ? "Started" : "Second") : p === "x" ? "Starts" : "Second";
    return (
      <DuelSide
        key={p}
        view={view}
        colors={SPEC.colors}
        color={p}
        where={where}
        me={me}
        name={name}
        online={online}
        testId={`fiar-side-${p}`}
        clock={view.clock && <Clock clock={view.clock} side={p} serverNow={serverNow} testId={`fiar-clock-${p}`} />}
      >
        <span className="fiar-plate-disc">
          <Mini color={colors[p]} />
          {order}
        </span>
        <span className="duel-wins">{winsText(view.seats.find((s) => s?.playerId === playerOf(view, SPEC.colors, p)))}</span>
      </DuelSide>
    );
  };

  return (
    <DuelTable
      className="fiar"
      testId="fiar"
      ratio={(size.columns + 0.6) / (size.rows + 1.74)}
      max={960}
      top={side(other(bottom), "top")}
      bottom={side(bottom, "bottom")}
      board={
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
          <SeatPrompt
            view={view}
            game="Four in a Row"
            blurb="Sit down and someone else takes the other side. Your discs are your color."
            name={name}
            disabled={!connected || busy}
            send={send}
            testId="fiar-sit"
          />
        </Board>
      }
      panel={
        <>
          <DuelMoves count={view.moves.length} label="Moves (the column of each disc)" testId="fiar-moves">
            {view.moves.map((m, i) => (
              <li key={i} className={i === view.moves.length - 1 ? "last" : ""}>
                <span className="duel-move-num">{i + 1}</span>
                <Mini color={colors[m.by]} />
                {m.column}
              </li>
            ))}
          </DuelMoves>
          {view.lastMove && view.phase !== "waiting" && <LastMoveLine view={view} color={colors[view.lastMove.by]} me={me} name={name} />}
          <DuelStatus
            view={view}
            me={me}
            name={name}
            myTurn={myTurn}
            result={(who) => resultText(view.result!, who)}
            intro="Get four in a row: across, up and down, or diagonally."
            testId="fiar-status"
          />
          <DuelControls view={view} busy={busy} connected={connected} send={send} testId="fiar" aside={view.phase === "playing" && view.you.color && <span className="muted duel-keys">← → and Enter to play</span>} />
        </>
      }
    >
      <FourResult view={view} open={showResult} me={me} name={name} busy={busy} connected={connected} send={send} />
      <DuelFooter view={view} moved={view.moves.some((m) => m.by === myPiece)} busy={busy} connected={connected} send={send} />
    </DuelTable>
  );
}

/** A disc in a palette color, for names and lists. */
function Mini({ color, label }: { color: number; label?: string }) {
  return <i className="fiar-mini" style={playerStyle(color)} aria-label={label} aria-hidden={label ? undefined : true} />;
}

// --- the panel ----------------------------------------------------------------

/** The last move in words: "Bob dropped a disc in column 4." */
function LastMoveLine({ view, color, me, name }: { view: FourView; color: number; me: string; name(id: string): string }) {
  const last = view.lastMove!;
  const id = view.sides?.[last.by];
  const who = id === me ? "You" : id ? name(id) : "Someone";
  return (
    <div className="duel-last" data-testid="fiar-last">
      <Mini color={color} /> {who} dropped a disc in column {last.column}.
    </div>
  );
}

const HOW = { resign: "by resignation", timeout: "on time", left: "(the other player left)" } as const;

/** The end of a game: who won and how, and the score between the two in this room. */
function FourResult(props: { view: FourView; open: boolean; me: string; name(id: string): string; busy: boolean; connected: boolean; send(op: FourOp): unknown }) {
  const { view } = props;
  const r = view.result;
  const discs = view.moves.length;
  const subtitle = !r
    ? ""
    : r.winner === null
      ? "The board is full and nobody got four in a row."
      : r.reason === "four"
        ? `Four in a row, with disc ${discs}.`
        : `Won ${HOW[r.reason as keyof typeof HOW]}, after ${discs} discs.`;
  return (
    <DuelResult
      {...props}
      colors={SPEC.colors}
      subtitle={subtitle}
      columns={["Played", "Discs", "Wins here"]}
      cells={(p, seat) => [p === "x" ? "First" : "Second", view.moves.filter((m) => m.by === p).length, seat?.wins ?? "–"]}
      again={nextStarter(view, props.me, props.name)}
      testId="fiar-result"
    />
  );
}
