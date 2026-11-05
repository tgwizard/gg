/** Where the train cars of each route go on the drawn map, and where each city's name goes. */
import type { City, Route, TtrMap } from "../map";

const CITY_GAP = 11;
const CAR_GAP = 3;
/** How far apart the two tracks of a double route run. */
const TRACK_SPACING = 11;

export interface Car {
  x: number;
  y: number;
  /** Degrees. */
  angle: number;
  length: number;
}

export interface TrackShape {
  /** An SVG path along the track (for hit-testing and highlights). */
  path: string;
  cars: Car[];
  /** The middle of the track, for labels. */
  mid: { x: number; y: number };
}

function shapeOf(map: TtrMap, route: Route): TrackShape {
  const a = map.cityById.get(route.a)!;
  const b = map.cityById.get(route.b)!;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dist = Math.hypot(dx, dy);
  const [nx, ny] = [-dy / dist, dx / dist];
  const side = route.twin ? (route.id.endsWith("/1") ? -0.5 : 0.5) * TRACK_SPACING : 0;
  const p0 = { x: a.x + nx * side, y: a.y + ny * side };
  const p2 = { x: b.x + nx * side, y: b.y + ny * side };
  const bow = route.bend * dist;
  const p1 = { x: (p0.x + p2.x) / 2 + nx * bow, y: (p0.y + p2.y) / 2 + ny * bow };
  const at = (t: number) => ({
    x: (1 - t) ** 2 * p0.x + 2 * (1 - t) * t * p1.x + t ** 2 * p2.x,
    y: (1 - t) ** 2 * p0.y + 2 * (1 - t) * t * p1.y + t ** 2 * p2.y,
  });

  // Sample the curve to place cars evenly by distance along it.
  const STEPS = 80;
  const pts = Array.from({ length: STEPS + 1 }, (_, i) => at(i / STEPS));
  const lens = [0];
  for (let i = 1; i <= STEPS; i++) lens.push(lens[i - 1]! + Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y));
  const total = lens[STEPS]!;
  const pointAt = (s: number) => {
    let i = 1;
    while (i < STEPS && lens[i]! < s) i++;
    const f = (s - lens[i - 1]!) / (lens[i]! - lens[i - 1]! || 1);
    const [p, q] = [pts[i - 1]!, pts[i]!];
    return { x: p.x + (q.x - p.x) * f, y: p.y + (q.y - p.y) * f, angle: (Math.atan2(q.y - p.y, q.x - p.x) * 180) / Math.PI };
  };

  const start = CITY_GAP;
  const span = (total - 2 * CITY_GAP) / route.length;
  const cars = Array.from({ length: route.length }, (_, i) => {
    const p = pointAt(start + span * (i + 0.5));
    return { x: p.x, y: p.y, angle: p.angle, length: span - CAR_GAP };
  });
  const mid = pointAt(total / 2);
  return { path: `M${p0.x},${p0.y} Q${p1.x},${p1.y} ${p2.x},${p2.y}`, cars, mid: { x: mid.x, y: mid.y } };
}

const shapes = new WeakMap<TtrMap, Map<string, TrackShape>>();

/** Every route's track on a map, by route id (worked out once per map). */
export function tracksFor(map: TtrMap): Map<string, TrackShape> {
  let tracks = shapes.get(map);
  if (!tracks) shapes.set(map, (tracks = new Map(map.routes.map((r) => [r.id, shapeOf(map, r)]))));
  return tracks;
}

export type Label = [dx: number, dy: number, anchor: "start" | "middle" | "end"];

/** Places to try for a name, best first: below, above, right, left, then the corners. */
const SPOTS: Label[] = [
  [0, 20, "middle"],
  [0, -13, "middle"],
  [12, 4, "start"],
  [-12, 4, "end"],
  [11, -9, "start"],
  [-11, -9, "end"],
  [11, 16, "start"],
  [-11, 16, "end"],
];
const CHAR_WIDTH = 6.6;
const TEXT_HEIGHT = 12;

const labelCache = new WeakMap<TtrMap, Record<string, Label>>();

/**
 * Where each city's name goes: as the board says, or else the first of SPOTS that keeps
 * clear of tracks, cities, names already placed and the board's edges (or the least crowded one).
 */
export function labelsFor(map: TtrMap, given: Record<string, Label>, board: { x: number; y: number; w: number; h: number }): Record<string, Label> {
  const cached = labelCache.get(map);
  if (cached) return cached;
  const tracks = tracksFor(map);
  const cars = [...tracks.values()].flatMap((t) => t.cars);
  const boxes: { x0: number; y0: number; x1: number; y1: number }[] = [];
  const boxOf = (c: City, [dx, dy, anchor]: Label) => {
    const w = c.name.length * CHAR_WIDTH;
    const x0 = c.x + dx - (anchor === "middle" ? w / 2 : anchor === "end" ? w : 0);
    return { x0, y0: c.y + dy - TEXT_HEIGHT + 2, x1: x0 + w, y1: c.y + dy + 2 };
  };
  const crowding = (c: City, b: ReturnType<typeof boxOf>) => {
    let n = 0;
    for (const car of cars) if (car.x > b.x0 - 4 && car.x < b.x1 + 4 && car.y > b.y0 - 4 && car.y < b.y1 + 4) n++;
    for (const o of map.cities) if (o !== c && o.x > b.x0 - 8 && o.x < b.x1 + 8 && o.y > b.y0 - 8 && o.y < b.y1 + 8) n += 3;
    for (const o of boxes) if (o.x0 < b.x1 && b.x0 < o.x1 && o.y0 < b.y1 && b.y0 < o.y1) n += 3;
    if (b.x0 < board.x + 4 || b.y0 < board.y + 4 || b.x1 > board.x + board.w - 4 || b.y1 > board.y + board.h - 4) n += 20;
    return n;
  };
  const out: Record<string, Label> = {};
  for (const c of map.cities) {
    const spot = given[c.id] ?? SPOTS.reduce((best, s) => (crowding(c, boxOf(c, s)) < crowding(c, boxOf(c, best)) ? s : best));
    out[c.id] = spot;
    boxes.push(boxOf(c, spot));
  }
  labelCache.set(map, out);
  return out;
}

