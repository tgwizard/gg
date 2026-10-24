import { describe, expect, it } from "vitest";
import { circlePath, crossPaths, loopPath, markSeed } from "./ink";

/** Every point named in a path (start, control and end points). */
const points = (d: string) => {
  const n = d.match(/-?\d+(\.\d+)?/g)!.map(Number);
  return Array.from({ length: n.length / 2 }, (_, i) => [n[2 * i]!, n[2 * i + 1]!] as const);
};

describe("hand-drawn ink", () => {
  it("draws the same mark from the same seed, and a different one from another", () => {
    const seed = markSeed(1, 4, 120);
    expect(crossPaths(seed)).toEqual(crossPaths(seed));
    expect(circlePath(seed)).toBe(circlePath(seed));
    expect(circlePath(seed)).not.toBe(circlePath(markSeed(1, 5, 120)));
    expect(markSeed(1, 4, 120)).not.toBe(markSeed(2, 4, 120));
    // Marks stay inside their square, give or take a flick.
    for (let s = 0; s < 50; s++) for (const d of [...crossPaths(s), circlePath(s)]) for (const [x, y] of points(d)) expect(Math.max(Math.abs(x - 50), Math.abs(y - 50))).toBeLessThan(50);
  });

  it("loops round a winning line in any direction, clear of its marks", () => {
    const lines: [[number, number], [number, number]][] = [
      [[50, 50], [450, 50]], // across
      [[50, 50], [50, 450]], // down
      [[50, 50], [450, 450]], // diagonal
      [[450, 50], [50, 450]], // the other diagonal
      [[50, 50], [550, 50]], // six
    ];
    for (const [a, b] of lines) {
      for (let seed = 0; seed < 20; seed++) {
        const d = loopPath(seed, a, b);
        expect(loopPath(seed, a, b)).toBe(d);
        // In the line's own frame: the loop reaches past both end marks and wider than the marks on both sides.
        const angle = Math.atan2(b[1] - a[1], b[0] - a[0]);
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        const local = points(d).map(([x, y]) => {
          const [u, v] = [x - a[0], y - a[1]];
          return [u * Math.cos(angle) + v * Math.sin(angle), -u * Math.sin(angle) + v * Math.cos(angle)] as const;
        });
        const along = local.map(([u]) => u);
        const across = local.map(([, v]) => v);
        expect(Math.min(...along)).toBeLessThan(-35);
        expect(Math.max(...along)).toBeGreaterThan(len + 35);
        expect(Math.min(...across)).toBeLessThan(-35);
        expect(Math.max(...across)).toBeGreaterThan(35);
        // Near the middle of the line, nothing of the loop crosses the marks.
        for (const [u, v] of local) if (u > 50 && u < len - 50) expect(Math.abs(v)).toBeGreaterThan(30);
      }
    }
  });
});
