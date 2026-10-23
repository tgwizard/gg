/** Where the train cars of each route go on the drawn map. */
import { cityById, ROUTES, type Route } from "../map";

/** The map's drawn area, in map coordinates. */
export const VIEWBOX = { x: 14, y: 44, w: 982, h: 584 };

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

function shapeOf(route: Route): TrackShape {
  const a = cityById.get(route.a)!;
  const b = cityById.get(route.b)!;
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

export const TRACKS: Map<string, TrackShape> = new Map(ROUTES.map((r) => [r.id, shapeOf(r)]));

/** Where each city's name goes, relative to it: [dx, dy, text-anchor]. Below, centered, unless it would sit on a track. */
export const LABELS: Record<string, [number, number, "start" | "middle" | "end"]> = {
  VAN: [0, -13, "middle"],
  SEA: [-12, 4, "end"],
  POR: [11, -2, "start"],
  SFO: [12, 18, "start"],
  LAX: [-6, 20, "middle"],
  CAL: [0, -13, "middle"],
  HEL: [12, -8, "start"],
  SLC: [-12, -8, "end"],
  LAS: [-12, 4, "end"],
  PHX: [0, 21, "middle"],
  ELP: [0, 21, "middle"],
  SAF: [12, 14, "start"],
  DEN: [-8, -17, "end"],
  WIN: [10, -10, "start"],
  DUL: [-8, -13, "end"],
  OMA: [-13, 4, "end"],
  KAN: [8, -13, "start"],
  OKC: [6, 23, "start"],
  DAL: [-12, 16, "end"],
  HOU: [0, 21, "middle"],
  SSM: [0, -20, "middle"],
  CHI: [-12, -6, "end"],
  STL: [13, -5, "start"],
  LIT: [12, 5, "start"],
  NOR: [0, 21, "middle"],
  TOR: [0, -15, "middle"],
  PIT: [13, -6, "start"],
  NAS: [-12, -4, "end"],
  ATL: [0, 21, "middle"],
  CHA: [13, 16, "start"],
  MIA: [-12, 15, "end"],
  MON: [0, -13, "middle"],
  BOS: [8, -11, "start"],
  NYC: [13, 4, "start"],
  WAS: [13, 4, "start"],
  RAL: [13, -4, "start"],
};
