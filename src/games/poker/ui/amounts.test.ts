import { describe, expect, it } from "vitest";
import { betStops } from "./amounts";

describe("bet stops", () => {
  it("are the minimum, the multiples of the step between, and all-in", () => {
    const s = betStops(23, 61, 10);
    expect(Array.from({ length: s.count }, (_, i) => s.at(i))).toEqual([23, 30, 40, 50, 60, 61]);
    expect(s.indexOf(23)).toBe(0);
    expect(s.indexOf(45)).toBe(2); // 40: the stop at or under it
    expect(s.indexOf(61)).toBe(5);
  });

  it("step up and down to the next round amount, and stop at the ends", () => {
    const s = betStops(23, 61, 10);
    expect(s.up(23)).toBe(30);
    expect(s.up(45)).toBe(50);
    expect(s.up(60)).toBe(61);
    expect(s.up(61)).toBe(61);
    expect(s.down(61)).toBe(60);
    expect(s.down(45)).toBe(40);
    expect(s.down(30)).toBe(23);
    expect(s.down(23)).toBe(23);
    expect(s.up(5)).toBe(23);
    expect(s.down(500)).toBe(61);
  });

  it("handle a minimum that's already round, and no room to raise", () => {
    const s = betStops(20, 50, 5);
    expect(Array.from({ length: s.count }, (_, i) => s.at(i))).toEqual([20, 25, 30, 35, 40, 45, 50]);
    const none = betStops(80, 80, 5);
    expect(none.count).toBe(1);
    expect(none.up(80)).toBe(80);
  });
});
