import { PLAYER_COLORS } from "../../../shared/colors";

/**
 * Marks are inked in their players' colors at a pen's lightness (see `.lfs-mark` and the
 * `--lfs-ink-*` tokens): dark on light paper, light on the dark-mode paper. That squeezes
 * the palette together: Caramel and Mustard, far enough apart as colors, come out as the
 * same brown ink. So two players' inks are compared as inks, in both modes, and if they're
 * too alike the other side gets the palette color whose ink is furthest from the kept one.
 */

/** The ink lightness range and chroma scale per mode, as in tokens.css (`--lfs-ink-lmin`, `--lfs-ink-lmax`, `--lfs-ink-chroma`). */
export const INK = {
  light: { lmin: 0.3, lmax: 0.5, chroma: 1.05 },
  dark: { lmin: 0.8, lmax: 0.88, chroma: 0.85 },
} as const;

/** Below this (in OKLab, in either mode) two inks are too alike to tell apart at a glance. */
export const TOO_CLOSE = 0.08;

const labs = PLAYER_COLORS.map((c) => oklab(c.hex));

function inkLab(color: number, mode: keyof typeof INK): [number, number, number] {
  const [l, a, b] = labs[color] ?? labs[0]!;
  const ink = INK[mode];
  return [Math.min(ink.lmax, Math.max(ink.lmin, l)), a * ink.chroma, b * ink.chroma];
}

/** How far apart two palette colors are as ink: the nearer of light and dark mode. */
export function inkDistance(p: number, q: number): number {
  return Math.min(
    ...(["light", "dark"] as const).map((mode) => {
      const [u, v] = [inkLab(p, mode), inkLab(q, mode)];
      return Math.hypot(u[0] - v[0], u[1] - v[1], u[2] - v[2]);
    }),
  );
}

/**
 * The palette colors to ink each side's marks in, from the players' colors. `keep` keeps
 * its own when they clash (yours, if you're playing).
 */
export function inkColors(colors: { x: number; o: number }, keep: "x" | "o"): { x: number; o: number } {
  if (inkDistance(colors.x, colors.o) >= TOO_CLOSE) return colors;
  const kept = colors[keep];
  let far = kept;
  for (let i = 0; i < PLAYER_COLORS.length; i++) if (inkDistance(kept, i) > inkDistance(kept, far)) far = i;
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
