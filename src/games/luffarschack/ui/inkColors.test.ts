import { describe, expect, it } from "vitest";
import { PLAYER_COLORS } from "../../../shared/colors";
import { inkColors, inkDistance, TOO_CLOSE } from "./inkColors";

const index = (name: string) => PLAYER_COLORS.findIndex((c) => c.name === name);

describe("ink colors", () => {
  it("keeps players' own colors when their inks differ", () => {
    const [tomato, teal, indigo, mustard] = ["Tomato", "Teal", "Indigo", "Mustard"].map(index) as number[];
    expect(inkColors({ x: tomato!, o: teal! }, "x")).toEqual({ x: tomato, o: teal });
    expect(inkColors({ x: indigo!, o: mustard! }, "o")).toEqual({ x: indigo, o: mustard });
  });

  it("splits colors that come out as the same ink, keeping yours", () => {
    const pairs = [["Caramel", "Mustard"], ["Mint", "Forest"], ["Slate", "Charcoal"], ["Lavender", "Indigo"], ["Terracotta", "Orange"], ["Teal", "Forest"], ["Teal", "Teal"]];
    for (const [a, b] of pairs.map((p) => p.map(index) as [number, number])) {
      expect(inkDistance(a, b)).toBeLessThan(TOO_CLOSE);
      for (const keep of ["x", "o"] as const) {
        const got = inkColors({ x: a, o: b }, keep);
        expect(got[keep]).toBe(keep === "x" ? a : b);
        expect(inkDistance(got.x, got.o)).toBeGreaterThan(0.12);
      }
    }
  });

  it("leaves every pair of inks it picks easy to tell apart", () => {
    for (let a = 0; a < PLAYER_COLORS.length; a++) {
      for (let b = 0; b < PLAYER_COLORS.length; b++) {
        const got = inkColors({ x: a, o: b }, "x");
        expect(inkDistance(got.x, got.o)).toBeGreaterThanOrEqual(TOO_CLOSE);
      }
    }
  });
});
