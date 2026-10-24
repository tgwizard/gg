import { describe, expect, it } from "vitest";
import { PLAYER_COLORS } from "../../shared/colors";
import { anyFour, cellAt, count, drop, emptyBoard, fourThrough, landing, openColumns, parseSize, rowNumber, settled } from "./rules";
import { colorDistance, discColors } from "./ui/colors";

const size = parseSize("7x6");
/** A board from rows, top first. */
const board = (...rows: string[]) => rows.join("");

describe("four in a row rules", () => {
  it("drops discs to the lowest empty cell and fills columns up", () => {
    expect(parseSize("9x7")).toEqual({ columns: 9, rows: 7 });
    let b = emptyBoard(size);
    expect(landing(b, size, 3)).toBe(cellAt(size, 3, 5));
    expect(rowNumber(size, cellAt(size, 3, 5))).toBe(1);
    for (let i = 0; i < 6; i++) b = drop(b, size, i % 2 ? "o" : "x", 3).board;
    expect(b.slice(3, 4)).toBe("o"); // the top of column 4
    expect(landing(b, size, 3)).toBeNull();
    expect(openColumns(b, size)).toEqual([0, 1, 2, 4, 5, 6]);
    expect(() => drop(b, size, "x", 3)).toThrow(/full/);
    expect(landing(b, size, 7)).toBeNull();
    expect(count(b)).toEqual({ x: 3, o: 3, empty: 36 });
    expect(settled(b, size)).toBe(true);
  });

  it("finds four in every direction, through the disc that made it", () => {
    const b = board(
      ".......",
      ".......",
      "...x...",
      "..xo...",
      ".xoo...",
      "xooox..",
    );
    // The diagonal from a1 to d4.
    const at = cellAt(size, 3, 2);
    expect(fourThrough(b, size, at)).toEqual([cellAt(size, 3, 2), cellAt(size, 2, 3), cellAt(size, 1, 4), cellAt(size, 0, 5)].sort((a, b) => a - b));
    expect(fourThrough(b, size, cellAt(size, 1, 5))).toEqual([]); // o's three in the bottom row
    expect(anyFour(b, size)).toBe(true);
    const across = board(".......", ".......", ".......", ".......", ".......", ".ooooo.");
    expect(fourThrough(across, size, cellAt(size, 3, 5))).toHaveLength(5);
    const up = board(".......", ".......", "x......", "x......", "x......", "x......");
    expect(fourThrough(up, size, cellAt(size, 0, 2))).toHaveLength(4);
    const other = board(".......", ".......", "...o...", "....o..", ".....o.", "......o");
    expect(fourThrough(other, size, cellAt(size, 6, 5))).toHaveLength(4);
    expect(anyFour(emptyBoard(size), size)).toBe(false);
  });

  it("gives both lines when one disc finishes two", () => {
    const b = board(
      ".......",
      ".......",
      "...x...",
      "...x...",
      "...x...",
      "xxxx...",
    );
    expect(fourThrough(b, size, cellAt(size, 3, 5))).toHaveLength(7);
  });

  it("knows a floating disc", () => {
    expect(settled(board(".......", ".......", ".......", ".......", "x......", "......."), size)).toBe(false);
  });
});

describe("disc colors", () => {
  it("keeps players' own colors unless they're too alike, then keeps yours", () => {
    const index = (name: string) => PLAYER_COLORS.findIndex((c) => c.name === name);
    const [tomato, terracotta, teal, plum, lavender] = ["Tomato", "Terracotta", "Teal", "Plum", "Lavender"].map(index) as number[];
    expect(discColors({ x: tomato!, o: teal! }, "x")).toEqual({ x: tomato, o: teal });
    for (const [a, b] of [[tomato!, terracotta!], [plum!, lavender!], [teal!, teal!]]) {
      for (const keep of ["x", "o"] as const) {
        const got = discColors({ x: a!, o: b! }, keep);
        expect(got[keep]).toBe(keep === "x" ? a : b);
        expect(colorDistance(got.x, got.o)).toBeGreaterThan(0.25);
      }
    }
  });
});
