/**
 * Builds the Stockholm board's land and water (src/games/ticket/ui/boards/stockholm-geography.ts)
 * from OpenStreetMap: its coastline (the sea, the archipelago) and lakes (Mälaren and the rest).
 * © OpenStreetMap contributors, ODbL: credited on the board and in the game's README.
 *
 * The board is the inner city (Bromma to Lidingö), through a gentle fisheye that magnifies
 * the middle a little. Real outlines go through the same fisheye as the stations' real
 * positions, then a thin-plate spline bends them the rest of the way to where the board
 * has the stations (so moving a station on the board moves its shores with it).
 *
 *   node --import ./tools/ts-hooks.mjs tools/ttr-stockholm-geography.ts <dir>
 *
 * <dir> has coast.json and water.json, from the Overpass API (overpass-api.de):
 *   [out:json];way["natural"="coastline"](58.85,17.25,59.95,18.75);out skel geom qt;
 *   [out:json];(way["natural"="water"](58.85,17.25,59.95,18.75);relation["natural"="water"](58.85,17.25,59.95,18.75););out geom qt;
 */
import { readFileSync, writeFileSync } from "node:fs";
import { STOCKHOLM } from "../src/games/ticket/maps/stockholm.ts";
import { STOCKHOLM_VIEWBOX as VIEWBOX } from "../src/games/ticket/ui/boards/stockholm-viewbox.ts";

type Pt = [number, number];
type Ring = Pt[];

const dir = process.argv[2];
if (!dir) throw new Error("usage: node --import ./tools/ts-hooks.mjs tools/ttr-stockholm-geography.ts <dir>");
const read = (name: string) => JSON.parse(readFileSync(`${dir}/${name}.json`, "utf8"));

/**
 * Where the stations really are: [latitude, longitude]. The ones on the board's edge
 * (Arlanda, Nynäshamn…) aren't here: they're far off, and the shores aren't bent for them.
 */
const REAL: Record<string, Pt> = {
  CEN: [59.3312, 18.0595], GAM: [59.3233, 18.067], SLU: [59.3193, 18.0722], OMT: [59.3355, 18.0777], ODE: [59.343, 18.0479],
  FRI: [59.3329, 18.0311], KPL: [59.3398, 18.0923], TEK: [59.3458, 18.0709], UNI: [59.3651, 18.051], ROP: [59.3581, 18.1038],
  DJU: [59.3245, 18.0985], MED: [59.3152, 18.0732], SKN: [59.3087, 18.076], MTG: [59.3171, 18.0605], HOR: [59.3164, 18.0367],
  LIL: [59.3107, 18.0231], ARB: [59.2996, 18.0281], GUL: [59.2995, 18.0806], HSS: [59.3042, 18.0959], SIC: [59.3068, 18.121],
  SKA: [59.2664, 18.133], AVS: [59.2785, 18.0111], TEL: [59.2984, 17.9982], FRU: [59.2865, 17.9649], SKO: [59.2787, 18.0954],
  ALV: [59.3334, 17.9826], BRP: [59.3383, 17.9397], ALS: [59.3207, 17.9521], BFL: [59.357, 17.9468], SUN: [59.3607, 17.9719],
  SOL: [59.3665, 18.0096], ESS: [59.3165, 17.9846], DRO: [59.3232, 17.8909], TOR: [59.3619, 18.1179], LAR: [59.3507, 18.1455],
  SKS: [59.3434, 18.1703], GAS: [59.3567, 18.2279], FJA: [59.3283, 18.176], NAC: [59.3181, 18.1569],
};

// --- a gentle fisheye: distance from the middle of town, logarithmically, so the middle is magnified a little ---

const LAT0 = 59.327;
const LON0 = 18.07;
const K = 2.3; // km: inside this the board is close to true to scale
const A = 262;
const CX = VIEWBOX.x + VIEWBOX.w / 2;
const CY = VIEWBOX.y + VIEWBOX.h / 2;

function fisheye([lat, lon]: Pt): Pt {
  const x = (lon - LON0) * 56.8;
  const y = (LAT0 - lat) * 111.2;
  const r = Math.hypot(x, y);
  if (r < 1e-9) return [CX, CY];
  const g = A * Math.log(1 + r / K);
  return [CX + (g * x) / r, CY + (g * y) / r];
}

// --- then a smoothed thin-plate spline, for where the board moves stations from where the fisheye puts them ---

function solve(a: number[][], b: number[]): number[] {
  const n = b.length;
  const m = a.map((row, i) => [...row, b[i]!]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(m[r]![c]!) > Math.abs(m[p]![c]!)) p = r;
    [m[c], m[p]] = [m[p]!, m[c]!];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = m[r]![c]! / m[c]![c]!;
      for (let k = c; k <= n; k++) m[r]![k]! -= f * m[c]![k]!;
    }
  }
  return m.map((row, i) => row[n]! / row[i]!);
}

const U = (r: number) => (r === 0 ? 0 : r * r * Math.log(r));
const SMOOTH = 2;
const placed = STOCKHOLM.cities.filter((c) => REAL[c.id]);
const ctrl = placed.map((c) => fisheye(REAL[c.id]!));
function fit(values: number[]) {
  const n = ctrl.length;
  const a: number[][] = [];
  for (let i = 0; i < n + 3; i++) a.push(new Array(n + 3).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) a[i]![j] = U(Math.hypot(ctrl[i]![0] - ctrl[j]![0], ctrl[i]![1] - ctrl[j]![1]) / 100) + (i === j ? SMOOTH : 0);
    a[i]![n] = 1;
    a[i]![n + 1] = ctrl[i]![0] / 100;
    a[i]![n + 2] = ctrl[i]![1] / 100;
    a[n]![i] = 1;
    a[n + 1]![i] = ctrl[i]![0] / 100;
    a[n + 2]![i] = ctrl[i]![1] / 100;
  }
  return solve(a, [...values, 0, 0, 0]);
}
const dxs = fit(placed.map((c, i) => c.x - ctrl[i]![0]));
const dys = fit(placed.map((c, i) => c.y - ctrl[i]![1]));
function bend(w: number[], p: Pt): number {
  const n = ctrl.length;
  let v = w[n]! + (w[n + 1]! * p[0]) / 100 + (w[n + 2]! * p[1]) / 100;
  for (let i = 0; i < n; i++) v += w[i]! * U(Math.hypot(p[0] - ctrl[i]![0], p[1] - ctrl[i]![1]) / 100);
  return v;
}
// The spline is fitted to what's left after the fisheye, so far from every station it settles to nearly nothing.
const project = (ll: Pt): Pt => {
  const p = fisheye(ll);
  return [p[0] + bend(dxs, p), p[1] + bend(dys, p)];
};

// --- the coastline: ways joined into chains, land on their left ---

/** The data's bounds, a little inside the query's so every chain crosses them cleanly. */
const R = { s: 58.86, w: 17.26, n: 59.94, e: 18.74 };
const inR = ([lat, lon]: Pt) => lat > R.s && lat < R.n && lon > R.w && lon < R.e;

interface Way {
  nodes: number[];
  geometry: { lat: number; lon: number }[];
}
const coastWays: Way[] = read("coast").elements.filter((e: Way) => e.geometry?.length);
const byStart = new Map<number, Way>();
const byEnd = new Map<number, Way>();
for (const w of coastWays) {
  byStart.set(w.nodes[0]!, w);
  byEnd.set(w.nodes.at(-1)!, w);
}
const used = new Set<Way>();
const chains: { pts: Pt[]; closed: boolean }[] = [];
for (const w of coastWays) {
  if (used.has(w)) continue;
  // Back up to the start of this chain, then follow it forward.
  let first = w;
  const seen = new Set<Way>([w]);
  for (;;) {
    const prev = byEnd.get(first.nodes[0]!);
    if (!prev || seen.has(prev) || used.has(prev)) break;
    seen.add(prev);
    first = prev;
  }
  const pts: Pt[] = [];
  let cur: Way | undefined = first;
  let closed = false;
  while (cur && !used.has(cur)) {
    used.add(cur);
    const g = cur.geometry.map((p): Pt => [p.lat, p.lon]);
    pts.push(...(pts.length ? g.slice(1) : g));
    cur = byStart.get(cur.nodes.at(-1)!);
    if (cur === first) closed = true;
  }
  chains.push({ pts, closed });
}

// Clip the chains to R: rings inside it are islands; pieces crossing it run from one point on its edge to another.
type Piece = { pts: Pt[]; enter: number; exit: number };
const PERIM = 2 * (R.n - R.s) + 2 * (R.e - R.w);
/** How far round R's edge a point on it is, anticlockwise from the south-west corner (as on a map, north up). */
function around([lat, lon]: Pt): number {
  const eps = 1e-9;
  if (Math.abs(lat - R.s) < eps) return lon - R.w;
  if (Math.abs(lon - R.e) < eps) return R.e - R.w + (lat - R.s);
  if (Math.abs(lat - R.n) < eps) return R.e - R.w + (R.n - R.s) + (R.e - lon);
  return 2 * (R.e - R.w) + (R.n - R.s) + (R.n - lat);
}
const CORNERS: [number, Pt][] = [
  [0, [R.s, R.w]],
  [R.e - R.w, [R.s, R.e]],
  [R.e - R.w + (R.n - R.s), [R.n, R.e]],
  [2 * (R.e - R.w) + (R.n - R.s), [R.n, R.w]],
];
/** Where segment a→b crosses R's edge (one end inside, the other outside). */
function crossing(a: Pt, b: Pt): Pt {
  const [i, o] = inR(a) ? [a, b] : [b, a];
  const d: Pt = [o[0] - i[0], o[1] - i[1]];
  let t = 1;
  for (const [v, k] of [
    [R.s, 0],
    [R.n, 0],
    [R.w, 1],
    [R.e, 1],
  ] as const) {
    if (d[k] === 0) continue;
    const s = (v - i[k]) / d[k];
    if (s > 0 && s < t) t = s;
  }
  const p: Pt = [i[0] + d[0] * t, i[1] + d[1] * t];
  // Exactly on the edge, for `around`.
  const snap = (v: number, lo: number, hi: number) => (Math.abs(v - lo) < 1e-7 ? lo : Math.abs(v - hi) < 1e-7 ? hi : v);
  return [snap(p[0], R.s, R.n), snap(p[1], R.w, R.e)];
}

const islands: Ring[] = [];
const pieces: Piece[] = [];
let stray = 0;
for (const { pts, closed } of chains) {
  if (closed && pts.every(inR)) {
    islands.push(pts);
    continue;
  }
  if (pts.every((p) => !inR(p))) continue;
  // Walk it, cutting where it crosses R's edge. A closed ring that crosses: start from a point outside.
  let seq = pts;
  if (closed) {
    const out = pts.findIndex((p) => !inR(p));
    seq = [...pts.slice(out), ...pts.slice(1, out + 1)];
  }
  // A piece that starts or ends inside R is where the data has a gap: left out (and counted).
  let cur: Pt[] | null = null;
  if (inR(seq[0]!)) stray++;
  for (let i = 1; i < seq.length; i++) {
    const [a, b] = [seq[i - 1]!, seq[i]!];
    if (inR(a) && inR(b)) cur?.push(b);
    else if (!inR(a) && inR(b)) cur = [crossing(a, b), b];
    else if (inR(a) && !inR(b)) {
      if (cur) {
        const x = crossing(a, b);
        cur.push(x);
        pieces.push({ pts: cur, enter: around(cur[0]!), exit: around(x) });
      }
      cur = null;
    }
  }
  if (cur) stray++;
}

// Join the pieces into land: from where one leaves R, anticlockwise along R's edge to where the next one comes in.
/**
 * Beyond the data, inland (north and west of it), land carries on to the board's edges:
 * points along those edges of R are carried out this far from the middle. Its south and
 * east edges are out at sea, and kept where they are.
 */
const OUT = 6;
const EDGE_STEP = 0.01;
/** The point `t` round R's edge (as `around` measures it), in board coordinates. */
function edgePoint(t: number): Pt {
  const [we, sn] = [R.e - R.w, R.n - R.s];
  if (t <= we) return project([R.s, R.w + t]);
  if (t <= we + sn) return project([R.s + (t - we), R.e]);
  if (t <= 2 * we + sn) return outward([R.n, R.e - (t - we - sn)]);
  return outward([R.n - (t - 2 * we - sn), R.w]);
}
const middle: Pt = [CX, CY];
const outward = (p: Pt): Pt => {
  const q = project(p);
  return [middle[0] + (q[0] - middle[0]) * OUT, middle[1] + (q[1] - middle[1]) * OUT];
};
const land: Pt[][] = []; // in board coordinates
const left = new Set(pieces);
while (left.size) {
  const start = left.values().next().value!;
  const ring: Pt[] = [];
  let piece = start;
  for (let guard = 0; guard < 10_000; guard++) {
    left.delete(piece);
    ring.push(...piece.pts.map(project));
    // The next piece in: the nearest entry anticlockwise from this exit (back to the first closes it).
    const dist = (t: number) => (t - piece.exit + PERIM) % PERIM;
    let next = start;
    for (const p of left) if (dist(p.enter) < dist(next.enter)) next = p;
    // Along R's edge to there, in small steps (the fisheye curves it), round any corners on the way.
    const span = dist(next.enter);
    const corners = CORNERS.map(([t]) => dist(t)).filter((d) => d > 0 && d < span);
    const steps = [...new Set([...Array.from({ length: Math.floor(span / EDGE_STEP) }, (_, i) => (i + 1) * EDGE_STEP), ...corners])].sort((a, b) => a - b);
    for (const d of steps) ring.push(edgePoint((piece.exit + d) % PERIM));
    if (next === start) break;
    piece = next;
  }
  land.push(ring);
}
for (const r of islands) land.push(r.map(project));

// --- lakes: outlines, with their islands as holes ---

interface Member {
  type: string;
  role: string;
  geometry?: { lat: number; lon: number }[];
}
const key = (p: { lat: number; lon: number }) => `${p.lat.toFixed(7)},${p.lon.toFixed(7)}`;
/** Ways joined end to end (either way round) into rings. */
function rings(ways: { lat: number; lon: number }[][]): Ring[] {
  const out: Ring[] = [];
  const open = ways.filter((w) => w.length > 1).map((w) => [...w]);
  while (open.length) {
    const ring = open.pop()!;
    for (let guard = 0; guard < 5000 && key(ring[0]!) !== key(ring.at(-1)!); guard++) {
      const end = key(ring.at(-1)!);
      const i = open.findIndex((w) => key(w[0]!) === end || key(w.at(-1)!) === end);
      if (i < 0) break;
      const w = open.splice(i, 1)[0]!;
      ring.push(...(key(w[0]!) === end ? w : [...w].reverse()).slice(1));
    }
    if (key(ring[0]!) === key(ring.at(-1)!)) out.push(ring.map((p): Pt => [p.lat, p.lon]));
  }
  return out;
}
const lakes: { outer: Pt[]; inner: Pt[][] }[] = [];
for (const e of read("water").elements) {
  if (e.type === "way" && e.geometry?.length > 3 && key(e.geometry[0]) === key(e.geometry.at(-1))) {
    lakes.push({ outer: e.geometry.map((p: { lat: number; lon: number }) => project([p.lat, p.lon])), inner: [] });
  } else if (e.type === "relation") {
    const members: Member[] = e.members.filter((m: Member) => m.type === "way" && m.geometry);
    const outers = rings(members.filter((m) => m.role !== "inner").map((m) => m.geometry!));
    const inners = rings(members.filter((m) => m.role === "inner").map((m) => m.geometry!)).map((r) => r.map(project));
    for (const o of outers) lakes.push({ outer: o.map(project), inner: inners });
  }
}

// --- onto the board: clipped, simplified, small bits dropped ---

const PAD = 12;
const box = { x0: VIEWBOX.x - PAD, y0: VIEWBOX.y - PAD, x1: VIEWBOX.x + VIEWBOX.w + PAD, y1: VIEWBOX.y + VIEWBOX.h + PAD };
/** Sutherland–Hodgman against the board (and a little more, so clipped edges aren't drawn on it). */
function clip(ring: Pt[]): Pt[] {
  let pts = ring;
  const edges: [(p: Pt) => boolean, (a: Pt, b: Pt) => Pt][] = [
    [(p) => p[0] >= box.x0, (a, b) => [box.x0, a[1] + ((b[1] - a[1]) * (box.x0 - a[0])) / (b[0] - a[0])]],
    [(p) => p[0] <= box.x1, (a, b) => [box.x1, a[1] + ((b[1] - a[1]) * (box.x1 - a[0])) / (b[0] - a[0])]],
    [(p) => p[1] >= box.y0, (a, b) => [a[0] + ((b[0] - a[0]) * (box.y0 - a[1])) / (b[1] - a[1]), box.y0]],
    [(p) => p[1] <= box.y1, (a, b) => [a[0] + ((b[0] - a[0]) * (box.y1 - a[1])) / (b[1] - a[1]), box.y1]],
  ];
  for (const [inside, cut] of edges) {
    const out: Pt[] = [];
    for (let i = 0; i < pts.length; i++) {
      const [a, b] = [pts[(i + pts.length - 1) % pts.length]!, pts[i]!];
      if (inside(b)) {
        if (!inside(a)) out.push(cut(a, b));
        out.push(b);
      } else if (inside(a)) out.push(cut(a, b));
    }
    pts = out;
    if (!pts.length) break;
  }
  return pts;
}
function simplify(pts: Pt[], tol: number): Pt[] {
  if (pts.length < 4) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop()!;
    const [a, b] = [pts[i]!, pts[j]!];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    let far = -1;
    let best = tol;
    for (let k = i + 1; k < j; k++) {
      const p = pts[k]!;
      const d = Math.abs((b[0] - a[0]) * (a[1] - p[1]) - (a[0] - p[0]) * (b[1] - a[1])) / len;
      if (d > best) [best, far] = [d, k];
    }
    if (far >= 0) {
      keep[far] = 1;
      stack.push([i, far], [far, j]);
    }
  }
  return pts.filter((_, k) => keep[k]);
}
/** A closed ring, simplified: split at the point farthest from its start, so neither half has the same two ends. */
function simplifyRing(ring: Pt[], tol: number): Pt[] {
  const r = ring.length > 1 && ring[0]![0] === ring.at(-1)![0] && ring[0]![1] === ring.at(-1)![1] ? ring.slice(0, -1) : ring;
  if (r.length < 4) return r;
  let far = 0;
  for (let k = 1; k < r.length; k++) if (Math.hypot(r[k]![0] - r[0]![0], r[k]![1] - r[0]![1]) > Math.hypot(r[far]![0] - r[0]![0], r[far]![1] - r[0]![1])) far = k;
  return [...simplify(r.slice(0, far + 1), tol).slice(0, -1), ...simplify([...r.slice(far), r[0]!], tol).slice(0, -1)];
}
const area = (r: Pt[]) => Math.abs(r.reduce((s, p, i) => s + p[0] * r[(i + 1) % r.length]![1] - r[(i + 1) % r.length]![0] * p[1], 0) / 2);
const TOL = 0.45;
const MIN_LAND = 5;
const MIN_LAKE = 12;
const path = (r: Pt[]) => `M${r.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join("L")}Z`;
const onBoard = (r: Pt[], min: number) => {
  const c = simplifyRing(clip(r), TOL);
  return c.length >= 3 && area(c) >= min ? c : null;
};

const landPaths = land.map((r) => onBoard(r, MIN_LAND)).filter((r): r is Pt[] => !!r);
const lakePaths = lakes
  .map((l) => {
    const outer = onBoard(l.outer, MIN_LAKE);
    return outer ? path(outer) + l.inner.map((r) => onBoard(r, MIN_LAND)).filter((r): r is Pt[] => !!r).map(path).join("") : null;
  })
  .filter((d): d is string => !!d);

// Stations that end up in the water are worth knowing about.
function inside(p: Pt, r: Pt[]) {
  let c = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [a, b] = [r[i]!, r[j]!];
    if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) c = !c;
  }
  return c;
}
const wet = STOCKHOLM.cities.filter((c) => !landPaths.some((r) => inside([c.x, c.y], r))).map((c) => c.name);

const out = `/**
 * Land and lakes for the Stockholm board. Generated by tools/ttr-stockholm-geography.ts from
 * OpenStreetMap (© OpenStreetMap contributors, ODbL): real shores through the board's fisheye,
 * bent so the stations sit where the board has them. Don't edit by hand.
 */
export const LAND: { d: string }[] = [{ d: ${JSON.stringify(landPaths.map(path).join(""))} }];

/** Lakes, their islands cut out (draw with fill-rule evenodd). */
export const LAKES: { d: string }[] = ${JSON.stringify(lakePaths.map((d) => ({ d })))};
`;
writeFileSync(new URL("../src/games/ticket/ui/boards/stockholm-geography.ts", import.meta.url), out);
console.log(
  `${chains.length} coast chains (${islands.length} islands inside, ${pieces.length} pieces across the edge, ${stray} loose ends); ${landPaths.length} land shapes, ${lakePaths.length} lakes; ${(out.length / 1024).toFixed(0)} KB`,
);
if (wet.length) console.log(`In the water: ${wet.join(", ")}`);
