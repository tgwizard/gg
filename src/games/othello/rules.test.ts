import { describe, expect, it } from "vitest";
import { count, flipsFor, legalMoves, parseSquare, play, squareName, START_BOARD } from "./rules";

const names = (sqs: number[]) => sqs.map(squareName).sort();
/** A board from 8 rows, top first. */
const board = (...rows: string[]) => rows.join("");

describe("othello rules", () => {
  it("names squares from the top left", () => {
    expect(squareName(0)).toBe("a1");
    expect(squareName(63)).toBe("h8");
    expect(parseSquare("d5")).toBe(35);
    expect(parseSquare("i1")).toBeNull();
    expect(START_BOARD[parseSquare("d4")!]).toBe("w");
    expect(START_BOARD[parseSquare("e4")!]).toBe("b");
    expect(count(START_BOARD)).toEqual({ b: 2, w: 2, empty: 60 });
  });

  it("opens with Black's four moves", () => {
    expect(names(legalMoves(START_BOARD, "b"))).toEqual(["c4", "d3", "e6", "f5"]);
    expect(names(legalMoves(START_BOARD, "w"))).toEqual(["c5", "d6", "e3", "f4"]);
  });

  it("turns over every trapped line at once, and nothing past a gap", () => {
    const b = board(
      "........",
      "........",
      "..w.w...",
      "...ww...",
      "..wwX.wb",
      "....w...",
      "....b...",
      "........",
    ).replace("X", ".");
    // From e5: up through e4 to e3 (white, no black end: nothing), down through e6 to e7 (black end), left through d5, c5 (no end).
    expect(names(flipsFor(b, "b", parseSquare("e5")!))).toEqual(["e6"]);
    const { board: after, flips } = play(b, "b", parseSquare("e5")!);
    expect(names(flips)).toEqual(["e6"]);
    expect(after[parseSquare("e5")!]).toBe("b");
    expect(after[parseSquare("e6")!]).toBe("b");
    expect(after[parseSquare("g5")!]).toBe("w"); // f5 is a gap
    expect(() => play(b, "b", parseSquare("a1")!)).toThrow();
  });

  it("flips in several directions, diagonals too", () => {
    const b = board(
      "b..b..b.",
      ".w.w.w..",
      "..www...",
      "bww.wwwb",
      "..www...",
      ".w.w.w..",
      "b..b..b.",
      "........",
    );
    // Two in each of seven directions, three to the right.
    expect(flipsFor(b, "b", parseSquare("d4")!)).toHaveLength(17);
    expect(flipsFor(b, "w", parseSquare("d4")!)).toHaveLength(0);
    expect(flipsFor(b, "b", parseSquare("a1")!)).toHaveLength(0); // taken
  });
});
