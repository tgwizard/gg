import { type CSSProperties, type KeyboardEvent, type ReactNode, useLayoutEffect, useMemo, useRef, useState } from "react";
import { reducedMotion } from "../../kit/ui/Flights";
import { Button, play, playerStyle } from "../../../ui";
import { colOf, count, landing, type Piece, rowOf, type Size } from "../rules";

/** The wooden frame around the holes, and the gap over it where your disc waits, in cells. */
const FRAME = 0.3;
const GAP = 0.14;
/** Holes and discs, as a share of a cell's width (a disc is a little bigger than its hole: the board hides its edge). */
const HOLE = 0.39;

/**
 * The board, upright. On your move, pointing at a column (or moving along with the
 * arrow keys) holds your disc over it and marks where it would land; click, tap, Enter
 * or Space drops it. A new disc falls in behind the front of the board with a little
 * bounce. At the end, the winning four are joined by a line.
 */
export function Board(props: {
  size: Size;
  board: string;
  /** Which game this is (a new one doesn't animate). */
  game: number;
  /** The last disc dropped. */
  last: number | null;
  /** The winning discs, once the game is over. */
  line: number[];
  /** Palette colors for each side's discs. */
  colors: { x: number; o: number };
  /** The piece you can drop now, or null. */
  movable: Piece | null;
  /** Why you can't drop a disc now (when `movable` is null): "It's Bob's turn." */
  why: string | null;
  onDrop(column: number): void;
  /** Overlays (a prompt to sit down). */
  children?: ReactNode;
}) {
  const { size, board } = props;
  const W = size.columns;
  const H = size.rows;
  const ref = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [cursor, setCursor] = useState<number | null>(null);
  const aim = props.movable ? (hover ?? cursor) : null;
  const target = aim === null ? null : landing(board, size, aim);

  // Where things go, as percentages of the board (frame included).
  const across = W + 2 * FRAME;
  const down = H + 2 * FRAME;
  const box = (cell: number): CSSProperties => ({
    left: `${((FRAME + colOf(size, cell)) / across) * 100}%`,
    top: `${((FRAME + rowOf(size, cell)) / down) * 100}%`,
    width: `${100 / across}%`,
    height: `${100 / down}%`,
  });
  const colLeft = (c: number) => `${((FRAME + c) / across) * 100}%`;

  // A disc that just went in (one more than before, same game): it falls from over the board and bounces.
  const placed = board.length - count(board).empty;
  const seen = useRef<{ game: number; placed: number } | undefined>(undefined);
  useLayoutEffect(() => {
    const before = seen.current;
    seen.current = { game: props.game, placed };
    const at = props.last;
    if (!before || at === null || before.game !== props.game || placed !== before.placed + 1) return;
    setHover(null);
    // From the waiting spot over the column down to its cell, in cells: falling time grows with the root of the distance.
    const drop = rowOf(size, at) + FRAME + GAP + 1;
    const fall = 95 * Math.sqrt(drop);
    play("drop", reducedMotion() ? 0 : fall / 1000);
    if (reducedMotion()) return;
    const el = ref.current?.querySelector<HTMLElement>(`[data-cell="${at}"]`);
    el?.animate(
      [
        { transform: `translateY(${-drop * 100}%)`, easing: "cubic-bezier(.45,0,.9,.55)" },
        { transform: "translateY(0)", offset: 0.72, easing: "cubic-bezier(.2,.7,.4,1)" },
        { transform: "translateY(-11%)", offset: 0.86, easing: "cubic-bezier(.6,0,.8,.4)" },
        { transform: "translateY(0)" },
      ],
      { duration: fall / 0.72 },
    );
  }, [props.game, placed]);

  // The winning line(s): each run of four or more in one direction through the last disc.
  const runs = useMemo(() => winningRuns(size, props.line, props.last), [size, props.line, props.last]);

  const key = (e: KeyboardEvent) => {
    if (!props.movable) return;
    const from = aim ?? Math.floor((W - 1) / 2);
    const digit = Number(e.key);
    let next: number | null = null;
    if (e.key === "ArrowLeft") next = Math.max(0, from - 1);
    else if (e.key === "ArrowRight") next = Math.min(W - 1, from + 1);
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = W - 1;
    else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (landing(board, size, from) !== null) props.onDrop(from + 1);
      setCursor(from);
      return;
    } else if (Number.isInteger(digit) && digit >= 1 && digit <= W) {
      setCursor(digit - 1);
      if (landing(board, size, digit - 1) !== null) props.onDrop(digit);
      return;
    } else return;
    e.preventDefault();
    setHover(null);
    setCursor(next);
  };

  const pieces = [];
  for (let cell = 0; cell < board.length; cell++) {
    const p = board[cell];
    if (p !== "x" && p !== "o") continue;
    const won = props.line.includes(cell);
    pieces.push(
      <div key={cell} className="fiar-slot" style={box(cell)} data-cell={cell}>
        <div
          className={`fiar-disc ${won ? "won" : ""} ${props.line.length && !won ? "faded" : ""}`}
          style={playerStyle(props.colors[p])}
          data-testid={`fiar-disc-${colOf(size, cell) + 1}-${H - rowOf(size, cell)}`}
          data-piece={p}
        >
          {cell === props.last && !props.line.length && <i className="fiar-last-mark" />}
        </div>
      </div>,
    );
  }

  return (
    <div
      ref={ref}
      className={`fiar-stage ${props.movable ? "movable" : ""}`}
      style={{ "--cols": W, "--rows": H, "--frame": FRAME, "--gap": GAP } as CSSProperties}
      role="grid"
      aria-label={`Four in a Row board, ${W} columns${props.movable ? ". Arrow keys pick a column, Enter drops your disc" : ""}`}
      tabIndex={props.movable ? 0 : -1}
      onKeyDown={key}
      onBlur={() => setCursor(null)}
      data-testid="fiar-board"
    >
      {/* Your disc, waiting over the column you're pointing at. */}
      <div className="fiar-waiting" aria-hidden>
        {aim !== null && props.movable && (
          <div className={`fiar-slot fiar-ghost ${target === null ? "blocked" : ""}`} style={{ left: colLeft(aim), width: `${100 / across}%` }}>
            <div className="fiar-disc" style={playerStyle(props.colors[props.movable])} />
          </div>
        )}
      </div>
      <div className="fiar-board">
        <div className="fiar-back" style={{ inset: `${(FRAME / down) * 100}% ${(FRAME / across) * 100}%` }} />
        {target !== null && props.movable && (
          <div className="fiar-slot fiar-landing" style={box(target)} aria-hidden>
            <div className="fiar-disc" style={playerStyle(props.colors[props.movable])} />
          </div>
        )}
        {pieces}
        <Front size={size} />
        {runs.length > 0 && (
          <svg className="fiar-line" viewBox={`0 0 ${across * 100} ${down * 100}`} aria-hidden>
            {runs.map(([a, b]) => {
              const [x1, y1, x2, y2] = [centerX(size, a), centerY(size, a), centerX(size, b), centerY(size, b)];
              return <line key={`${a}-${b}`} x1={x1} y1={y1} x2={x2} y2={y2} pathLength={1} />;
            })}
          </svg>
        )}
        {Array.from({ length: W }, (_, c) => (
          <span key={c} className="fiar-coord" style={{ left: `${((FRAME + c + 0.5) / across) * 100}%` }} aria-hidden>
            {c + 1}
          </span>
        ))}
      </div>
      {/* Each column, top to bottom, is one button. */}
      <div className="fiar-columns">
        {Array.from({ length: W }, (_, c) => {
          const open = landing(board, size, c) !== null;
          return (
            <Button
              key={c}
              type="button"
              tabIndex={-1}
              className={`fiar-column ${aim === c ? "aimed" : ""}`}
              style={{ left: colLeft(c), width: `${100 / across}%` }}
              aria-label={`Column ${c + 1}${open ? "" : ", full"}`}
              why={!props.movable ? (props.why ?? "You can't drop a disc right now.") : open ? null : "That column is full."}
              data-testid={`fiar-col-${c + 1}`}
              onPointerEnter={(e) => e.pointerType === "mouse" && setHover(c)}
              onPointerLeave={() => setHover((h) => (h === c ? null : h))}
              onClick={() => {
                if (!props.movable || !open) return;
                setCursor(null);
                props.onDrop(c + 1);
              }}
            />
          );
        })}
      </div>
      {props.children}
    </div>
  );
}

/** The front of the board: wood with a hole for every cell, each with a shadowed rim. */
function Front({ size }: { size: Size }) {
  const across = (size.columns + 2 * FRAME) * 100;
  const down = (size.rows + 2 * FRAME) * 100;
  const r = HOLE * 100;
  const R = 22;
  const outline = `M${R} 0H${across - R}a${R} ${R} 0 0 1 ${R} ${R}V${down - R}a${R} ${R} 0 0 1 ${-R} ${R}H${R}a${R} ${R} 0 0 1 ${-R} ${-R}V${R}a${R} ${R} 0 0 1 ${R} ${-R}Z`;
  const holes: string[] = [];
  const rims = [];
  const bevels = [];
  for (let cell = 0; cell < size.columns * size.rows; cell++) {
    const [x, y] = [centerX(size, cell), centerY(size, cell)];
    holes.push(`M${x - r} ${y}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0Z`);
    rims.push(<circle key={cell} cx={x} cy={y} r={r} />);
    bevels.push(<circle key={cell} cx={x} cy={y + 2.5} r={r + 2} />);
  }
  const shape = `${outline} ${holes.join("")}`;
  return (
    <svg className="fiar-front" viewBox={`0 0 ${across} ${down}`} aria-hidden>
      <defs>
        <linearGradient id="fiar-wood" x1="0" y1="0" x2="0.25" y2="1">
          <stop offset="0" className="fiar-wood-1" />
          <stop offset="1" className="fiar-wood-2" />
        </linearGradient>
        <pattern id="fiar-grain" width="140" height="22" patternUnits="userSpaceOnUse" patternTransform="rotate(-8)">
          <path d="M0 6 Q35 2 70 7 T140 6" className="fiar-grain" />
          <path d="M0 16 Q45 19 90 14 T140 17" className="fiar-grain soft" />
        </pattern>
      </defs>
      <path d={shape} fillRule="evenodd" fill="url(#fiar-wood)" />
      <path d={shape} fillRule="evenodd" fill="url(#fiar-grain)" />
      <g className="fiar-rims-light">{bevels}</g>
      <g className="fiar-rims">{rims}</g>
      <path d={outline} className="fiar-edge" />
    </svg>
  );
}

const centerX = (size: Size, cell: number) => (FRAME + colOf(size, cell) + 0.5) * 100;
const centerY = (size: Size, cell: number) => (FRAME + rowOf(size, cell) + 0.5) * 100;

/** The ends of each run of four or more of `line` through `last` (a disc can finish two lines at once). */
function winningRuns(size: Size, line: number[], last: number | null): [number, number][] {
  if (!line.length || last === null) return [];
  const on = new Set(line);
  const runs: [number, number][] = [];
  for (const [dr, dc] of [
    [0, 1],
    [1, 0],
    [1, 1],
    [1, -1],
  ] as const) {
    const ends = [last, last];
    for (const [i, sign] of [
      [0, -1],
      [1, 1],
    ] as const) {
      let [r, c] = [rowOf(size, ends[i]!), colOf(size, ends[i]!)];
      while (true) {
        const [nr, nc] = [r + dr * sign, c + dc * sign];
        if (nr < 0 || nr >= size.rows || nc < 0 || nc >= size.columns || !on.has(nr * size.columns + nc)) break;
        [r, c] = [nr, nc];
      }
      ends[i] = r * size.columns + c;
    }
    const length = Math.max(Math.abs(rowOf(size, ends[0]!) - rowOf(size, ends[1]!)), Math.abs(colOf(size, ends[0]!) - colOf(size, ends[1]!))) + 1;
    if (length >= 4) runs.push([ends[0]!, ends[1]!]);
  }
  return runs;
}
