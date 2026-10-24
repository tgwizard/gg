import { PLAYER_COLORS } from "../../../shared/colors";

/**
 * Discs come in their players' own colors. A room gives every member a color of their
 * own, but two can still be close (Terracotta and Tomato, Plum and Lavender), or the same
 * (someone who left, a crowded room). Then one side's discs get the palette color that's
 * furthest from the other's instead, so the board always reads at a glance.
 */

/** Below this (in OKLab) two colors are too alike to tell discs apart quickly. */
const TOO_CLOSE = 0.16;

const labs = PLAYER_COLORS.map((c) => oklab(c.hex));

export function colorDistance(a: number, b: number): number {
  const [p, q] = [labs[a] ?? labs[0]!, labs[b] ?? labs[0]!];
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
}

/**
 * The colors to draw each side's discs in, from the players' colors (palette indices).
 * `keep` keeps that one's own color when they clash (yours, if you're playing).
 */
export function discColors(colors: { x: number; o: number }, keep: "x" | "o"): { x: number; o: number } {
  if (colorDistance(colors.x, colors.o) >= TOO_CLOSE) return colors;
  const kept = colors[keep];
  let far = kept;
  for (let i = 0; i < PLAYER_COLORS.length; i++) if (colorDistance(kept, i) > colorDistance(kept, far)) far = i;
  return keep === "x" ? { x: kept, o: far } : { x: far, o: kept };
}

function oklab(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  const lin = (v: number) => ((v /= 255) <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  const [r, g, b] = [lin(n >> 16), lin((n >> 8) & 255), lin(n & 255)];
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}
