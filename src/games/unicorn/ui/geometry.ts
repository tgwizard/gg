/**
 * Where the stops are on the board. The path is a rounded loop (a superellipse) round the
 * middle of the meadow, with a gentle wobble so it looks walked rather than drawn, and the
 * stops are spaced evenly along it, the start at the bottom middle, going clockwise. Wide
 * boards and tall ones (phones) are the same loop turned. From the start the rainbow bridge
 * curves into the middle to the castle: off to the left on a wide board, straight up on a
 * tall one, leaving the rest of the middle for the rainbow, the die and the buttons.
 */
export interface Point {
  x: number;
  y: number;
}

export interface BoardShape {
  width: number;
  height: number;
  /** The path, as dense points round the loop. */
  path: Point[];
  stops: Point[];
  /** The rainbow bridge's stops after the start, the castle last; `bridgePath` is the curve through them. */
  bridge: Point[];
  bridgePath: Point[];
  /** Where the rainbow, the die and the buttons go, inside the loop and clear of the bridge. */
  controls: Rect;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const SAMPLES = 1200;

export function boardShape(count: number, bridgeCount: number, tall: boolean): BoardShape {
  const [width, height] = tall ? [640, 1000] : [1000, 640];
  const margin = 62;
  const a = width / 2 - margin;
  const b = height / 2 - margin;
  const pow = (v: number, e: number) => Math.sign(v) * Math.abs(v) ** e;
  const dense: Point[] = [];
  for (let i = 0; i < SAMPLES; i++) {
    // From the bottom middle (t = π/2), clockwise on screen.
    const t = Math.PI / 2 + (i / SAMPLES) * 2 * Math.PI;
    const wobble = 1 + 0.025 * Math.sin(5 * t + 0.6);
    dense.push({ x: width / 2 + a * wobble * pow(Math.cos(t), 0.55), y: height / 2 + b * wobble * pow(Math.sin(t), 0.55) });
  }
  const stops = spaced([...dense, dense[0]!], count, false);
  const inner = margin + 70;
  const middle: Rect = { x: inner, y: inner, width: width - 2 * inner, height: height - 2 * inner };

  // The bridge: a curve from the start to the castle.
  const start = stops[0]!;
  const [castle, c1, c2, controls]: [Point, Point, Point, Rect] = tall
    ? [
        { x: width / 2, y: middle.y + middle.height * 0.77 },
        { x: start.x - 30, y: start.y - 170 },
        { x: start.x + 110, y: middle.y + middle.height * 0.86 },
        { x: middle.x, y: middle.y - 10, width: middle.width, height: middle.height * 0.62 },
      ]
    : [
        { x: middle.x + middle.width * 0.17, y: middle.y + middle.height * 0.36 },
        { x: start.x - 40, y: start.y - 170 },
        { x: middle.x + middle.width * 0.14, y: middle.y + middle.height * 0.86 },
        { x: middle.x + middle.width * 0.36, y: middle.y - 10, width: middle.width * 0.66, height: middle.height + 20 },
      ];
  const curve: Point[] = [];
  for (let i = 0; i <= 200; i++) {
    const t = i / 200;
    const u = 1 - t;
    curve.push({
      x: u * u * u * start.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * castle.x,
      y: u * u * u * start.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * castle.y,
    });
  }
  return { width, height, path: dense, stops, bridge: spaced(curve, bridgeCount, true), bridgePath: curve, controls };
}

/**
 * `count` points evenly spaced by length along `line`: from its start (a loop, whose
 * points end where they began), or after its start and ending at its end (`after`).
 */
function spaced(line: Point[], count: number, after: boolean): Point[] {
  const lengths = [0];
  for (let i = 1; i < line.length; i++) lengths.push(lengths[i - 1]! + Math.hypot(line[i]!.x - line[i - 1]!.x, line[i]!.y - line[i - 1]!.y));
  const total = lengths.at(-1)!;
  const out: Point[] = [];
  let j = 0;
  for (let k = 0; k < count; k++) {
    const want = ((after ? k + 1 : k) / count) * total;
    while (j < line.length - 2 && lengths[j + 1]! < want) j++;
    const f = Math.min(1, (want - lengths[j]!) / (lengths[j + 1]! - lengths[j]! || 1));
    const p = line[j]!;
    const q = line[j + 1]!;
    out.push({ x: p.x + (q.x - p.x) * f, y: p.y + (q.y - p.y) * f });
  }
  return out;
}

/**
 * Where racers standing together on a stop go, so each is seen: in a slanting line, each one
 * a little nearer the front than the one before (as later ones are drawn over earlier ones),
 * and a little smaller the more there are.
 */
const HUDDLE: { scale: number; at: Point[] }[] = [
  { scale: 1, at: [{ x: 0, y: 0 }] },
  {
    scale: 1,
    at: [
      { x: -34, y: -10 },
      { x: 34, y: 10 },
    ],
  },
  {
    scale: 0.86,
    at: [
      { x: -46, y: -14 },
      { x: 0, y: 0 },
      { x: 46, y: 14 },
    ],
  },
  {
    scale: 0.76,
    at: [
      { x: -57, y: -18 },
      { x: -19, y: -6 },
      { x: 19, y: 6 },
      { x: 57, y: 18 },
    ],
  },
];
export function huddle(n: number, i: number): Point & { scale: number } {
  const h = HUDDLE[Math.min(n, HUDDLE.length) - 1]!;
  return { ...(h.at[i] ?? { x: 0, y: 0 }), scale: h.scale };
}

/** Where the friends waiting at a stop with several stand on it, back to front. */
export const waiting = (n: number): Point[] =>
  n <= 1
    ? [{ x: 0, y: 14 }]
    : n === 2
      ? [
          { x: -15, y: 10 },
          { x: 15, y: 10 },
        ]
      : [
          { x: -16, y: -1 },
          { x: 16, y: -1 },
          { x: 0, y: 21 },
        ];

/** Which way a unicorn at `at` faces: the way the path goes there (on a loop of `loop` stops, then the bridge). */
export function facesLeft(shape: BoardShape, loop: number, at: number): boolean {
  const line = at < loop ? shape.stops : [shape.stops[0]!, ...shape.bridge];
  const i = at < loop ? at : at - loop + 1;
  const n = line.length;
  const prev = at < loop ? line[(i - 1 + n) % n]! : line[Math.max(0, i - 1)]!;
  const next = at < loop ? line[(i + 1) % n]! : line[Math.min(n - 1, i + 1)]!;
  // Going straight up or down, it keeps to the right rather than turning stop by stop.
  return next.x - prev.x < -12;
}
