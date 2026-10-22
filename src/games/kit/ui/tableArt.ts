/**
 * Pixel-art drawings for card tables: an oval table with a wooden rail and gilt trim on a
 * dithered felt, and a pond (Finns i sjön's lake). Pure functions of the grid size.
 */
import { checker, dither, hash2, type PixelPaths, rasterize, superellipse } from "../../../ui/pixels";

export type Felt = "emerald" | "azure" | "crimson";

const FELTS: Record<Felt, { shades: string[]; edge: string; ring: string }> = {
  emerald: { shades: ["#2f8664", "#297a5a", "#236d50", "#1d5f45", "#17513b", "#124330"], edge: "#0d2f22", ring: "#3f9c76" },
  azure: { shades: ["#3a6fa8", "#33639a", "#2c578b", "#264b7b", "#20406b", "#1a355b"], edge: "#11233d", ring: "#4f86c0" },
  crimson: { shades: ["#9a3a3a", "#8b3333", "#7b2d2d", "#6b2727", "#5b2121", "#4b1b1b"], edge: "#2e1010", ring: "#b24d4d" },
};
const WOOD = ["#4a2c1a", "#5e3923", "#74482c", "#8c5a37"];
const RAIL_OUTLINE = "#140c08";
const GILT = "#e6b345";
const GILT_LO = "#a26f1d";
const SHADOW = "#17192b";

/** How round the table is: 2 is an ellipse, higher is boxier (a racetrack). */
export const TABLE_EXPONENT = 2.6;

export function drawTable(cols: number, rows: number, felt: Felt = "emerald"): PixelPaths {
  const f = FELTS[felt];
  // Leave a column each side and room below for the shadow.
  const a = cols / 2 - 1;
  const b = (rows - 3) / 2;
  const cx = cols / 2;
  const cy = 1 + b;
  const rail = Math.max(3, Math.round(Math.min(a, b) * 0.1));
  const ringAt = rail + Math.max(3, Math.round(Math.min(a, b) * 0.22));
  const at = (x: number, y: number) => superellipse(x, y, cx, cy, a, b, TABLE_EXPONENT);

  return rasterize(cols, rows, (x, y) => {
    const { nx, ny, edge } = at(x, y);
    if (edge < 0) {
      // A dithered shadow, offset down and right.
      return at(x - 1, y - 2).edge >= 0 && checker(x, y) ? SHADOW : null;
    }
    if (edge < 1) return RAIL_OUTLINE;
    if (edge < rail - 1) {
      // Wood lit from above: lighter on the far side, darker on the near side.
      const light = 0.5 - ny * 0.45 + (edge < 2 ? 0.15 : 0);
      return WOOD[dither(light, WOOD.length, x, y)]!;
    }
    if (edge < rail) return ny < 0.35 ? GILT : GILT_LO;
    if (edge < rail + 1) return f.edge;
    if (edge >= ringAt && edge < ringAt + 1 && checker(x, y)) return f.ring;
    // A lamp over the middle of the table.
    const dist = Math.min(1, Math.hypot(nx * 0.9, ny * 1.1));
    return f.shades[dither(dist ** 1.4, f.shades.length, x, y)]!;
  });
}

const WATER = ["#5bb2d4", "#469fc4", "#3a8fb6", "#2f7fa8", "#266d93", "#1c5677"];

export function drawPond(cols: number, rows: number): PixelPaths {
  const a = cols / 2 - 1;
  const b = rows / 2 - 1;
  const cx = cols / 2;
  const cy = rows / 2;
  return rasterize(cols, rows, (x, y) => {
    const { nx, ny, edge } = superellipse(x, y, cx, cy, a, b, 2.2);
    if (edge < 0) return null;
    if (edge < 1) return "#0c2c3d";
    if (edge < 2) return checker(x, y) ? "#9ad6ea" : "#3a8fb6";
    // Lighter toward the top-left, with the odd glint.
    const depth = Math.min(1, Math.hypot(nx + 0.25, ny + 0.3) * 0.85);
    if (depth < 0.75 && hash2(x, y) < 0.012) return "#d4f0f8";
    return WATER[dither(depth, WATER.length, x, y)]!;
  });
}

/**
 * A point on the table's outline (k = 1) or inside it (k < 1), for a seat at angle θ.
 * Returns percentages of the table's box.
 */
export function onTable(theta: number, k: number): { x: number; y: number } {
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  const e = 2 / TABLE_EXPONENT;
  return { x: 50 + 50 * k * Math.sign(c) * Math.abs(c) ** e, y: 50 + 50 * k * Math.sign(s) * Math.abs(s) ** e };
}
