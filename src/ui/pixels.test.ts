import { describe, expect, it } from "vitest";
import { drawPond, drawTable, onTable } from "../games/kit/ui/tableArt";
import { ICONS, iconPaths, PALETTE } from "./icons";
import { dither, rasterize, superellipse } from "./pixels";

describe("rasterize", () => {
  it("merges horizontal runs into one path per color", () => {
    const paths = rasterize(4, 2, (x, y) => (y === 0 ? (x < 3 ? "a" : null) : "b"));
    expect(paths).toEqual([
      { fill: "a", d: "M0 0h3v1h-3z" },
      { fill: "b", d: "M0 1h4v1h-4z" },
    ]);
  });
});

describe("dither", () => {
  it("covers the whole palette and stays in range", () => {
    const seen = new Set<number>();
    for (let v = -0.2; v <= 1.2; v += 0.05) for (let x = 0; x < 4; x++) for (let y = 0; y < 4; y++) seen.add(dither(v, 5, x, y));
    expect([...seen].sort()).toEqual([0, 1, 2, 3, 4]);
  });
});

describe("superellipse", () => {
  it("measures distance to the outline in cells, evenly on long and short sides", () => {
    // 40x20 ellipse: one cell in from the left edge and from the top edge.
    const left = superellipse(1, 10, 20, 10.5, 20, 10, 2);
    const top = superellipse(19.5, 1, 20, 10.5, 20, 10, 2);
    expect(left.edge).toBeCloseTo(1.5, 0);
    expect(top.edge).toBeCloseTo(1, 0);
    expect(superellipse(-1, 10, 20, 10.5, 20, 10, 2).edge).toBeLessThan(0);
  });
});

describe("table art", () => {
  it("draws tables and ponds at any size without throwing", () => {
    for (const [c, r] of [[8, 6], [150, 80], [60, 120]] as const) {
      expect(drawTable(c, r).length).toBeGreaterThan(0);
      expect(drawPond(c, r).length).toBeGreaterThan(0);
    }
  });

  it("puts seats on the outline: bottom, left, top, right", () => {
    expect(onTable(Math.PI / 2, 1).x).toBeCloseTo(50);
    expect(onTable(Math.PI / 2, 1).y).toBeCloseTo(100);
    expect(onTable(Math.PI, 1).x).toBeCloseTo(0);
    expect(onTable(-Math.PI / 2, 1).y).toBeCloseTo(0);
    expect(onTable(0, 0.5).x).toBeCloseTo(75);
  });
});

describe("icons", () => {
  it("use only palette colors", () => {
    for (const [name, rows] of Object.entries(ICONS)) {
      for (const row of rows) for (const ch of row) expect(ch === "." || ch in PALETTE, `${name}: "${ch}"`).toBe(true);
      expect(iconPaths(rows).length).toBeGreaterThan(0);
    }
  });
});
