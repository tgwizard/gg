import { type ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { reducedMotion } from "../../kit/ui/Flights";
import { play } from "../../../ui";
import type { LastMove } from "../engine";
import { type Color, COLUMNS, other, parsePoint, pointName, starPoints, tryPlay } from "../rules";

const COLOR_NAME = { b: "black", w: "white" } as const;

/** While counting: the stones marked dead, and whose each point counts as ("b", "w" or "."). */
export interface Counting {
  dead: Set<number>;
  owner: string;
}

/**
 * The board. On your move, pointing at a point shows your stone there; click to play.
 * On a touch screen a big board takes two taps (one to put the stone down lightly, the
 * same again to play it), since the points are small. A new stone drops in with a
 * clack, and the stones it captured lift off. While counting, the territory is marked
 * and clicking a group marks it dead or alive.
 */
export function Board(props: {
  size: number;
  board: string;
  /** Which game this is (a new one doesn't animate). */
  game: number;
  /** Stones played so far, to tell a new move from a refresh. */
  played: number;
  lastMove: LastMove | null;
  /** The color you can play now, or null. */
  movable: Color | null;
  /** Points the side to move can't play because of ko. */
  ko: string[];
  onPlay(point: string): void;
  counting: Counting | null;
  /** While counting, if you're playing: mark the group on a point. */
  onMark: ((point: string) => void) | null;
  /** Overlays (a prompt to sit down). */
  children?: ReactNode;
}) {
  const { size, board, movable } = props;
  const ref = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  /** On touch, the point tapped once: a second tap there plays it. */
  const [picked, setPicked] = useState<number | null>(null);
  const pointer = useRef<string>("mouse");
  const ko = useMemo(() => new Set(props.ko.map((n) => parsePoint(n, size))), [props.ko, size]);
  const canPlay = (p: number) => !!movable && board[p] === "." && !ko.has(p) && !("illegal" in tryPlay(board, movable, p));
  const lastAt = props.lastMove ? parsePoint(props.lastMove.point, size) : null;
  const stars = useMemo(() => new Set(starPoints(size)), [size]);
  const twoTaps = size > 9;

  useEffect(() => {
    setPicked(null);
    setHover(null);
  }, [board, movable]);

  // A move that just happened (one stone more than before, same game): drop it in and lift off what it took.
  const [leaving, setLeaving] = useState<{ key: number; color: Color; points: number[] } | null>(null);
  const seen = useRef<{ game: number; played: number } | undefined>(undefined);
  useLayoutEffect(() => {
    const before = seen.current;
    seen.current = { game: props.game, played: props.played };
    const last = props.lastMove;
    if (!before || !last || before.game !== props.game || props.played !== before.played + 1) return;
    play("stone");
    if (last.captured.length) play("capture", 0.12);
    if (reducedMotion()) return;
    const at = parsePoint(last.point, size)!;
    ref.current
      ?.querySelector(`[data-stone="${at}"]`)
      ?.animate([{ transform: "translateY(-18%) scale(1.25)", opacity: 0.2 }, { transform: "none", opacity: 1 }], { duration: 200, easing: "cubic-bezier(.3,.7,.4,1)" });
    if (last.captured.length) setLeaving({ key: props.played, color: other(last.by), points: last.captured.map((n) => parsePoint(n, size)!) });
  }, [props.game, props.played]);
  useEffect(() => {
    if (!leaving) return;
    const t = setTimeout(() => setLeaving((l) => (l === leaving ? null : l)), 1000);
    return () => clearTimeout(t);
  }, [leaving]);

  const click = (p: number) => {
    const name = pointName(p, size);
    if (props.onMark) {
      if (board[p] !== ".") props.onMark(name);
      return;
    }
    if (!canPlay(p)) return;
    if (twoTaps && pointer.current !== "mouse" && picked !== p) return setPicked(p);
    setPicked(null);
    props.onPlay(name);
  };

  const ghostAt = picked ?? hover;
  const cells = [];
  for (let p = 0; p < size * size; p++) {
    const cell = board[p] as Color | ".";
    const dead = props.counting?.dead.has(p) ?? false;
    const owner = props.counting?.owner[p];
    const name = pointName(p, size);
    const territory = owner && owner !== "." && (cell === "." || dead) ? owner : null;
    cells.push(
      <div
        key={p}
        className={`go-pt ${props.onMark && cell !== "." ? "markable" : ""} ${movable && cell === "." && !ko.has(p) ? "open" : ""}`}
        role="gridcell"
        aria-label={`${name}, ${cell === "." ? "empty" : `${COLOR_NAME[cell]} stone`}${dead ? ", marked dead" : ""}${ko.has(p) ? ", ko: can't take back yet" : ""}`}
        data-testid={`go-pt-${name}`}
        data-point={name}
        onPointerDown={(e) => (pointer.current = e.pointerType)}
        onPointerEnter={(e) => e.pointerType === "mouse" && setHover(p)}
        onPointerLeave={() => setHover((h) => (h === p ? null : h))}
        onClick={() => click(p)}
      >
        {cell !== "." && (
          <div className={`go-stone ${cell} ${dead ? "dead" : ""}`} data-stone={p} data-testid={`go-stone-${name}`} data-color={cell}>
            {p === lastAt && !props.counting && <i className="go-last" />}
          </div>
        )}
        {territory && <i className={`go-terr ${territory}`} />}
        {cell === "." && ko.has(p) && <i className="go-ko" />}
        {cell === "." && ghostAt === p && movable && canPlay(p) && <div className={`go-stone ghost ${movable} ${picked === p ? "picked" : ""}`} />}
      </div>,
    );
  }

  return (
    <div className={`go-board size-${size}`} ref={ref} style={{ "--n": size } as React.CSSProperties}>
      <svg className="go-lines" viewBox={`0 0 ${size} ${size}`} preserveAspectRatio="none" aria-hidden>
        {Array.from({ length: size }, (_, i) => (
          <g key={i} className={i === 0 || i === size - 1 ? "edge" : ""}>
            <line x1={0.5} x2={size - 0.5} y1={i + 0.5} y2={i + 0.5} vectorEffect="non-scaling-stroke" />
            <line y1={0.5} y2={size - 0.5} x1={i + 0.5} x2={i + 0.5} vectorEffect="non-scaling-stroke" />
          </g>
        ))}
      </svg>
      {[...stars].map((p) => (
        <i key={p} className="go-star" style={{ left: `${((p % size) + 0.5) * (100 / size)}%`, top: `${(Math.floor(p / size) + 0.5) * (100 / size)}%` }} />
      ))}
      <div className="go-grid" role="grid" aria-label="Go board" data-testid="go-board">
        {cells}
      </div>
      {leaving && (
        <div className="go-leaving" key={leaving.key} aria-hidden>
          {leaving.points.map((p, i) => (
            <div key={p} className="go-leave-at" style={{ left: `${(p % size) * (100 / size)}%`, top: `${Math.floor(p / size) * (100 / size)}%` }}>
              <div className={`go-stone ${leaving.color} lifting`} style={{ animationDelay: `${120 + i * 45}ms` }} />
            </div>
          ))}
        </div>
      )}
      {Array.from({ length: size }, (_, i) => (
        <span key={`c${i}`} className="go-coord col" style={{ left: `${(i + 0.5) * (100 / size)}%` }} aria-hidden>
          {COLUMNS[i]}
        </span>
      ))}
      {Array.from({ length: size }, (_, i) => (
        <span key={`r${i}`} className="go-coord row" style={{ top: `${(i + 0.5) * (100 / size)}%` }} aria-hidden>
          {size - i}
        </span>
      ))}
      {props.children}
    </div>
  );
}
