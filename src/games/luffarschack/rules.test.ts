import { describe, expect, it } from "vitest";
import { anyFive, count, emptyBoard, fiveThrough, parseSquare, place, squareName, winningRuns } from "./rules";

const N = 9;
/** A 9×9 board from rows, top first. */
const board = (...rows: string[]) => rows.join("");
const sq = (name: string) => parseSquare(name, N)!;

describe("luffarschack rules", () => {
  it("names squares like a spreadsheet: a column letter and a row from 1 at the top", () => {
    expect(squareName(19, 0)).toBe("A1");
    expect(squareName(19, 19 * 19 - 1)).toBe("S19");
    expect(squareName(25, 24)).toBe("Y1");
    expect(parseSquare("A1", 19)).toBe(0);
    expect(parseSquare("j10", 19)).toBe(9 * 19 + 9);
    expect(parseSquare("T1", 19)).toBeNull();
    expect(parseSquare("A20", 19)).toBeNull();
    expect(parseSquare("A0", 19)).toBeNull();
    expect(parseSquare("AA1", 25)).toBeNull();
    for (let cell = 0; cell < 625; cell += 37) expect(parseSquare(squareName(25, cell), 25)).toBe(cell);
  });

  it("finds five in every direction, through the mark that made it", () => {
    const b = board(
      ".........",
      ".x.......",
      "..x......",
      "...x.....",
      "....x....",
      ".....x...",
      ".........",
      "oooo.....",
      ".........",
    );
    expect(winningRuns(b, N, sq("D4"))).toEqual([[sq("B2"), sq("F6")]]);
    expect(fiveThrough(b, N, sq("F6"))).toEqual(["B2", "C3", "D4", "E5", "F6"].map(sq));
    expect(fiveThrough(b, N, sq("A8"))).toEqual([]);
    expect(anyFive(b, N)).toBe(true);
    const across = place(b, sq("E8"), "o");
    expect(winningRuns(across, N, sq("E8"))).toEqual([[sq("A8"), sq("E8")]]);
    const down = board(".........", ".........", "........o", "........o", "........o", "........o", "........o", ".........", ".........");
    expect(fiveThrough(down, N, sq("I5"))).toHaveLength(5);
    const up = board(".........", ".........", "....x....", "...x.....", "..x......", ".x.......", "x........", ".........", ".........");
    expect(winningRuns(up, N, sq("A7"))).toEqual([[sq("E3"), sq("A7")]]);
    expect(anyFive(emptyBoard(N), N)).toBe(false);
  });

  it("counts six or more in a row too", () => {
    const six = board(".........", ".xxxxxx..", ".........", ".........", ".........", ".........", ".........", ".........", ".........");
    expect(fiveThrough(six, N, sq("D2"))).toHaveLength(6);
    expect(winningRuns(six, N, sq("G2"))).toEqual([[sq("B2"), sq("G2")]]);
    const four = board(".........", ".xxxx....", ".........", ".........", ".........", ".........", ".........", ".........", ".........");
    expect(anyFive(four, N)).toBe(false);
  });

  it("gives both lines when one mark finishes two", () => {
    const b = board(
      "....x....",
      "....x....",
      "....x....",
      "....x....",
      "xxxxx....",
      ".........",
      ".........",
      ".........",
      ".........",
    );
    expect(winningRuns(b, N, sq("E5"))).toEqual([
      [sq("A5"), sq("E5")],
      [sq("E1"), sq("E5")],
    ]);
    expect(fiveThrough(b, N, sq("E5"))).toHaveLength(9);
    expect(count(b)).toEqual({ x: 9, o: 0, empty: 72 });
  });
});
