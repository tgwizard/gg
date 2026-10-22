import { describe, expect, it } from "vitest";
import { hash2 } from "../../../ui/hash";
import { onTable } from "./layout";

describe("onTable", () => {
  it("puts seats on the outline: bottom, left, top, right", () => {
    expect(onTable(Math.PI / 2, 1).x).toBeCloseTo(50);
    expect(onTable(Math.PI / 2, 1).y).toBeCloseTo(100);
    expect(onTable(Math.PI, 1).x).toBeCloseTo(0);
    expect(onTable(-Math.PI / 2, 1).y).toBeCloseTo(0);
    expect(onTable(0, 0.5).x).toBeCloseTo(75);
  });
});

describe("hash2", () => {
  it("is deterministic and in [0, 1)", () => {
    expect(hash2(3, 4)).toBe(hash2(3, 4));
    for (let i = 0; i < 100; i++) {
      const v = hash2(i, 1);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});
