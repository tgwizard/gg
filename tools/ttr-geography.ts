/**
 * Builds the Ticket to Ride map's coastlines, lakes and borders
 * (src/games/ticket/ui/geography.ts) from Natural Earth's 1:50m data (public domain).
 *
 * The board isn't a real projection: cities sit where the printed board puts them.
 * So real outlines are bent onto it with a thin-plate spline fitted to the 36 cities'
 * real positions (lightly smoothed), which keeps coastal cities on their coasts.
 *
 *   node tools/ttr-geography.ts <dir with the Natural Earth GeoJSON files>
 *
 * Needs ne_50m_admin_0_countries, ne_50m_lakes and ne_50m_admin_0_boundary_lines_land
 * (.geojson) from github.com/nvkelso/natural-earth-vector.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { CITIES } from "../src/games/ticket/map.ts";

/** The board's drawn area (as in ui/geometry.ts, which node can't import directly). */
const VIEWBOX = { x: 14, y: 44, w: 982, h: 584 };

type Pt = [number, number];
type Ring = Pt[];

const dir = process.argv[2];
if (!dir) throw new Error("usage: node tools/ttr-geography.ts <natural-earth-dir>");
const read = (name: string) => JSON.parse(readFileSync(`${dir}/${name}.geojson`, "utf8"));

/** Real positions (latitude, longitude). */
const REAL: Record<string, Pt> = {
  VAN: [49.28, -123.12], SEA: [47.61, -122.33], POR: [45.52, -122.68], SFO: [37.77, -122.42], LAX: [34.05, -118.24],
  CAL: [51.05, -114.07], HEL: [46.59, -112.04], SLC: [40.76, -111.89], LAS: [36.17, -115.14], PHX: [33.45, -112.07],
  ELP: [31.76, -106.49], SAF: [35.69, -105.94], DEN: [39.74, -104.99], WIN: [49.9, -97.14], DUL: [46.79, -92.1],
  OMA: [41.26, -95.93], KAN: [39.1, -94.58], OKC: [35.47, -97.52], DAL: [32.78, -96.8], HOU: [29.76, -95.37],
  SSM: [46.5, -84.35], CHI: [41.88, -87.63], STL: [38.63, -90.2], LIT: [34.75, -92.29], NOR: [29.95, -90.07],
  TOR: [43.65, -79.38], PIT: [40.44, -79.99], NAS: [36.16, -86.78], ATL: [33.75, -84.39], CHA: [32.78, -79.93],
  MIA: [25.76, -80.19], MON: [45.5, -73.57], BOS: [42.36, -71.06], NYC: [40.71, -74.01], WAS: [38.91, -77.04], RAL: [35.78, -78.64],
};

// --- the warp: a smoothed thin-plate spline from (lon·cos 40°, lat) to board coordinates ---

const plane = ([lat, lon]: Pt): Pt => [lon * Math.cos((40 * Math.PI) / 180), lat];
const SMOOTH = 0.6;

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
const ctrl = CITIES.map((c) => plane(REAL[c.id]!));
const n = ctrl.length;
function fit(values: number[]) {
  const A: number[][] = [];
  for (let i = 0; i < n; i++) {
    const row = ctrl.map((q, j) => U(Math.hypot(ctrl[i]![0] - q[0], ctrl[i]![1] - q[1])) + (i === j ? SMOOTH : 0));
    A.push([...row, 1, ctrl[i]![0], ctrl[i]![1]]);
  }
  for (let k = 0; k < 3; k++) A.push([...ctrl.map((q) => (k === 0 ? 1 : q[k - 1]!)), 0, 0, 0]);
  return solve(A, [...values, 0, 0, 0]);
}
const wx = fit(CITIES.map((c) => c.x));
const wy = fit(CITIES.map((c) => c.y));
function warp(p: Pt): Pt {
  const [x, y] = plane(p);
  const at = (w: number[]) => w[n]! + w[n + 1]! * x + w[n + 2]! * y + ctrl.reduce((s, q, i) => s + w[i]! * U(Math.hypot(x - q[0], y - q[1])), 0);
  return [at(wx), at(wy)];
}

// --- geometry helpers ---

/** Keep a ring inside a box (Sutherland–Hodgman), in whatever coordinates it's in. */
function clip(ring: Ring, x0: number, y0: number, x1: number, y1: number): Ring {
  const edges: [(p: Pt) => boolean, (a: Pt, b: Pt) => Pt][] = [
    [(p) => p[0] >= x0, (a, b) => [x0, a[1] + ((b[1] - a[1]) * (x0 - a[0])) / (b[0] - a[0])]],
    [(p) => p[0] <= x1, (a, b) => [x1, a[1] + ((b[1] - a[1]) * (x1 - a[0])) / (b[0] - a[0])]],
    [(p) => p[1] >= y0, (a, b) => [a[0] + ((b[0] - a[0]) * (y0 - a[1])) / (b[1] - a[1]), y0]],
    [(p) => p[1] <= y1, (a, b) => [a[0] + ((b[0] - a[0]) * (y1 - a[1])) / (b[1] - a[1]), y1]],
  ];
  let out = ring;
  for (const [inside, cross] of edges) {
    const input = out;
    out = [];
    for (let i = 0; i < input.length; i++) {
      const a = input[(i + input.length - 1) % input.length]!;
      const b = input[i]!;
      if (inside(b)) {
        if (!inside(a)) out.push(cross(a, b));
        out.push(b);
      } else if (inside(a)) out.push(cross(a, b));
    }
  }
  return out;
}

/** Douglas–Peucker. */
function simplify(pts: Pt[], tol: number): Pt[] {
  if (pts.length < 3) return pts;
  let worst = 0;
  let at = 0;
  const [a, b] = [pts[0]!, pts.at(-1)!];
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i]!;
    const d = Math.abs((b[0] - a[0]) * (a[1] - p[1]) - (a[0] - p[0]) * (b[1] - a[1])) / len;
    if (d > worst) [worst, at] = [d, i];
  }
  if (worst <= tol) return [a, b];
  return [...simplify(pts.slice(0, at + 1), tol).slice(0, -1), ...simplify(pts.slice(at), tol)];
}

/** Douglas–Peucker for a closed ring: split at the point farthest from the first, simplify both halves. */
function simplifyRing(r: Ring, tol: number): Ring {
  if (r.length < 4) return r;
  let far = 1;
  for (let i = 1; i < r.length; i++) if (Math.hypot(r[i]![0] - r[0]![0], r[i]![1] - r[0]![1]) > Math.hypot(r[far]![0] - r[0]![0], r[far]![1] - r[0]![1])) far = i;
  return [...simplify(r.slice(0, far + 1), tol).slice(0, -1), ...simplify([...r.slice(far), r[0]!], tol).slice(0, -1)];
}

const area = (r: Ring) => Math.abs(r.reduce((s, p, i) => s + p[0] * r[(i + 1) % r.length]![1] - r[(i + 1) % r.length]![0] * p[1], 0)) / 2;
const MARGIN = 30;
const BOX = [VIEWBOX.x - MARGIN, VIEWBOX.y - MARGIN, VIEWBOX.x + VIEWBOX.w + MARGIN, VIEWBOX.y + VIEWBOX.h + MARGIN] as const;
/** Real-world area worth bending (wider than the board shows). */
const LONLAT = [-136, 21, -58, 58] as const;

/** A GeoJSON ring (lon, lat) onto the board, clipped, simplified; null if it's gone or tiny. */
function project(coords: number[][], closed: boolean, minArea = 4): Ring | null {
  let ring: Ring = coords.map(([lon, lat]) => [lon!, lat!]);
  // GeoJSON repeats a ring's first point at the end; the ring is closed anyway.
  if (closed && ring.length > 1 && ring[0]![0] === ring.at(-1)![0] && ring[0]![1] === ring.at(-1)![1]) ring = ring.slice(0, -1);
  if (closed) ring = clip(ring, LONLAT[0], LONLAT[1], LONLAT[2], LONLAT[3]);
  if (ring.length < 2) return null;
  // Densify long edges so the warp bends them too.
  const dense: Ring = [];
  ring.forEach((p, i) => {
    const q = ring[i + 1] ?? (closed ? ring[0]! : null);
    dense.push(p);
    if (!q) return;
    const steps = Math.ceil(Math.hypot(q[0] - p[0], q[1] - p[1]) / 0.25);
    for (let k = 1; k < steps; k++) dense.push([p[0] + ((q[0] - p[0]) * k) / steps, p[1] + ((q[1] - p[1]) * k) / steps]);
  });
  let out: Ring = dense.map(([lon, lat]) => warp([lat, lon]));
  if (closed) out = clip(out, ...BOX);
  out = closed ? simplifyRing(out, 0.6) : simplify(out, 0.6);
  if (closed && (out.length < 3 || area(out) < minArea)) return null;
  if (!closed && out.length < 2) return null;
  return out;
}

const fmt = (r: Ring, closed: boolean) => `M${r.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join("L")}${closed ? "Z" : ""}`;
const polygons = (g: { type: string; coordinates: unknown }) => (g.type === "Polygon" ? [g.coordinates as number[][][]] : (g.coordinates as number[][][][]));

// Countries: the US as home, the rest shaded as abroad.
const countries = read("ne_50m_admin_0_countries").features as { properties: { ADM0_A3: string }; geometry: { type: string; coordinates: unknown } }[];
const land: { id: string; d: string }[] = [];
for (const id of ["USA", "CAN", "MEX", "CUB", "BHS"]) {
  const f = countries.find((c) => c.properties.ADM0_A3 === id)!;
  const rings = polygons(f.geometry).flatMap((poly) => {
    const r = project(poly[0]!, true);
    return r ? [r] : [];
  });
  if (rings.length) land.push({ id, d: rings.map((r) => fmt(r, true)).join("") });
}

// Lakes big enough to see on the board.
const lakes = (read("ne_50m_lakes").features as { properties: { name: string }; geometry: { type: string; coordinates: unknown } }[]).flatMap((f) =>
  polygons(f.geometry).flatMap((poly) => {
    const r = project(poly[0]!, true, 120);
    return r ? [{ name: f.properties.name, d: fmt(r, true) }] : [];
  }),
);

// Land borders between the US and its neighbours.
const borders = (read("ne_50m_admin_0_boundary_lines_land").features as { properties: Record<string, string>; geometry: { type: string; coordinates: unknown } }[])
  .flatMap((f) => (f.geometry.type === "LineString" ? [f.geometry.coordinates as number[][]] : (f.geometry.coordinates as number[][][])))
  // The lines carry no country codes; the only land borders in this part of the world are the US's.
  .filter((line) => line.every(([lon, lat]) => lon! >= LONLAT[0] && lon! <= LONLAT[2] && lat! >= LONLAT[1] && lat! <= LONLAT[3]))
  .flatMap((line) => {
    const r = project(line, false);
    return r ? [fmt(r, false)] : [];
  });

// How well the warp keeps the cities where the board has them.
const misses = CITIES.map((c) => {
  const [x, y] = warp(REAL[c.id]!);
  return { id: c.id, off: Math.hypot(x - c.x, y - c.y) };
}).sort((a, b) => b.off - a.off);
console.log("largest city offsets (board px):", misses.slice(0, 6).map((m) => `${m.id} ${m.off.toFixed(1)}`).join(", "));
console.log(`land: ${land.map((l) => `${l.id} ${l.d.length}`).join(", ")}; lakes: ${lakes.map((l) => l.name).join(", ")}; borders: ${borders.length}`);

const out = `/**
 * Coastlines, lakes and borders for the Ticket to Ride board. Generated by
 * tools/ttr-geography.ts from Natural Earth (public domain): real outlines, bent so
 * the cities sit where the board has them. Don't edit by hand.
 */
export const LAND: { id: string; d: string }[] = ${JSON.stringify(land, null, 1)};

export const LAKES: { name: string; d: string }[] = ${JSON.stringify(lakes, null, 1)};

export const BORDERS: string[] = ${JSON.stringify(borders, null, 1)};
`;
writeFileSync(new URL("../src/games/ticket/ui/geography.ts", import.meta.url), out);
