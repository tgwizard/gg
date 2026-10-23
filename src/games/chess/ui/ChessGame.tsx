import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { Clock } from "../../kit/ui/Clock";
import { GameOver } from "../../kit/ui/GameOver";
import { PlayerPlate } from "../../kit/ui/PlayerPlate";
import type { GameUIProps } from "../../ui";
import { type ChessView, type LastMove, resultText, type Side } from "../engine";
import type { ChessOp } from "../index";
import { type Color, colorOf, legalMoves, makeMove, moveFacts, other, parseFen, parseUci, type Piece, type PieceType, pieceOf, sameMove, squareName, toFen, toSan, typeOf, VALUE } from "../rules";
import { Board, pieceSrc } from "./Board";
import "./chess.css";

type Props = GameUIProps<ChessView, ChessOp>;
const COLOR_NAME = { w: "White", b: "Black" } as const;
const PIECE_NAME: Record<PieceType, string> = { p: "pawn", n: "knight", b: "bishop", r: "rook", q: "queen", k: "king" };

export function ChessGame({ view, me, members, connected, sendOp, serverNow }: Props) {
  const name = (id: string) => members.get(id)?.name ?? "Player";
  const [busy, setBusy] = useState(false);
  const send = async (op: ChessOp) => {
    setBusy(true);
    const ok = await sendOp(op);
    setBusy(false);
    return ok;
  };

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

  const mySeat = view.you.seat;
  const myColor = view.you.color;
  const [flipped, setFlipped] = useState(false);
  const bottom: Color = flipped ? other(myColor ?? "w") : (myColor ?? "w");
  const playing = view.phase === "playing";
  const myTurn = playing && myColor === view.turn;
  const open = ([0, 1] as Side[]).filter((s) => !view.seats[s]);
  const prompt: "pick" | "wait" | null = view.phase !== "waiting" ? null : mySeat === null ? "pick" : "wait";

  /** Who sits on a color's side: whoever's in its seat, or (after a game) whoever played it. */
  const playerOf = (c: Color): string | null => {
    const seat = c === "w" ? view.whiteSeat : 1 - view.whiteSeat;
    return view.seats[seat]?.playerId ?? (view.phase === "over" ? (view.sides?.[c] ?? null) : null);
  };
  const board = useMemo(() => parseFen(shown.fen).board, [shown.fen]);

  const side = (c: Color, where: "top" | "bottom") => (
    <Side
      key={c}
      where={where}
      color={c}
      view={view}
      playerId={playerOf(c)}
      me={me}
      name={name}
      online={(id) => members.get(id)?.online !== false}
      board={board}
      serverNow={serverNow}
    />
  );

  return (
    <div className="chess" data-testid="chess">
      <div className="chess-grid">
        {side(other(bottom), "top")}
        <div className="chess-board-wrap">
          <Board fen={shown.fen} orientation={bottom} lastMove={shown.lastMove} movable={myTurn && connected && shown.fen === view.fen ? myColor : null} onMove={move}>
            {prompt && (
              <div className="chess-prompt-backdrop">
                {prompt === "pick" ? (
                  <div className="chess-prompt box" role="dialog" aria-label="Take a seat">
                    <h3 className="display">{open.length === 2 ? "Play chess" : `Take on ${name(view.seats[1 - open[0]!]!.playerId)}`}</h3>
                    <p className="muted">{open.length === 2 ? "Sit down and someone else takes the other side. Colors swap every game." : "The game starts as soon as you sit down."}</p>
                    <button className="btn primary big" disabled={!connected || busy} onClick={() => send({ type: "sit", seat: open[0]! })} data-testid="chess-sit">
                      Take a seat
                    </button>
                  </div>
                ) : (
                  <div className="chess-prompt box" role="status">
                    <h3 className="display">Waiting for an opponent</h3>
                    <p className="muted">Share the room link (Copy invite link, at the top) so someone can take the other side.</p>
                  </div>
                )}
              </div>
            )}
          </Board>
        </div>
        {side(bottom, "bottom")}

        <div className="chess-panel box">
          <Moves moves={view.moves} />
          {shown.lastMove && view.phase !== "waiting" && <LastMoveLine last={shown.lastMove} mover={other(parseFen(shown.fen).turn)} view={view} me={me} name={name} />}
          <Status view={view} me={me} name={name} myTurn={myTurn} />
          <Controls view={view} busy={busy} connected={connected} send={send} onFlip={() => setFlipped((f) => !f)} />
        </div>
      </div>

      <ChessResult view={view} me={me} name={name} rematch={view.canRematch && mySeat !== null ? () => send({ type: "rematch" }) : null} disabled={busy || !connected} />

      <div className="table-footer">
        <div className="table-footer-log">
          {view.moves.length > 0 && <CopyPgn view={view} name={name} />}
        </div>
        {mySeat !== null && (
          <div className="table-footer-actions">
            <button className="btn ghost small" disabled={!connected || busy} onClick={() => send({ type: "leave" })}>
              {playing ? (view.moves.length > (myColor === "w" ? 0 : 1) ? "Resign & leave" : "Leave (calls the game off)") : "Leave seat"}
            </button>
          </div>
        )}
      </div>
    </div>
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

function Side(props: {
  where: "top" | "bottom";
  color: Color;
  view: ChessView;
  playerId: string | null;
  me: string;
  name(id: string): string;
  online(id: string): boolean;
  board: (Piece | null)[];
  serverNow: number;
}) {
  const { view, color: c, playerId } = props;
  const seat = view.seats.find((s) => s?.playerId === playerId) ?? null;
  const taken = takenBy(props.board, c);
  const ahead = materialOf(props.board, c) - materialOf(props.board, other(c));
  const won = view.phase === "over" && view.result?.winner === c;
  const toMove = view.phase === "playing" && view.turn === c;
  return (
    <div className={`chess-side ${props.where}`} data-testid={`chess-side-${c}`}>
      {playerId ? (
        <PlayerPlate
          playerId={playerId}
          name={props.name(playerId)}
          you={playerId === props.me}
          online={props.online(playerId)}
          active={toMove}
          winner={won}
          dim={!seat}
        >
          <div className="plate-line chess-plate-line">
            <span className="chess-taken" aria-label={taken.length ? `has taken ${taken.length}` : undefined}>
              {taken.map((p, i) => (
                <img key={i} src={pieceSrc(p)} alt="" className={i > 0 && taken[i - 1] !== p ? "gap" : ""} />
              ))}
              {ahead > 0 && <span className="chess-ahead">+{ahead}</span>}
            </span>
            <span className="chess-wins">
              <span className={`chess-color-tag ${c}`} aria-hidden />
              {COLOR_NAME[c]} · {seat ? `${seat.wins} ${seat.wins === 1 ? "win" : "wins"}` : "left"}
            </span>
          </div>
        </PlayerPlate>
      ) : (
        <div className="chess-open-seat">
          <span className="label">Open seat · {COLOR_NAME[c]}</span>
        </div>
      )}
      {view.clock && <Clock clock={view.clock} side={c} serverNow={props.serverNow} testId={`chess-clock-${c}`} />}
    </div>
  );
}

// --- the panel ----------------------------------------------------------------

function Moves({ moves }: { moves: ChessView["moves"] }) {
  const ref = useRef<HTMLOListElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTo({ top: el.scrollHeight, left: el.scrollWidth });
  }, [moves.length]);
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
    <ol className="chess-moves" ref={ref} aria-label="Moves" data-testid="chess-moves">
      {rows.length === 0 && <li className="chess-moves-empty muted">No moves yet.</li>}
      {rows.map((i) => (
        <li key={i}>
          <span className="chess-move-num">{i + 1}.</span>
          {one(i * 2)}
          {one(i * 2 + 1)}
        </li>
      ))}
    </ol>
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
    <div className={`chess-last ${last.took ? "took" : ""}`} data-testid="chess-last">
      {text}{" "}
      {check && <span className="chess-check-tag">{mate ? "Checkmate!" : isMe(checked) ? "You're in check!" : "Check!"}</span>}
    </div>
  );
}

function Status({ view, me, name, myTurn }: { view: ChessView; me: string; name(id: string): string; myTurn: boolean }) {
  let text: string;
  let tone = "";
  if (view.phase === "over" && view.result) {
    const who = (c: Color) => (view.sides?.[c] === me ? "You" : name(view.sides?.[c] ?? ""));
    text = resultText(view.result, who).replace("You wins", "You win");
    tone = view.result.winner === null ? "draw" : view.sides?.[view.result.winner] === me ? "won" : view.you.color ? "lost" : "";
  } else if (view.phase === "playing") {
    const mover = view.sides?.[view.turn];
    text = myTurn ? (view.check ? "Your move: get your king out of check." : "Your move.") : `${COLOR_NAME[view.turn]} to move${mover ? ` (${name(mover)})` : ""}${view.check ? ", in check" : ""}…`;
    if (myTurn) tone = view.check ? "check" : "turn";
  } else text = view.game === 0 ? "White moves first. Colors swap every game." : "The game was called off. Waiting for two players.";
  return (
    <div className={`chess-status ${tone}`} aria-live="polite" data-testid="chess-status">
      {text}
    </div>
  );
}

function Controls(props: { view: ChessView; busy: boolean; connected: boolean; send(op: ChessOp): Promise<boolean>; onFlip(): void }) {
  const { view, send } = props;
  const [confirm, setConfirm] = useState(false);
  const disabled = props.busy || !props.connected;
  const color = view.you.color;
  const playing = view.phase === "playing" && color !== null && view.you.seat !== null;
  useEffect(() => setConfirm(false), [view.phase, view.game]);
  const flip = (
    <button type="button" className="btn ghost small chess-flip" onClick={props.onFlip} title="Flip the board" aria-label="Flip the board">
      ⇅
    </button>
  );

  if (playing && view.drawOffer === other(color)) {
    return (
      <div className="chess-controls offer" data-testid="chess-draw-offer">
        <span>{COLOR_NAME[other(color)]} offers a draw.</span>
        <span className="row">
          <button className="btn primary small" disabled={disabled} onClick={() => send({ type: "acceptDraw" })}>
            Accept
          </button>
          <button className="btn small" disabled={disabled} onClick={() => send({ type: "declineDraw" })}>
            Decline
          </button>
        </span>
      </div>
    );
  }
  if (playing && confirm) {
    return (
      <div className="chess-controls">
        <span>Resign this game?</span>
        <span className="row">
          <button className="btn danger small" disabled={disabled} onClick={() => send({ type: "resign" })} data-testid="chess-resign-yes">
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
      <div className="chess-controls">
        <span className="row">
          <button
            className="btn small"
            disabled={disabled || !view.you.canOfferDraw}
            onClick={() => send({ type: "offerDraw" })}
            title={view.drawOffer === color ? "Your offer stands until they move" : undefined}
            data-testid="chess-offer-draw"
          >
            {view.drawOffer === color ? "Draw offered" : "½ Offer draw"}
          </button>
          <button className="btn small" disabled={disabled} onClick={() => setConfirm(true)} data-testid="chess-resign">
            ⚑ Resign
          </button>
        </span>
        {flip}
      </div>
    );
  }
  const openSeat = ([0, 1] as Side[]).find((s) => !view.seats[s]);
  return (
    <div className="chess-controls">
      <span className="row">
        {view.phase === "over" && view.you.seat !== null && !view.canRematch && <span className="muted">Waiting for an opponent to sit down.</span>}
        {view.phase === "over" && view.you.seat === null && openSeat !== undefined && (
          <button className="btn" disabled={disabled} onClick={() => send({ type: "sit", seat: openSeat })}>
            Take the open seat
          </button>
        )}
      </span>
      {flip}
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
function ChessResult({ view, me, name, rematch, disabled }: { view: ChessView; me: string; name(id: string): string; rematch: (() => void) | null; disabled: boolean }) {
  const r = view.result;
  const sides = view.sides;
  const moves = Math.ceil(view.moves.length / 2);
  let title = "";
  let subtitle = "";
  if (r && sides) {
    if (r.winner) {
      title = sides[r.winner] === me ? "You win!" : `${name(sides[r.winner])} wins!`;
      subtitle = `${COLOR_NAME[r.winner]} wins ${HOW[r.reason] ?? ""} after ${moves} ${moves === 1 ? "move" : "moves"}.`;
    } else {
      title = "A draw";
      subtitle = `${HOW[r.reason] ?? "Drawn"} after ${moves} ${moves === 1 ? "move" : "moves"}.`;
    }
  }
  const order: Color[] = r?.winner === "b" ? ["b", "w"] : ["w", "b"];
  return (
    <GameOver
      open={view.phase === "over" && !!r && !!sides}
      gameKey={view.game}
      me={me}
      testId="chess-result"
      title={title}
      subtitle={subtitle}
      columns={["Played", "This game", "Wins here"]}
      rows={order.flatMap((c) => {
        const id = sides?.[c];
        if (!id) return [];
        const seat = view.seats.find((s) => s?.playerId === id);
        return [
          {
            playerId: id,
            name: name(id),
            winner: r?.winner === c,
            left: !seat,
            cells: [COLOR_NAME[c], r?.winner === c ? "1" : r?.winner ? "0" : "½", seat?.wins ?? "–"],
          },
        ];
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
