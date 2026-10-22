/**
 * Tiny rasterizer for pixel-art shapes (tables, ponds…): paint a color per cell, get
 * back one SVG path per color with horizontal runs merged. Pure, so it's unit-tested.
 */
export type PixelPaths = { fill: string; d: string }[];
export type Paint = (x: number, y: number) => string | null;

export function rasterize(cols: number, rows: number, paint: Paint): PixelPaths {
  const byColor = new Map<string, string[]>();
  const row: (string | null)[] = new Array(cols);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) row[x] = paint(x, y);
    let x = 0;
    while (x < cols) {
      const fill = row[x];
      let end = x + 1;
      while (end < cols && row[end] === fill) end++;
      if (fill) {
        let parts = byColor.get(fill);
        if (!parts) byColor.set(fill, (parts = []));
        parts.push(`M${x} ${y}h${end - x}v1h${x - end}z`);
      }
      x = end;
    }
  }
  return [...byColor].map(([fill, parts]) => ({ fill, d: parts.join("") }));
}

const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

/** Ordered (Bayer) dithering: pick an index into a palette of `levels` for a value in [0, 1]. */
export function dither(value: number, levels: number, x: number, y: number): number {
  const threshold = (BAYER4[(y & 3) * 4 + (x & 3)]! + 0.5) / 16;
  const v = Math.min(1, Math.max(0, value)) * (levels - 1);
  return Math.min(levels - 1, Math.floor(v + threshold));
}

export const checker = (x: number, y: number) => ((x + y) & 1) === 0;

/**
 * Where a cell sits relative to a superellipse |x/a|^p + |y/b|^p = 1 centered at (cx, cy):
 * `nx`/`ny` are normalized coordinates, `r` the "radius" (1 on the outline) and `edge`
 * the approximate distance to the outline in cells (negative outside).
 */
export function superellipse(x: number, y: number, cx: number, cy: number, a: number, b: number, p: number) {
  const nx = (x + 0.5 - cx) / a;
  const ny = (y + 0.5 - cy) / b;
  const ax = Math.abs(nx);
  const ay = Math.abs(ny);
  const s = ax ** p + ay ** p;
  const r = s ** (1 / p);
  // |∇r| in cell units, so (1 - r) / |∇r| is a distance in cells that's even all the way round.
  const k = r > 1e-6 ? r ** (1 - p) : 0;
  const grad = k * Math.hypot(ax ** (p - 1) / a, ay ** (p - 1) / b);
  const edge = grad > 1e-9 ? (1 - r) / grad : Infinity;
  return { nx, ny, r, edge };
}

/** A small deterministic hash for sprinkling (glints, specks). */
export function hash2(x: number, y: number): number {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
