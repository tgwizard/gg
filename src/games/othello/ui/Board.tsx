import { type ReactNode, useLayoutEffect, useMemo, useRef, useState } from "react";
import { reducedMotion } from "../../kit/ui/Flights";
import { play } from "../../../ui";
import type { LastMove } from "../engine";
import { type Color, colOf, count, FILES, flipsFor, legalMoves, parseSquare, rowOf, squareName } from "../rules";

const COLOR_NAME = { b: "black", w: "white" } as const;
/** The four small dots on a real board, where the lines around the middle 4×4 cross. */
const STARS = [
  [25, 25],
  [75, 25],
  [25, 75],
  [75, 75],
];

/**
 * The board. On your move the squares you can play are marked, and pointing at one
 * shows your disc there and marks the discs it would turn over; click to play. A new
 * disc drops in and the discs it traps flip over one after another, outward from it.
 */
export function Board(props: {
  board: string;
  /** Which game this is (a new one doesn't animate). */
  game: number;
  lastMove: LastMove | null;
  /** The color you can play now, or null. */
  movable: Color | null;
  onMove(square: string): void;
  /** Overlays (a prompt to sit down). */
  children?: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const legal = useMemo(() => new Set(props.movable ? legalMoves(props.board, props.movable) : []), [props.board, props.movable]);
  const [hover, setHover] = useState<number | null>(null);
  const preview = useMemo(
    () => new Set(hover !== null && props.movable && legal.has(hover) ? flipsFor(props.board, props.movable, hover) : []),
    [hover, legal, props.board, props.movable],
  );
  const lastAt = props.lastMove ? parseSquare(props.lastMove.square) : null;

  // A move that just happened (one disc more than before, same game): drop the disc in and flip the rest.
  const placed = 64 - count(props.board).empty;
  const seen = useRef<{ game: number; placed: number } | undefined>(undefined);
  useLayoutEffect(() => {
    const before = seen.current;
    seen.current = { game: props.game, placed };
    const last = props.lastMove;
    if (!before || !last || before.game !== props.game || placed !== before.placed + 1) return;
    setHover(null);
    play("place");
    if (last.flipped.length) play("flip", 0.16);
    if (reducedMotion()) return;
    const at = parseSquare(last.square)!;
    const disc = (sq: number) => ref.current?.querySelector<HTMLElement>(`[data-disc="${sq}"]`);
    disc(at)?.animate([{ transform: "translateY(-30%) scale(1.3)", opacity: 0 }, { transform: "none", opacity: 1 }], { duration: 220, easing: "cubic-bezier(.3,.7,.4,1)" });
    // White shows the disc's back (turned 180°); both turn the same way.
    const [from, mid, to] = last.by === "w" ? [0, 90, 180] : [180, 270, 360];
    for (const name of last.flipped) {
      const sq = parseSquare(name)!;
      const steps = Math.max(Math.abs(rowOf(sq) - rowOf(at)), Math.abs(colOf(sq) - colOf(at)));
      disc(sq)
        ?.querySelector(".oth-disc-inner")
        ?.animate(
          [
            { transform: `rotateY(${from}deg) scale(1)` },
            { transform: `rotateY(${mid}deg) scale(1.18)` },
            { transform: `rotateY(${to}deg) scale(1)` },
          ],
          { duration: 380, delay: 140 + (steps - 1) * 90, easing: "ease-in-out", fill: "backwards" },
        );
    }
  }, [props.game, placed]);

  const cells = [];
  for (let sq = 0; sq < 64; sq++) {
    const cell = props.board[sq] as Color | ".";
    const canPlay = legal.has(sq);
    const name = squareName(sq);
    cells.push(
      <div
        key={sq}
        className={`oth-sq ${canPlay ? "legal" : ""} ${preview.has(sq) ? "will-flip" : ""}`}
        role="gridcell"
        aria-label={`${name}, ${cell === "." ? (canPlay ? "you can play here" : "empty") : COLOR_NAME[cell]}`}
        data-testid={`othello-sq-${name}`}
        data-square={name}
        onPointerEnter={(e) => e.pointerType === "mouse" && setHover(sq)}
        onPointerLeave={() => setHover((h) => (h === sq ? null : h))}
        onClick={() => canPlay && props.onMove(name)}
      >
        {cell !== "." && (
          <div className={`oth-disc ${cell}`} data-disc={sq} data-testid={`othello-disc-${name}`} data-color={cell}>
            <div className="oth-disc-inner">
              <i className="oth-face b" />
              <i className="oth-face w" />
            </div>
            {preview.has(sq) && <i className={`oth-becomes ${props.movable}`} />}
            {sq === lastAt && <i className="oth-last-mark" />}
          </div>
        )}
        {canPlay && (hover === sq ? <div className={`oth-disc oth-ghost ${props.movable}`} /> : <i className={`oth-hint ${props.movable}`} />)}
      </div>,
    );
  }

  return (
    <div ref={ref} className={`oth-board ${legal.size ? "movable" : ""}`} role="grid" aria-label="Othello board" data-testid="othello-board">
      {cells}
      {Array.from(FILES, (f, i) => (
        <span key={f} className="oth-coord file" style={{ left: `${(i + 0.5) * 12.5}%` }} aria-hidden>
          {f}
        </span>
      ))}
      {Array.from({ length: 8 }, (_, i) => (
        <span key={i} className="oth-coord rank" style={{ top: `${(i + 0.5) * 12.5}%` }} aria-hidden>
          {i + 1}
        </span>
      ))}
      {STARS.map(([x, y]) => (
        <i key={`${x}-${y}`} className="oth-star" style={{ left: `${x}%`, top: `${y}%` }} />
      ))}
      {props.children}
    </div>
  );
}
