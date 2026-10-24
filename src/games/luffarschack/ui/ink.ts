/**
 * Hand-drawn marks: every cross, circle and winning loop is drawn a little differently,
 * like a pen on paper, but the same every time it's drawn (each comes from a seed made from
 * the game, the move and the square), so nothing wobbles between renders or refreshes.
 *
 * Shapes are SVG path data in a square's own units: 0–100 across and down, the middle at 50.
 * A cross is two strokes (top left to bottom right, then top right to bottom left, the way
 * most people draw one); a circle is one loop, started near the top and drawn anticlockwise,
 * that doesn't quite close where it began (it runs on a little past, or stops a touch short).
 */

/** A small fast seeded random generator (mulberry32): numbers in [0, 1). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A seed for one mark: the game, which move it was, and where. */
export const markSeed = (game: number, move: number, cell: number) => (Math.imul(game + 1, 0x9e3779b1) ^ Math.imul(move + 7, 0x85ebca6b) ^ Math.imul(cell + 13, 0xc2b2ae35)) >>> 0;

type Point = [number, number];
const between = (r: () => number, lo: number, hi: number) => lo + (hi - lo) * r();
const f = (x: number) => Math.round(x * 10) / 10;

/** A smooth path through points (Catmull–Rom, as cubic Béziers). */
function smooth(points: Point[]): string {
  let d = `M${f(points[0]![0])} ${f(points[0]![1])}`;
  for (let i = 0; i < points.length - 1; i++) {
    const [p0, p1, p2, p3] = [points[i - 1] ?? points[i]!, points[i]!, points[i + 1]!, points[i + 2] ?? points[i + 1]!];
    const c1: Point = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2: Point = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += `C${f(c1[0])} ${f(c1[1])} ${f(c2[0])} ${f(c2[1])} ${f(p2[0])} ${f(p2[1])}`;
  }
  return d;
}

/** One pen stroke from `a` to `b`, slightly bowed, with a little wobble, and a tiny hook where the pen lifts. */
function stroke(r: () => number, a: Point, b: Point, bow: number, hook = 0): string {
  const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
  const len = Math.hypot(dx, dy);
  const [nx, ny] = [-dy / len, dx / len];
  const points: Point[] = [];
  const steps = 5;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    // A bow (strongest in the middle) and a smaller wobble on top of it.
    const off = bow * Math.sin(Math.PI * t) + (i > 0 && i < steps ? between(r, -1.3, 1.3) : 0);
    points.push([a[0] + dx * t + nx * off, a[1] + dy * t + ny * off]);
  }
  if (hook) {
    // The pen flicks a touch sideways as it leaves the paper.
    points.push([b[0] + (dx / len) * 3.5 + nx * hook, b[1] + (dy / len) * 3.5 + ny * hook]);
  }
  return smooth(points);
}

/** Rotate and scale points about the middle of the square, and nudge them off it. */
function place(points: Point[], angle: number, scale: number, shift: Point): Point[] {
  const [c, s] = [Math.cos(angle), Math.sin(angle)];
  return points.map(([x, y]) => {
    const [u, v] = [(x - 50) * scale, (y - 50) * scale];
    return [50 + u * c - v * s + shift[0], 50 + u * s + v * c + shift[1]];
  });
}

/** A cross: two strokes, the first from top left to bottom right, each ending in a little flick. */
export function crossPaths(seed: number): [string, string] {
  const r = rng(seed);
  const angle = between(r, -0.16, 0.12);
  const scale = between(r, 0.9, 1.06);
  const shift: Point = [between(r, -3, 3), between(r, -3, 3)];
  const corner = () => between(r, -5, 5);
  const [a, b, c, d] = place(
    [
      [19 + corner(), 18 + corner()],
      [81 + corner(), 82 + corner()],
      [80 + corner(), 19 + corner()],
      [20 + corner(), 81 + corner()],
    ],
    angle,
    scale,
    shift,
  ) as [Point, Point, Point, Point];
  const flick = () => (r() < 0.5 ? -1 : 1) * between(r, 1.5, 4);
  return [stroke(r, a, b, between(r, -6, 6), flick()), stroke(r, c, d, between(r, -6, 6), flick())];
}

/** A circle: one lopsided loop, anticlockwise from near the top, that runs on past where it began (or stops just short). */
export function circlePath(seed: number): string {
  const r = rng(seed);
  const [rx, ry] = [between(r, 29, 34), between(r, 27, 32)];
  const tilt = between(r, -0.6, 0.6);
  const start = -Math.PI / 2 + between(r, -0.4, 1);
  // Run on past the start (most often), or stop a little short of it.
  const sweep = Math.PI * 2 + (r() < 0.82 ? between(r, 0.3, 0.75) : between(r, -0.25, -0.12));
  // The loop drifts in or out as it goes round, so its ends don't meet exactly.
  const drift = between(r, -0.13, 0.07);
  const [wobble, phase] = [between(r, 0.03, 0.065), between(r, 0, Math.PI * 2)];
  const [wobble3, phase3] = [between(r, 0, 0.03), between(r, 0, Math.PI * 2)];
  const shift: Point = [between(r, -3, 3), between(r, -2.5, 2.5)];
  const steps = 24;
  const points: Point[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const th = start - sweep * t;
    const k = 1 + drift * t + wobble * Math.sin(2 * th + phase) + wobble3 * Math.sin(3 * th + phase3);
    const [x, y] = [Math.cos(th) * rx * k, Math.sin(th) * ry * k];
    points.push([50 + x * Math.cos(tilt) - y * Math.sin(tilt) + shift[0], 50 + x * Math.sin(tilt) + y * Math.cos(tilt) + shift[1]]);
  }
  return smooth(points);
}

/**
 * The loop the winner draws round a winning line, from the middle of square `a` to the
 * middle of square `b` (sheet units), in any direction: a long, rounded, slightly lopsided
 * oval along the line, wide enough to take in the marks, started near one end and drawn in
 * one go, running on a little past where it began (or stopping just short).
 */
export function loopPath(seed: number, a: Point, b: Point): string {
  const r = rng(seed);
  const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
  const len = Math.hypot(dx, dy);
  const angle = Math.atan2(dy, dx);
  // A diagonal line's marks stick out further across it.
  const diagonal = Math.abs(Math.sin(2 * angle));
  const half = len / 2 + between(r, 60, 70);
  const across = between(r, 52, 60) + 8 * diagonal;
  const mid: Point = [(a[0] + b[0]) / 2 + between(r, -5, 5), (a[1] + b[1]) / 2 + between(r, -5, 5)];
  // Squarer than an ellipse (a superellipse), so a long loop doesn't pinch the end marks.
  const squareness = between(r, 2.6, 3.4);
  const shape = (v: number) => Math.sign(v) * Math.abs(v) ** (2 / squareness);
  const start = -Math.PI / 2 - between(r, 0.3, 1.1);
  const sweep = Math.PI * 2 + (r() < 0.8 ? between(r, 0.25, 0.6) : between(r, -0.2, -0.1));
  const drift = between(r, -0.05, 0.05);
  const [wobble, phase] = [between(r, 0.02, 0.045), between(r, 0, Math.PI * 2)];
  const tilt = angle + between(r, -0.05, 0.05);
  const steps = 40;
  const points: Point[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const th = start - sweep * t;
    const k = 1 + drift * t + wobble * Math.sin(3 * th + phase);
    const [x, y] = [shape(Math.cos(th)) * half * k, shape(Math.sin(th)) * across * k];
    points.push([mid[0] + x * Math.cos(tilt) - y * Math.sin(tilt), mid[1] + x * Math.sin(tilt) + y * Math.cos(tilt)]);
  }
  return smooth(points);
}

/** The pencil frame around the playing area, `n` squares a side (in sheet units): four slightly wavering lines that cross at the corners. */
export function framePath(seed: number, n: number): string {
  const r = rng(seed);
  const e = n * 100;
  const j = () => between(r, -6, 6);
  const o = () => between(r, 8, 22);
  const lines: [Point, Point][] = [
    [[-o(), j()], [e + o(), j()]],
    [[e + j(), -o()], [e + j(), e + o()]],
    [[e + o(), e + j()], [-o(), e + j()]],
    [[j(), e + o()], [j(), -o()]],
  ];
  return lines.map(([a, b]) => stroke(r, a, b, between(r, -10, 10))).join("");
}
