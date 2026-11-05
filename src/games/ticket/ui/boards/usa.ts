/** How the North American board is drawn: its shores, lakes and borders, names, and the props on it. */
import type { Board } from "./index";
import type { Label } from "../geometry";
import { BORDERS, LAKES, LAND } from "./usa-geography";

/** Where each city's name goes, relative to it: [dx, dy, text-anchor]. Below, centered, unless it would sit on a track. */
const LABELS: Record<string, Label> = {
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
  BOS: [10, -15, "middle"],
  NYC: [13, 4, "start"],
  WAS: [13, 4, "start"],
  RAL: [13, -4, "start"],
};

const MOUNTAINS: [number, number][] = [
  [196, 262],
  [222, 284],
  [300, 290],
  [318, 312],
  [204, 388],
  [326, 420],
  [446, 240],
  [470, 262],
];
const TREES: [number, number][] = [
  [560, 68],
  [574, 76],
  [618, 84],
  [632, 76],
  [760, 70],
  [774, 78],
  [404, 122],
  [184, 232],
  [197, 240],
  [860, 262],
  [872, 270],
];
const CACTI: [number, number][] = [
  [236, 598],
  [300, 604],
  [352, 596],
  [196, 470],
];
const WAVES: [number, number][] = [
  [34, 300],
  [30, 470],
  [102, 610],
  [560, 612],
  [640, 600],
  [960, 400],
  [972, 250],
  [958, 560],
];

export const USA_BOARD: Board = {
  viewbox: { x: 14, y: 44, w: 982, h: 584 },
  labels: LABELS,
  land: LAND.map((l) => ({ d: l.d, abroad: l.id !== "USA" })),
  lakes: LAKES,
  borders: BORDERS,
  sea: { cx: 505, cy: 330, r: 600 },
  // The hills: strongest over the Rockies, a little over the Appalachians.
  relief: [
    [0, 0.55],
    [0.3, 1],
    [0.48, 0.35],
    [0.62, 0.15],
    [0.8, 0.55],
    [1, 0.3],
  ],
  mountains: MOUNTAINS,
  trees: TREES,
  cacti: CACTI,
  waves: WAVES,
  compass: { cx: 78, cy: 570 },
};
