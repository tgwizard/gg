import { type PointerEvent, type ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { play } from "../../../ui";
import type { LastMove } from "../engine";
import { castlingOptions, type Color, colorOf, FILES, fileOf, inCheck, kingSquare, legalMoves, type Move, type Piece, parseFen, parseSquare, parseUci, pieceOf, premoves, type Promotion, rankOf, squareName, toUci, typeOf } from "../rules";

export const pieceSrc = (p: Piece) => `/pieces/${colorOf(p)}${p.toUpperCase()}.svg`;
const PIECE_NAMES: Record<string, string> = { p: "pawn", n: "knight", b: "bishop", r: "rook", q: "queen", k: "king" };
const PICKS: Promotion[] = ["q", "n", "r", "b"];
const reducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/**
 * The board. Click a piece then a square, or drag it there; the squares it can reach
 * are marked. To castle, move the king two squares or onto the rook (both are marked,
 * and pointing at one shows where the two end up). While the other side is to move,
 * the same queues up a premove instead, shown until it's played or called off (by
 * clicking an empty square, a right-click or Escape), its piece drawn faintly where
 * it's going. Pieces slide for moves you didn't drag
 * yourself, and a piece that's taken fades away.
 */
export function Board(props: {
  fen: string;
  /** The color at the bottom. */
  orientation: Color;
  /** To highlight and animate. */
  lastMove: LastMove | null;
  /** The color whose pieces you can move now, or null. */
  movable: Color | null;
  onMove(uci: string): void;
  /** The color that can queue up a premove now (while the other side is to move), or null. */
  premovable?: Color | null;
  /** The premove queued up, in UCI. */
  premove?: string | null;
  /** A premove queued up (UCI), or called off (null). */
  onPremove?(uci: string | null): void;
  /** The piece picked up (a square name), or null. */
  onSelect?(square: string | null): void;
  /** Overlays (a prompt to sit down). */
  children?: ReactNode;
}) {
  const pos = useMemo(() => parseFen(props.fen), [props.fen]);
  const now = !!props.movable && pos.turn === props.movable;
  /** Whose pieces you can pick up: to move now, or to premove. */
  const mover = now ? props.movable! : props.premovable && pos.turn !== props.premovable ? props.premovable : null;
  const legal = useMemo(() => (now ? legalMoves(pos) : mover ? premoves(pos, mover) : []), [pos, now, mover]);
  const castles = useMemo(() => (mover ? castlingOptions(pos, mover).filter((o) => (now ? !o.why : o.premove)) : []), [pos, now, mover]);
  const [selected, setSelectedState] = useState<number | null>(null);
  const setSelected = (sq: number | null) => {
    setSelectedState(sq);
    props.onSelect?.(sq === null ? null : squareName(sq));
  };
  /** The square under the pointer, while a king is picked up (to preview castling). */
  const [hover, setHover] = useState<number | null>(null);
  const [drag, setDrag] = useState<{ from: number; x: number; y: number; moved: boolean; over: number | null } | null>(null);
  const [promoting, setPromoting] = useState<{ from: number; to: number } | null>(null);
  /** A piece that was just taken, fading out where it stood. */
  const [ghost, setGhost] = useState<{ sq: number; piece: Piece; key: string } | null>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const reselected = useRef(false);
  const dropped = useRef<string | null>(null);
  const flip = props.orientation === "b";

  // What you had picked up goes back when the position changes, unless it's still yours
  // to move: a piece picked up for a premove can be played once it's your turn.
  useEffect(() => {
    const keep = (sq: number) => !!mover && !!pos.board[sq] && colorOf(pos.board[sq]!) === mover;
    if (selected !== null && !keep(selected)) setSelected(null);
    setDrag((d) => (d && keep(d.from) ? d : null));
    setPromoting(null);
  }, [props.fen, mover]);

  // Escape puts down what you'd picked up and calls off a premove (the promotion picker has its own).
  useEffect(() => {
    if (promoting || (!props.premove && selected === null)) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setSelected(null);
      if (props.premove) props.onPremove?.(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [promoting, props.premove, selected]);

  useEffect(() => {
    if (!promoting) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setPromoting(null);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [promoting]);

  /** Where a square is drawn: column and row from the top left. */
  const cell = (sq: number) => ({ col: flip ? 7 - fileOf(sq) : fileOf(sq), row: flip ? rankOf(sq) : 7 - rankOf(sq) });
  const squareAt = (clientX: number, clientY: number): number | null => {
    const r = boardRef.current!.getBoundingClientRect();
    const col = Math.floor(((clientX - r.left) / r.width) * 8);
    const row = Math.floor(((clientY - r.top) / r.height) * 8);
    if (col < 0 || col > 7 || row < 0 || row > 7) return null;
    return (flip ? row : 7 - row) * 8 + (flip ? 7 - col : col);
  };
  const own = (sq: number) => {
    const p = pos.board[sq];
    return !!p && !!mover && colorOf(p) === mover;
  };
  const targets = new Map<number, Move>(selected === null ? [] : legal.filter((m) => m.from === selected).map((m) => [m.to, m]));
  /** The castling a square stands for when the king at `from` is put there (its two-square move, or its rook), or undefined. */
  const castleAt = (from: number | null, sq: number | null) => (from === null || sq === null ? undefined : castles.find((o) => o.king === from && (o.to === sq || o.rook === sq)));
  /** Where the king goes when it's put on its own rook to castle, or null. */
  const castleTo = (from: number, sq: number): number | null => {
    const o = castleAt(from, sq);
    return o && o.rook === sq ? o.to : null;
  };
  const premove = props.premove ? parseUci(props.premove) : null;
  /** Where a premove puts its piece (and the rook, castling), drawn faintly there until it's played. */
  const premoved: { sq: number; piece: Piece }[] = [];
  const premover = premove && pos.board[premove.from];
  if (premove && premover) {
    premoved.push({ sq: premove.to, piece: premove.promotion ? pieceOf(colorOf(premover), premove.promotion) : premover });
    if (typeOf(premover) === "k" && Math.abs(premove.to - premove.from) === 2) {
      const [rook, rookTo] = premove.to > premove.from ? [premove.from + 3, premove.from + 1] : [premove.from - 4, premove.from - 1];
      if (pos.board[rook]) premoved.push({ sq: rookTo, piece: pos.board[rook]! });
    }
  }

  // Slide the piece that just moved (and the rook, when castling) from where it was.
  const prevFen = useRef(props.fen);
  useLayoutEffect(() => {
    const before = prevFen.current;
    prevFen.current = props.fen;
    const last = props.lastMove;
    const m = last ? parseUci(last.uci) : null;
    if (!last || !m || before === props.fen) return;
    play(last.took ? "capture" : "place");
    if (reducedMotion()) return;
    if (last.took && last.tookAt) setGhost({ sq: parseSquare(last.tookAt)!, piece: pieceOf(pos.turn, last.took), key: props.fen });
    if (dropped.current === last.uci) return;
    const slide = (from: number, to: number) => {
      const el = boardRef.current?.querySelector<HTMLElement>(`.chess-piece[data-sq="${to}"]`);
      const [a, b] = [cell(from), cell(to)];
      el?.animate([{ translate: `${(a.col - b.col) * 100}% ${(a.row - b.row) * 100}%` }, { translate: "0 0" }], { duration: 200, easing: "cubic-bezier(.3,.7,.4,1)" });
    };
    slide(m.from, m.to);
    if (typeOf(pos.board[m.to] ?? "p") === "k" && Math.abs(m.to - m.from) === 2) slide(m.to > m.from ? m.from + 3 : m.from - 4, m.to > m.from ? m.from + 1 : m.from - 1);
  }, [props.fen, props.lastMove]);

  const done = (uci: string, viaDrag: boolean) => {
    setSelected(null);
    setHover(null);
    if (now) {
      dropped.current = viaDrag ? uci : null;
      props.onMove(uci);
    } else props.onPremove?.(uci);
  };
  const tryMove = (from: number, to: number, viaDrag: boolean) => {
    const options = legal.filter((m) => m.from === from && m.to === to);
    if (!options.length) return false;
    if (options.some((m) => m.promotion)) setPromoting({ from, to });
    else done(toUci(options[0]!), viaDrag);
    return true;
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (promoting) return;
    // A right-click puts down what you'd picked up and calls off a premove.
    if (e.button === 2) {
      setSelected(null);
      if (props.premove) props.onPremove?.(null);
      return;
    }
    if (e.button !== 0) return;
    const sq = squareAt(e.clientX, e.clientY);
    if (sq === null) return;
    if (selected !== null && targets.has(sq)) {
      tryMove(selected, sq, false);
      return;
    }
    const castle = selected === null ? null : castleTo(selected, sq);
    if (castle !== null) {
      tryMove(selected!, castle, false);
      return;
    }
    if (!own(sq)) {
      setSelected(null);
      if (props.premove) props.onPremove?.(null);
      return;
    }
    e.preventDefault();
    reselected.current = selected === sq;
    setSelected(sq);
    const r = boardRef.current!.getBoundingClientRect();
    setDrag({ from: sq, x: e.clientX - r.left, y: e.clientY - r.top, moved: false, over: sq });
    boardRef.current!.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const from = drag?.from ?? selected;
    const sq = from !== null && castles.some((o) => o.king === from) ? squareAt(e.clientX, e.clientY) : null;
    if (sq !== hover) setHover(sq);
    if (!drag) return;
    const r = boardRef.current!.getBoundingClientRect();
    const [x, y] = [e.clientX - r.left, e.clientY - r.top];
    setDrag({ ...drag, x, y, moved: drag.moved || Math.hypot(x - drag.x, y - drag.y) > 4, over: squareAt(e.clientX, e.clientY) });
  };
  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag) return;
    setDrag(null);
    const sq = squareAt(e.clientX, e.clientY);
    if (sq !== null && sq !== drag.from) tryMove(drag.from, castleTo(drag.from, sq) ?? sq, drag.moved);
    // A second click on the piece you'd picked up puts it down.
    else if (sq === drag.from && !drag.moved && reselected.current) setSelected(null);
  };

  const last = props.lastMove ? parseUci(props.lastMove.uci) : null;
  const checked = inCheck(pos) ? kingSquare(pos.board, pos.turn) : -1;
  /** The castling being pointed at, to show where the king and rook end up. */
  const preview = castleAt(drag?.from ?? selected, hover);

  const squares = [];
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const sq = (flip ? row : 7 - row) * 8 + (flip ? 7 - col : col);
      const target = targets.get(sq);
      const cls = [
        "chess-sq",
        (fileOf(sq) + rankOf(sq)) % 2 ? "sq-light" : "sq-dark",
        last && (sq === last.from || sq === last.to) && "last",
        sq === selected && "selected",
        target && (pos.board[sq] || (typeOf(pos.board[target.from]!) === "p" && fileOf(sq) !== fileOf(target.from)) ? "target capture" : "target"),
        castleAt(selected, sq) && "target castle",
        drag?.moved && drag.over === sq && (targets.has(sq) || castleTo(drag.from, sq) !== null) && "over",
        premove && (sq === premove.from || sq === premove.to) && "premove",
        sq === checked && "check",
      ]
        .filter(Boolean)
        .join(" ");
      const castle = castleAt(selected, sq);
      squares.push(
        <div key={sq} className={cls} style={{ gridRow: row + 1, gridColumn: col + 1 }} data-testid={`chess-sq-${squareName(sq)}`} data-square={squareName(sq)}>
          {col === 0 && <span className="chess-coord rank">{rankOf(sq) + 1}</span>}
          {row === 7 && <span className="chess-coord file">{FILES[fileOf(sq)]}</span>}
          {castle?.rook === sq && <span className="chess-castle-tag">castle</span>}
        </div>,
      );
    }
  }

  return (
    <div
      ref={boardRef}
      className={`chess-board ${mover ? "movable" : ""} ${now ? "" : "premoving"} ${drag?.moved ? "dragging" : ""}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => setDrag(null)}
      onPointerLeave={() => setHover(null)}
      onContextMenu={(e) => e.preventDefault()}
      role="grid"
      aria-label="Chess board"
      data-testid="chess-board"
    >
      {squares}
      {pos.board.map((p, sq) => {
        if (!p) return null;
        const { col, row } = cell(sq);
        const lifted = drag?.moved && drag.from === sq;
        // Pointing at a castling: the king and rook fade where they stand.
        const leaving = preview && !lifted && (sq === preview.king || sq === preview.rook);
        const style = lifted
          ? { left: `calc(${drag.x}px - 6.25%)`, top: `calc(${drag.y}px - 6.25%)` }
          : { left: `${col * 12.5}%`, top: `${row * 12.5}%` };
        return (
          <img
            key={sq}
            className={`chess-piece ${lifted ? "lifted" : ""} ${leaving ? "leaving" : ""} ${own(sq) ? "own" : ""}`}
            src={pieceSrc(p)}
            alt={`${colorOf(p) === "w" ? "White" : "Black"} ${PIECE_NAMES[typeOf(p)]} on ${squareName(sq)}`}
            draggable={false}
            style={style}
            data-sq={sq}
            data-testid={`chess-piece-${squareName(sq)}`}
          />
        );
      })}
      {preview &&
        [
          { sq: preview.to, from: preview.king },
          { sq: preview.rookTo, from: preview.rook },
        ].map(({ sq, from }) => (
          <img
            key={`preview-${sq}`}
            className="chess-piece chess-preview"
            src={pieceSrc(pos.board[from]!)}
            alt=""
            draggable={false}
            style={{ left: `${cell(sq).col * 12.5}%`, top: `${cell(sq).row * 12.5}%` }}
            data-testid="chess-castle-preview"
          />
        ))}
      {premoved.map(({ sq, piece }) => (
        <img
          key={`premove-${sq}`}
          className="chess-piece chess-preview premoved"
          src={pieceSrc(piece)}
          alt=""
          draggable={false}
          style={{ left: `${cell(sq).col * 12.5}%`, top: `${cell(sq).row * 12.5}%` }}
          data-testid="chess-premove-piece"
        />
      ))}
      {ghost && (
        <img
          key={ghost.key}
          className="chess-piece chess-ghost"
          src={pieceSrc(ghost.piece)}
          alt=""
          draggable={false}
          style={{ left: `${cell(ghost.sq).col * 12.5}%`, top: `${cell(ghost.sq).row * 12.5}%` }}
          onAnimationEnd={() => setGhost(null)}
        />
      )}
      {promoting && (
        <Promotion
          color={mover ?? pos.turn}
          col={cell(promoting.to).col}
          fromTop={cell(promoting.to).row === 0}
          onPick={(promotion) => {
            setPromoting(null);
            done(toUci({ ...promoting, promotion }), false);
          }}
          onCancel={() => setPromoting(null)}
        />
      )}
      {props.children}
    </div>
  );
}

/** Which piece a pawn becomes: four choices down (or up) the file it lands on. */
function Promotion(props: { color: Color; col: number; fromTop: boolean; onPick(p: Promotion): void; onCancel(): void }) {
  return (
    <div className="chess-promo-backdrop" onPointerDown={(e) => (e.stopPropagation(), props.onCancel())}>
      <div
        className="chess-promo"
        role="dialog"
        aria-label="Promote to"
        style={{ left: `${props.col * 12.5}%`, ...(props.fromTop ? { top: 0 } : { bottom: 0 }), flexDirection: props.fromTop ? "column" : "column-reverse" }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        {PICKS.map((p) => {
          const piece = (props.color === "w" ? p.toUpperCase() : p) as Piece;
          return (
            <button key={p} type="button" className="chess-promo-pick" onClick={() => props.onPick(p)} aria-label={`Promote to a ${PIECE_NAMES[p]}`} data-testid={`chess-promote-${p}`}>
              <img src={pieceSrc(piece)} alt="" draggable={false} />
            </button>
          );
        })}
      </div>
    </div>
  );
}
