import { type CSSProperties, type KeyboardEvent, memo, type ReactNode, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { reducedMotion } from "../../kit/ui/Flights";
import { play, playerStyle } from "../../../ui";
import { COLUMNS, count, type Piece, squareName } from "../rules";
import { circlePath, crossPaths, framePath, loopPath, markSeed } from "./ink";

/** Blank paper around the playing area, in squares: room for the row numbers and the red margin on the left, the letters on top. */
const LEFT = 2;
const TOP = 1.15;
const RIGHT = 0.75;
const BOTTOM = 0.75;
/** Where the red margin line runs, in squares from the playing area's left edge. */
const MARGIN = -1.3;

/** The sheet's shape (width over height) for an `n` × `n` game. */
export const sheetRatio = (n: number) => (n + LEFT + RIGHT) / (n + TOP + BOTTOM);

/**
 * The sheet of squared paper. Marks are drawn in ink in their players' colors; a new one is
 * drawn stroke by stroke (live moves only), with the soft scratch of a pen. On your move,
 * pointing at a square shows a faint pencil mark there; click to ink it. On a touch screen
 * it takes two taps (the first pencils it in, the same square again inks it), since the
 * squares are small. The arrow keys move a dotted cursor, and Enter or Space marks. The
 * last mark gets a stroke of highlighter; the winner rings a winning five with a loop.
 */
export function Sheet(props: {
  n: number;
  board: string;
  /** Which game this is (a new one doesn't animate, and the marks look different every game). */
  game: number;
  /** The cells marked, in order (for each mark's seed). */
  order: number[];
  /** The last mark, or null. */
  last: number | null;
  /** The winning runs, [first, last] cells, once the game is over. */
  runs: [number, number][];
  /** The winner's piece (whose ink rings the five). */
  winner: Piece | null;
  /** Palette colors for each side's ink. */
  colors: { x: number; o: number };
  /** The piece you can mark now, or null. */
  movable: Piece | null;
  onMark(square: string): void;
  /** Overlays (a prompt to sit down). */
  children?: ReactNode;
}) {
  const { n, board, movable } = props;
  const W = n + LEFT + RIGHT;
  const H = n + TOP + BOTTOM;
  const svg = useRef<SVGSVGElement>(null);
  const ink = `lfs-ink-${useId().replace(/:/g, "")}`;
  const [hover, setHover] = useState<number | null>(null);
  /** On touch, the square tapped once: a second tap there marks it. */
  const [picked, setPicked] = useState<number | null>(null);
  const [cursor, setCursor] = useState<number | null>(null);
  const pointer = useRef("mouse");

  useEffect(() => {
    setPicked(null);
    setHover(null);
  }, [board, movable]);

  // Each mark's seed: the move it was, so a mark looks the same whenever it's drawn.
  const moveOf = useMemo(() => new Map(props.order.map((cell, i) => [cell, i])), [props.order]);

  // A mark that just went on (one more than before, same game) is drawn stroke by stroke.
  const placed = board.length - count(board).empty;
  const seen = useRef<{ game: number; placed: number } | undefined>(undefined);
  const [fresh, setFresh] = useState<number | null>(null);
  useLayoutEffect(() => {
    const before = seen.current;
    seen.current = { game: props.game, placed };
    if (!before || props.last === null || before.game !== props.game || placed !== before.placed + 1) return setFresh(null);
    setFresh(props.last);
    // A cross is two strokes; a circle one loop, heard as two halves.
    play("pen");
    play("pen", board[props.last] === "x" ? 0.29 : 0.2);
  }, [props.game, placed]);
  // The loop round a winning line, once, when a five is made while you watch.
  const [freshRuns, setFreshRuns] = useState(false);
  const hadRuns = useRef(props.runs.length > 0);
  useEffect(() => {
    const had = hadRuns.current;
    hadRuns.current = props.runs.length > 0;
    if (!had && props.runs.length) {
      setFreshRuns(true);
      // One loop, heard as two halves.
      play("pen", 0.45);
      play("pen", 0.85);
    } else if (!props.runs.length) setFreshRuns(false);
  }, [props.runs.length]);

  const cellAt = (e: { clientX: number; clientY: number }): number | null => {
    const box = svg.current?.getBoundingClientRect();
    if (!box) return null;
    const x = Math.floor(((e.clientX - box.left) / box.width) * W - LEFT);
    const y = Math.floor(((e.clientY - box.top) / box.height) * H - TOP);
    return x >= 0 && x < n && y >= 0 && y < n ? y * n + x : null;
  };
  const open = (cell: number | null): cell is number => cell !== null && board[cell] === ".";

  const click = (cell: number | null) => {
    if (!movable || !open(cell)) return;
    if (pointer.current !== "mouse" && picked !== cell) return setPicked(cell);
    setPicked(null);
    setCursor(null);
    props.onMark(squareName(n, cell));
  };

  const key = (e: KeyboardEvent) => {
    if (!movable) return;
    const mid = Math.floor(n / 2) * n + Math.floor(n / 2);
    const from = cursor ?? props.last ?? mid;
    const [r, c] = [Math.floor(from / n), from % n];
    const move: Record<string, [number, number]> = { ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [-1, 0], ArrowDown: [1, 0] };
    if (move[e.key]) {
      e.preventDefault();
      const [dr, dc] = move[e.key]!;
      setHover(null);
      setCursor(Math.min(n - 1, Math.max(0, r + dr)) * n + Math.min(n - 1, Math.max(0, c + dc)));
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (cursor === null) setCursor(from);
      else if (open(cursor)) {
        props.onMark(squareName(n, cursor));
        setCursor(null);
      }
    }
  };

  const ghostAt = movable ? (picked ?? hover ?? cursor) : null;
  const ghost = ghostAt !== null && open(ghostAt) ? ghostAt : null;
  const nextSeed = markSeed(props.game, placed, ghost ?? 0);

  const view = `${-LEFT * 100} ${-TOP * 100} ${W * 100} ${H * 100}`;
  return (
    <div
      className={`lfs-sheet ${movable ? "movable" : ""}`}
      style={{ "--ratio": W / H } as CSSProperties}
      role="grid"
      aria-label={`Luffarschack sheet, ${n} by ${n} squares${movable ? ". Arrow keys move, Enter marks a square" : ""}`}
      tabIndex={movable ? 0 : -1}
      onKeyDown={key}
      onBlur={() => setCursor(null)}
      data-testid="lfs-sheet"
    >
      <svg
        ref={svg}
        className="lfs-svg"
        viewBox={view}
        onPointerDown={(e) => (pointer.current = e.pointerType)}
        onPointerMove={(e) => {
          if (e.pointerType !== "mouse") return;
          const cell = cellAt(e);
          setHover((h) => (h === cell ? h : cell));
        }}
        onPointerLeave={() => setHover(null)}
        onClick={(e) => click(cellAt(e))}
      >
        <Ink id={ink} />
        <Paper n={n} game={props.game} />
        {props.last !== null && !props.runs.length && (
          <rect className="lfs-last" x={(props.last % n) * 100 + 6} y={Math.floor(props.last / n) * 100 + 10} width={88} height={80} rx={14} transform={`rotate(-4 ${(props.last % n) * 100 + 50} ${Math.floor(props.last / n) * 100 + 50})`} />
        )}
        {cursor !== null && movable && <rect className="lfs-cursor" x={(cursor % n) * 100 + 7} y={Math.floor(cursor / n) * 100 + 7} width={86} height={86} rx={6} />}
        <g className="lfs-marks" filter={`url(#${ink})`}>
          {[...board].map((p, cell) =>
            p === "x" || p === "o" ? (
              <Mark key={`${props.game}-${cell}`} piece={p} cell={cell} n={n} seed={markSeed(props.game, moveOf.get(cell) ?? 0, cell)} color={props.colors[p]} fresh={cell === fresh} last={cell === props.last} />
            ) : null,
          )}
        </g>
        {ghost !== null && movable && (
          <g className={`lfs-ghost ${picked === ghost ? "picked" : ""}`} transform={`translate(${(ghost % n) * 100} ${Math.floor(ghost / n) * 100})`} aria-hidden>
            {movable === "x" ? crossPaths(nextSeed).map((d, i) => <path key={i} d={d} />) : <path d={circlePath(nextSeed)} />}
          </g>
        )}
        {props.runs.length > 0 && props.winner && (
          <g className={`lfs-ring ${freshRuns ? "fresh" : ""}`} style={playerStyle(props.colors[props.winner])} filter={`url(#${ink})`}>
            {props.runs.map(([a, b]) => (
              <path key={`${a}-${b}`} className="lfs-loop" d={loopPath(markSeed(props.game, 998, a * 7 + b), centre(n, a), centre(n, b))} pathLength={1} data-testid="lfs-loop" />
            ))}
          </g>
        )}
      </svg>
      {props.children}
    </div>
  );
}

/**
 * Ink on paper: the pen's line wavers a little at its edges and doesn't lay down evenly
 * (a ballpoint skips and pools). Works in the sheet's units, 100 to a square.
 */
function Ink({ id }: { id: string }) {
  return (
    <defs>
      <filter id={id} x="-2%" y="-2%" width="104%" height="104%">
        <feTurbulence type="fractalNoise" baseFrequency="0.045" numOctaves={2} seed={4} result="warp" />
        <feDisplacementMap in="SourceGraphic" in2="warp" scale={4.5} xChannelSelector="R" yChannelSelector="G" result="line" />
        <feTurbulence type="fractalNoise" baseFrequency="0.32" numOctaves={1} seed={11} result="grain" />
        <feColorMatrix in="grain" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -1.3 1.6" result="density" />
        <feComposite in="line" in2="density" operator="in" />
      </filter>
    </defs>
  );
}

const centre = (n: number, cell: number): [number, number] => [(cell % n) * 100 + 50, Math.floor(cell / n) * 100 + 50];

/**
 * The paper itself, which never changes during a game: grid lines over the whole sheet (as
 * on real squared paper), the red margin, the letters and numbers in pencil, and a pencil
 * frame around the playing area.
 */
const Paper = memo(function Paper({ n, game }: { n: number; game: number }) {
  const [x0, x1, y0, y1] = [-LEFT * 100, (n + RIGHT) * 100, -TOP * 100, (n + BOTTOM) * 100];
  const lines: ReactNode[] = [];
  for (let x = Math.ceil(-LEFT); x <= n + RIGHT; x++) lines.push(<line key={`v${x}`} x1={x * 100} x2={x * 100} y1={y0} y2={y1} />);
  for (let y = Math.ceil(-TOP); y <= n + BOTTOM; y++) lines.push(<line key={`h${y}`} y1={y * 100} y2={y * 100} x1={x0} x2={x1} />);
  return (
    <g aria-hidden>
      <g className="lfs-rules">{lines}</g>
      <line className="lfs-margin" x1={MARGIN * 100} x2={MARGIN * 100} y1={y0} y2={y1} />
      <path className="lfs-frame" d={framePath(game * 31 + n, n)} />
      <g className="lfs-coords">
        {Array.from({ length: n }, (_, i) => (
          <text key={`c${i}`} x={i * 100 + 50} y={-38} textAnchor="middle">
            {COLUMNS[i]}
          </text>
        ))}
        {Array.from({ length: n }, (_, i) => (
          <text key={`r${i}`} x={-28} y={i * 100 + 50} textAnchor="end" dominantBaseline="central">
            {i + 1}
          </text>
        ))}
      </g>
    </g>
  );
});

/** One inked mark, drawn by hand from its seed. */
const Mark = memo(function Mark({ piece, cell, n, seed, color, fresh, last }: { piece: Piece; cell: number; n: number; seed: number; color: number; fresh: boolean; last: boolean }) {
  const paths = useMemo(() => (piece === "x" ? crossPaths(seed) : [circlePath(seed)]), [piece, seed]);
  return (
    <g
      className={`lfs-mark ${piece} ${fresh && !reducedMotion() ? "fresh" : ""} ${last ? "last" : ""}`}
      style={playerStyle(color)}
      transform={`translate(${(cell % n) * 100} ${Math.floor(cell / n) * 100})`}
      data-testid={`lfs-mark-${squareName(n, cell)}`}
      data-piece={piece}
    >
      {paths.map((d, i) => (
        <path key={i} d={d} pathLength={1} />
      ))}
    </g>
  );
});
