import { useEffect, useMemo, useState } from "react";
import { DuelControls, DuelFooter, DuelResult, DuelSide, DuelStatus, DuelTable, nextStarter, playerOf, SeatPrompt, useResultDelay, winsText } from "../../kit/ui/Duel";
import { TurnTimer } from "../../kit/ui/TurnTimer";
import { usePending, useSend } from "../../kit/ui/useSend";
import { playerStyle, useMedia, usePlayerColors } from "../../../ui";
import type { GameUIProps } from "../../ui";
import { type LuffaView, resultText, SPEC } from "../engine";
import type { LuffaOp } from "../index";
import { other, parseSquare, type Piece, place, squareName, winningRuns } from "../rules";
import { circlePath, crossPaths } from "./ink";
import { inkColors } from "./inkColors";
import { Sheet, sheetRatio } from "./Sheet";
import "./luffarschack.css";

type Props = GameUIProps<LuffaView, LuffaOp>;

/** How long the ringed five shows before the results come up over it, for a game that ends while you watch (the loop is done at 1.3 s). */
const RESULT_DELAY_MS = 2000;

const NAMES = { x: "cross", o: "circle" } as const;

export function LuffaGame({ view, snapshot, me, members, connected, sendOp, serverNow }: Props) {
  const name = (id: string) => members.get(id)?.name ?? "Player";
  const online = (id: string) => members.get(id)?.online !== false;
  const { busy, send } = useSend(sendOp);
  const touch = useMedia("(pointer: coarse)");

  const myPiece = view.you.color;
  const n = view.size;
  // Your mark shows at once; it's taken back if the server says no.
  const { pending, play } = usePending<number>(snapshot, me);
  const shown = useMemo(() => {
    const fromView = { board: view.board, order: view.moves.map((m) => parseSquare(m.square, n)!), last: view.lastMove?.cell ?? null, runs: view.result?.runs ?? [], winner: view.result?.winner ?? null };
    if (pending === null || !myPiece || view.board[pending] !== ".") return fromView;
    const board = place(view.board, pending, myPiece);
    const runs = winningRuns(board, n, pending);
    return { board, order: [...fromView.order, pending], last: pending, runs, winner: runs.length ? myPiece : null };
  }, [pending, view.board, view.moves, view.lastMove, view.result, myPiece, n]);
  const mark = async (square: string) => {
    const cell = parseSquare(square, n);
    if (cell === null) return;
    await play(cell, () => sendOp({ type: "mark", square }));
  };

  const playing = view.phase === "playing";
  const myTurn = playing && myPiece === view.turn;
  const movable = myTurn && connected && shown.board === view.board ? myPiece : null;
  // On touch, the square tapped once (pencilled in), until it's inked or the sheet changes.
  const [picked, setPicked] = useState<number | null>(null);
  useEffect(() => setPicked(null), [shown.board, movable]);
  const pencilled = picked !== null && movable && shown.board[picked] === "." ? squareName(n, picked) : null;
  const bottom: Piece = myPiece ?? "x";
  const colorOf = usePlayerColors();
  const colorFor = (p: Piece) => {
    const id = playerOf(view, SPEC.colors, p);
    // An open seat gets a stand-in color, far from the other side's.
    return id ? colorOf(id) : p === "x" ? 5 : 0;
  };
  const colors = inkColors({ x: colorFor("x"), o: colorFor("o") }, myPiece ?? "x");
  // The results wait a moment after a game ends on the paper while you watch, so the ringed five is seen first.
  const showResult = useResultDelay(view, (reason) => reason === "five" || reason === "full", RESULT_DELAY_MS);

  const side = (p: Piece, where: "top" | "bottom") => {
    const order = view.phase === "over" ? (p === "x" ? "started" : "") : p === "x" ? "starts" : "";
    return (
      <DuelSide key={p} view={view} colors={SPEC.colors} color={p} where={where} me={me} name={name} online={online} testId={`lfs-side-${p}`}>
        <span className="lfs-plate-piece">
          <Glyph piece={p} color={colors[p]} seed={p === "x" ? 11 : 5} />
          {p === "x" ? "Crosses" : "Circles"}
          {order && <span className="lfs-plate-order">, {order}</span>}
        </span>
        <span className="duel-wins">{winsText(view.seats.find((s) => s?.playerId === playerOf(view, SPEC.colors, p)))}</span>
      </DuelSide>
    );
  };

  return (
    <DuelTable
      className="lfs"
      testId="lfs"
      ratio={sheetRatio(n)}
      max={1000}
      top={side(other(bottom), "top")}
      bottom={side(bottom, "bottom")}
      board={
        <Sheet
          n={n}
          board={shown.board}
          game={view.game}
          order={shown.order}
          last={view.phase === "waiting" ? null : shown.last}
          runs={shown.runs}
          winner={shown.winner}
          colors={colors}
          movable={movable}
          onMark={mark}
          picked={picked}
          onPick={setPicked}
        >
          <SeatPrompt
            view={view}
            game="Luffarschack"
            blurb="Sit down and someone else takes the other side. Your marks are inked in your color."
            name={name}
            disabled={!connected || busy}
            send={send}
            testId="lfs-sit"
          />
        </Sheet>
      }
      panel={
        <>
          {view.lastMove && view.phase !== "waiting" && <LastMoveLine view={view} color={colors[view.lastMove.by]} me={me} name={name} />}
          <DuelStatus
            view={view}
            me={me}
            name={name}
            myTurn={myTurn}
            result={(who) => resultText(view.result!, who)}
            intro="Get five in a row: across, up and down, or diagonally."
            yourMove={pencilled ? `${pencilled} is pencilled in: tap it again to ink it.` : touch ? "Your move: tap a square, then tap it again to ink it." : "Your move."}
            testId="lfs-status"
          />
          {pencilled && (
            <div className="lfs-pencilled" data-testid="lfs-confirm">
              <button type="button" className="btn primary small" onClick={() => void mark(pencilled)}>
                Mark {pencilled}
              </button>
              <button type="button" className="btn small" onClick={() => setPicked(null)}>
                Pick another
              </button>
            </div>
          )}
          {playing && view.config.turnSeconds > 0 && (
            <div className="lfs-timer">
              <TurnTimer deadline={view.turnDeadline} totalMs={view.config.turnSeconds * 1000} serverNow={serverNow} />
            </div>
          )}
          <DuelControls view={view} busy={busy} connected={connected} send={send} testId="lfs" aside={playing && view.you.color && <span className="muted duel-keys">Arrow keys and Enter to play</span>} />
        </>
      }
    >
      <LuffaResult view={view} open={showResult} me={me} name={name} busy={busy} connected={connected} send={send} />
      <DuelFooter view={view} moved={view.moves.some((m) => m.by === myPiece)} busy={busy} connected={connected} send={send} />
    </DuelTable>
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

// --- the panel ----------------------------------------------------------------

/** The last mark in words: "Bob drew a circle on H8." */
function LastMoveLine({ view, color, me, name }: { view: LuffaView; color: number; me: string; name(id: string): string }) {
  const last = view.lastMove!;
  const id = view.sides?.[last.by];
  const who = id === me ? "You" : id ? name(id) : "Someone";
  return (
    <div className="duel-last" data-testid="lfs-last">
      <Glyph piece={last.by} color={color} /> {who} drew a {NAMES[last.by]} on {last.square}.<span className="lfs-count muted"> Mark {view.moves.length}.</span>
    </div>
  );
}

const HOW = { resign: "by resignation", timeout: "on time", left: "(the other player left)" } as const;

/** The end of a game: who won and how, and the score between the two in this room. */
function LuffaResult(props: { view: LuffaView; open: boolean; me: string; name(id: string): string; busy: boolean; connected: boolean; send(op: LuffaOp): unknown }) {
  const { view } = props;
  const r = view.result;
  const marks = view.moves.length;
  const subtitle = !r
    ? ""
    : r.winner === null
      ? "The sheet is full and nobody got five in a row."
      : r.reason === "five"
        ? `${r.squares.length > 5 ? `${r.squares.length} in a row` : "Five in a row"} (${r.squares[0]}–${r.squares.at(-1)}), with mark ${marks}.`
        : `Won ${HOW[r.reason as keyof typeof HOW]}, after ${marks} marks.`;
  return (
    <DuelResult
      {...props}
      colors={SPEC.colors}
      subtitle={subtitle}
      columns={["Played", "Marks", "Wins here"]}
      cells={(p, seat) => [p === "x" ? "Crosses" : "Circles", view.moves.filter((m) => m.by === p).length, seat?.wins ?? "–"]}
      again={nextStarter(view, props.me, props.name)}
      testId="lfs-result"
    />
  );
}
