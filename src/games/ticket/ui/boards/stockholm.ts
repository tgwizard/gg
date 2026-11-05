/** How the Stockholm board is drawn: the shores and lakes (generated), and the props on it. */
import type { Board } from "./index";
import { LAKES, LAND } from "./stockholm-geography";
import { STOCKHOLM_VIEWBOX } from "./stockholm-viewbox";

export const STOCKHOLM_BOARD: Board = {
  viewbox: STOCKHOLM_VIEWBOX,
  labels: {},
  land: LAND,
  lakes: LAKES,
  borders: [],
  sea: { cx: 500, cy: 350, r: 640 },
  // Gentle hills all over, a little more in the west.
  relief: [
    [0, 0.45],
    [0.5, 0.3],
    [1, 0.2],
  ],
  mountains: [],
  trees: [],
  cacti: [],
  waves: [],
  compass: { cx: 935, cy: 628 },
  credit: "Shores and lakes © OpenStreetMap contributors",
};
