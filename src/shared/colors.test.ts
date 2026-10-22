import { describe, expect, it } from "vitest";
import { assignColors, COLOR_COUNT, PLAYER_COLORS } from "./colors";

describe("assignColors", () => {
  it("gives the first member with a color that color, and later ones the next free one", () => {
    const got = assignColors([
      { id: "a", preferred: 3 },
      { id: "b", preferred: 3 },
      { id: "c", preferred: 4 },
      { id: "d", preferred: 3 },
    ]);
    expect([...got.values()]).toEqual([3, 4, 5, 6]);
  });

  it("wraps around the palette", () => {
    const got = assignColors([
      { id: "a", preferred: COLOR_COUNT - 1 },
      { id: "b", preferred: COLOR_COUNT - 1 },
    ]);
    expect(got.get("b")).toBe(0);
  });

  it("honors preferences once every color is taken, and fixes bad input", () => {
    const many = Array.from({ length: COLOR_COUNT }, (_, i) => ({ id: `p${i}`, preferred: i }));
    const got = assignColors([...many, { id: "late", preferred: 7 }, { id: "bad", preferred: 99 }]);
    expect(got.get("late")).toBe(7);
    expect(got.get("bad")).toBe(0);
  });

  it("has distinct colors", () => {
    expect(new Set(PLAYER_COLORS.map((c) => c.hex)).size).toBe(COLOR_COUNT);
  });
});
