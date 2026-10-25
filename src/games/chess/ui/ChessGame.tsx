import { type ReactNode, useMemo, useState } from "react";
import { Clock } from "../../kit/ui/Clock";
import { DuelControls, DuelFooter, DuelMoves, DuelResult, DuelSide, DuelStatus, DuelTable, playerOf, SeatPrompt, winsText } from "../../kit/ui/Duel";
import { useSend } from "../../kit/ui/useSend";
import type { GameUIProps } from "../../ui";
import { type ChessView, type LastMove, resultText, SPEC } from "../engine";
import type { ChessOp } from "../index";
import { type Color, colorOf, legalMoves, makeMove, moveFacts, other, parseFen, parseUci, type Piece, type PieceType, pieceOf, sameMove, squareName, toFen, toSan, typeOf, VALUE } from "../rules";
import { Board, pieceSrc } from "./Board";
import "./chess.css";

type Props = GameUIProps<ChessView, ChessOp>;
const COLOR_NAME = { w: "White", b: "Black" } as const;
const PIECE_NAME: Record<PieceType, string> = { p: "pawn", n: "knight", b: "bishop", r: "rook", q: "queen", k: "king" };

export function ChessGame({ view, me, members, connected, sendOp, serverNow }: Props) {
  const name = (id: string) => members.get(id)?.name ?? "Player";
  const online = (id: string) => members.get(id)?.online !== false;
  const { busy, send } = useSend(sendOp);

  // Your move shows at once; it's taken back if the server says no.
  const [pending, setPending] = useState<{ base: string; uci: string } | null>(null);
  const shown = useMemo((): { fen: string; lastMove: LastMove | null } => {
    if (!pending || pending.base !== view.fen) return { fen: view.fen, lastMove: view.lastMove };
    const pos = parseFen(view.fen);
    const legal = legalMoves(pos);
    const m = legal.find((l) => sameMove(l, parseUci(pending.uci)!));
    if (!m) return { fen: view.fen, lastMove: view.lastMove };
    const facts = moveFacts(pos, m);
    return {
      fen: toFen(makeMove(pos, m)),
      lastMove: { uci: pending.uci, san: toSan(pos, m, legal), piece: facts.piece, took: facts.took, tookAt: facts.tookAt === null ? null : squareName(facts.tookAt) },
    };
  }, [pending, view.fen, view.lastMove]);
  const move = async (uci: string) => {
    setPending({ base: view.fen, uci });
    if (!(await sendOp({ type: "move", move: uci }))) setPending(null);
  };

  const myColor = view.you.color;
  const [flipped, setFlipped] = useState(false);
  const bottom: Color = flipped ? other(myColor ?? "w") : (myColor ?? "w");
  const myTurn = view.phase === "playing" && myColor === view.turn;
  const board = useMemo(() => parseFen(shown.fen).board, [shown.fen]);

  const side = (c: Color, where: "top" | "bottom") => {
    const taken = takenBy(board, c);
    const ahead = materialOf(board, c) - materialOf(board, other(c));
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
        testId={`chess-side-${c}`}
        clock={view.clock && <Clock clock={view.clock} side={c} serverNow={serverNow} testId={`chess-clock-${c}`} />}
      >
        <span className="chess-taken" aria-label={taken.length ? `has taken ${taken.length}` : undefined}>
          {taken.map((p, i) => (
            <img key={i} src={pieceSrc(p)} alt="" className={i > 0 && taken[i - 1] !== p ? "gap" : ""} />
          ))}
          {ahead > 0 && <span className="chess-ahead">+{ahead}</span>}
        </span>
        <span className="duel-wins">
          <span className={`chess-color-tag ${c}`} aria-hidden />
          {COLOR_NAME[c]} · {winsText(view.seats.find((s) => s?.playerId === playerOf(view, SPEC.colors, c)))}
        </span>
      </DuelSide>
    );
  };
  const flip = (
    <button type="button" className="btn ghost small chess-flip" onClick={() => setFlipped((f) => !f)} title="Flip the board" aria-label="Flip the board">
      ⇅
    </button>
  );

  return (
    <DuelTable
      className="chess"
      testId="chess"
      top={side(other(bottom), "top")}
      bottom={side(bottom, "bottom")}
      board={
        <div className="chess-board-wrap">
          <Board fen={shown.fen} orientation={bottom} lastMove={shown.lastMove} movable={myTurn && connected && shown.fen === view.fen ? myColor : null} onMove={move}>
            <SeatPrompt view={view} game="chess" blurb="Sit down and someone else takes the other side. Colors swap every game." name={name} disabled={!connected || busy} send={send} testId="chess-sit" />
          </Board>
        </div>
      }
      panel={
        <>
          <Moves moves={view.moves} />
          {shown.lastMove && view.phase !== "waiting" && <LastMoveLine last={shown.lastMove} mover={other(parseFen(shown.fen).turn)} view={view} me={me} name={name} />}
          <DuelStatus
            view={view}
            me={me}
            name={name}
            myTurn={myTurn}
            result={(who) => resultText(view.result!, who)}
            intro="White moves first. Colors swap every game."
            label={(c) => `${COLOR_NAME[c]}`}
            yourMove={view.check ? "Your move: get your king out of check." : "Your move."}
            {...(view.phase === "playing" && view.check ? (myTurn ? { tone: "check" } : { text: `${COLOR_NAME[view.turn]} to move${view.sides ? ` (${name(view.sides[view.turn])})` : ""}, in check…` }) : {})}
            testId="chess-status"
          />
          {myColor && view.phase === "playing" && view.drawOffer === other(myColor) ? (
            <div className="duel-controls chess-offer" data-testid="chess-draw-offer">
              <span>{COLOR_NAME[other(myColor)]} offers a draw.</span>
              <span className="row">
                <button className="btn primary small" disabled={busy || !connected} onClick={() => send({ type: "acceptDraw" })}>
                  Accept
                </button>
                <button className="btn small" disabled={busy || !connected} onClick={() => send({ type: "declineDraw" })}>
                  Decline
                </button>
              </span>
            </div>
          ) : (
            <DuelControls view={view} busy={busy} connected={connected} send={send} testId="chess" aside={flip}>
              <button
                className="btn small"
                disabled={busy || !connected || !view.you.canOfferDraw}
                onClick={() => send({ type: "offerDraw" })}
                title={view.drawOffer === myColor ? "Your offer stands until they move" : undefined}
                data-testid="chess-offer-draw"
              >
                {view.drawOffer === myColor ? "Draw offered" : "½ Offer draw"}
              </button>
            </DuelControls>
          )}
        </>
      }
    >
      <ChessResult view={view} me={me} name={name} busy={busy} connected={connected} send={send} />
      <DuelFooter
        view={view}
        moved={view.moves.length > (myColor === "w" ? 0 : 1)}
        busy={busy}
        connected={connected}
        send={send}
        log={view.moves.length > 0 && <CopyPgn view={view} name={name} />}
      />
    </DuelTable>
  );
}

// --- the players --------------------------------------------------------------

const START_COUNT: Record<Exclude<PieceType, "k">, number> = { q: 1, r: 2, b: 2, n: 2, p: 8 };

/** The pieces `c` has taken (the other side's missing ones), most valuable first. */
function takenBy(board: (Piece | null)[], c: Color): Piece[] {
  const theirs = other(c);
  const left = new Map<PieceType, number>();
  for (const p of board) if (p && colorOf(p) === theirs) left.set(typeOf(p), (left.get(typeOf(p)) ?? 0) + 1);
  return (Object.keys(START_COUNT) as Exclude<PieceType, "k">[]).flatMap((t) => {
    const missing = Math.max(0, START_COUNT[t] - (left.get(t) ?? 0));
    return Array.from({ length: missing }, () => (theirs === "w" ? t.toUpperCase() : t) as Piece);
  });
}

function materialOf(board: (Piece | null)[], c: Color) {
  return board.reduce((n, p) => (p && colorOf(p) === c ? n + VALUE[typeOf(p)] : n), 0);
}

// --- the panel ----------------------------------------------------------------

function Moves({ moves }: { moves: ChessView["moves"] }) {
  const one = (i: number) => {
    const m = moves[i];
    if (!m) return <span className="chess-move" />;
    const by: Color = i % 2 === 0 ? "w" : "b";
    const check = m.san.endsWith("#") ? "mate" : m.san.endsWith("+") ? "check" : "";
    return (
      <span className={`chess-move ${check} ${i === moves.length - 1 ? "last" : ""}`}>
        {m.san}
        {m.took && <img className="chess-move-took" src={pieceSrc(pieceOf(other(by), m.took))} alt={`, takes a ${PIECE_NAME[m.took]}`} title={`Took a ${PIECE_NAME[m.took]}`} />}
      </span>
    );
  };
  const rows = Array.from({ length: Math.ceil(moves.length / 2) }, (_, i) => i);
  return (
    <DuelMoves count={moves.length} label="Moves" testId="chess-moves" className="chess-moves">
      {rows.map((i) => (
        <li key={i}>
          <span className="chess-move-num">{i + 1}.</span>
          {one(i * 2)}
          {one(i * 2 + 1)}
        </li>
      ))}
    </DuelMoves>
  );
}

/** The last move in words: "Rivet's queen took your bishop on d5. Check!" */
function LastMoveLine({ last, mover, view, me, name }: { last: LastMove; mover: Color; view: ChessView; me: string; name(id: string): string }) {
  const isMe = (c: Color) => view.sides?.[c] === me;
  const nameOf = (c: Color) => (view.sides ? name(view.sides[c]) : COLOR_NAME[c]);
  const whose = (c: Color, start: boolean) => (isMe(c) ? (start ? "Your" : "your") : `${nameOf(c)}'s`);
  const piece = (c: Color, t: PieceType) => (
    <>
      <img className="chess-inline-piece" src={pieceSrc(pieceOf(c, t))} alt="" />
      {PIECE_NAME[t]}
    </>
  );
  const to = last.uci.slice(2, 4);
  const promotion = last.uci[4] as PieceType | undefined;
  let text: ReactNode;
  if (last.san.startsWith("O-O")) text = <>{isMe(mover) ? "You" : nameOf(mover)} castled {last.san.startsWith("O-O-O") ? "queenside" : "kingside"}.</>;
  else {
    const them = other(mover);
    text = last.took ? (
      <>
        {whose(mover, true)} {piece(mover, last.piece)} took {whose(them, false)} {piece(them, last.took)} on {last.tookAt}
        {last.tookAt !== to && " (en passant)"}
      </>
    ) : (
      <>
        {whose(mover, true)} {piece(mover, last.piece)} moved to {to}
      </>
    );
    if (promotion) text = <>{text} and became a {piece(mover, promotion)}</>;
    text = <>{text}.</>;
  }
  const mate = last.san.endsWith("#");
  const check = mate || last.san.endsWith("+");
  const checked = other(mover);
  return (
    <div className={`duel-last ${last.took ? "took" : ""}`} data-testid="chess-last">
      {text}{" "}
      {check && <span className="chess-check-tag">{mate ? "Checkmate!" : isMe(checked) ? "You're in check!" : "Check!"}</span>}
    </div>
  );
}

/** The game as PGN, for pasting into an analysis board. */
function CopyPgn({ view, name }: { view: ChessView; name(id: string): string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    const result = view.result ? (view.result.winner === "w" ? "1-0" : view.result.winner === "b" ? "0-1" : "1/2-1/2") : "*";
    const tags = [
      ["Event", `gg chess, game ${view.game}`],
      ["White", view.sides ? name(view.sides.w) : "?"],
      ["Black", view.sides ? name(view.sides.b) : "?"],
      ["Result", result],
    ].map(([k, v]) => `[${k} "${v!.replace(/"/g, "'")}"]`);
    const moves = view.moves.map((m, i) => (i % 2 === 0 ? `${i / 2 + 1}. ${m.san}` : m.san)).join(" ");
    try {
      await navigator.clipboard.writeText(`${tags.join("\n")}\n\n${moves} ${result}\n`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // No clipboard (an insecure page): nothing to do.
    }
  };
  return (
    <button className="btn ghost small" onClick={copy}>
      {copied ? "Copied" : "Copy PGN"}
    </button>
  );
}

const HOW: Record<string, string> = {
  checkmate: "by checkmate",
  resign: "by resignation",
  timeout: "on time",
  left: "(the other player left)",
  stalemate: "Stalemate",
  repetition: "Threefold repetition",
  fifty: "The fifty-move rule",
  material: "Neither side can mate",
  agreement: "Agreed",
  timeoutDraw: "Out of time against a lone king",
};

/** The end of a game: who won and how, and the score between the two in this room. */
function ChessResult(props: { view: ChessView; me: string; name(id: string): string; busy: boolean; connected: boolean; send(op: ChessOp): unknown }) {
  const r = props.view.result;
  const moves = Math.ceil(props.view.moves.length / 2);
  const after = `after ${moves} ${moves === 1 ? "move" : "moves"}`;
  const subtitle = !r ? "" : r.winner ? `${COLOR_NAME[r.winner]} wins ${HOW[r.reason] ?? ""} ${after}.` : `${HOW[r.reason] ?? "Drawn"} ${after}.`;
  return (
    <DuelResult
      {...props}
      colors={SPEC.colors}
      subtitle={subtitle}
      columns={["Played", "This game", "Wins here"]}
      cells={(c, seat) => [COLOR_NAME[c], r?.winner === c ? "1" : r?.winner ? "0" : "½", seat?.wins ?? "–"]}
      again="swap colors"
      testId="chess-result"
    />
  );
}
