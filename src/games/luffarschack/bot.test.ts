import { describe, expect, it } from "vitest";
import { seededRandomInt } from "../kit/testing";
import { choose, threats } from "./bot";
import { parseSquare, squareName } from "./rules";

const N = 15;
/** A 15×15 board with these marks, the rest empty. */
function sheet(x: string[], o: string[]): string {
  const cells = Array.from({ length: N * N }, () => ".");
  for (const s of x) cells[parseSquare(s, N)!] = "x";
  for (const s of o) cells[parseSquare(s, N)!] = "o";
  return cells.join("");
}
const empties = (board: string) => [...board].flatMap((c, i) => (c === "." ? [i] : []));
const pick = (board: string, me: "x" | "o", seed = 1) => squareName(N, choose(board, N, me, empties(board), seededRandomInt(seed)));
const picks = (board: string, me: "x" | "o") => new Set(Array.from({ length: 8 }, (_, i) => pick(board, me, i + 1)));

describe("luffarschack bot", () => {
  it("takes five rather than blocking", () => {
    // x has D5–G5 open on the left; o has four down column J.
    const b = sheet(["D5", "E5", "F5", "G5", "B2"], ["J3", "J4", "J5", "J6", "L9"]);
    for (const s of picks(b, "x")) expect(["C5", "H5"]).toContain(s);
  });

  it("blocks a four", () => {
    // o has a broken four on row 8 (E8 F8 _ H8 I8): x must take G8.
    const b = sheet(["E9", "F10", "D3"], ["E8", "F8", "H8", "I8"]);
    expect(picks(b, "x")).toEqual(new Set(["G8"]));
  });

  it("blocks an open three at an end", () => {
    const b = sheet(["E10", "K3"], ["F7", "G7", "H7"]);
    for (const s of picks(b, "x")) expect(["E7", "I7"]).toContain(s);
  });

  it("makes an open four from its own open three instead of blocking theirs", () => {
    const b = sheet(["F7", "G7", "H7"], ["F9", "G9", "H9", "C3"]);
    expect(threats(b, N, "x").openFour.length).toBeGreaterThan(0);
    for (const s of picks(b, "x")) expect(["E7", "I7"]).toContain(s);
  });

  it("finds a win by fours", () => {
    // x: two threes meeting at H8 (E8 F8 G8 and H5 H6 H7), each blocked at one end by o, so neither is an open three;
    // H8 makes two fours at once, which o can't both block.
    const b = sheet(["E8", "F8", "G8", "H5", "H6", "H7", "B2"], ["D8", "H4", "M12", "M13"]);
    const s = pick(b, "x");
    expect(s).toBe("H8");
  });

  it("takes six in a row as a win, over blocking", () => {
    // x has A3 B3 C3 _ E3 F3: D3 makes six in a row, which wins; o's diagonal four (finished at O14) can wait.
    const b = sheet(["A3", "B3", "C3", "E3", "F3", "J9"], ["K10", "L11", "M12", "N13"]);
    expect(threats(b, N, "x").five).toEqual([parseSquare("D3", N)]);
    expect(threats(b, N, "o").five).toEqual([parseSquare("O14", N)]);
    expect(pick(b, "x")).toBe("D3");
  });

  it("opens in the middle and varies", () => {
    const empty = ".".repeat(N * N);
    const firsts = new Set(Array.from({ length: 20 }, (_, i) => pick(empty, "x", i + 1)));
    for (const s of firsts) expect(["G7", "H7", "I7", "G8", "H8", "I8", "G9", "H9", "I9"]).toContain(s);
    expect(firsts.size).toBeGreaterThan(1);
  });

  it("decides quickly on a crowded 25×25 sheet", () => {
    const n = 25;
    const rand = seededRandomInt(3);
    let board = ".".repeat(n * n);
    for (let i = 0; i < 120; i++) {
      const open = empties(board).filter((c) => Math.abs((c % n) - 12) < 8 && Math.abs(Math.floor(c / n) - 12) < 8);
      const c = open[rand(open.length)]!;
      board = board.slice(0, c) + (i % 2 ? "o" : "x") + board.slice(c + 1);
    }
    const start = performance.now();
    choose(board, n, "x", empties(board), rand);
    expect(performance.now() - start).toBeLessThan(150);
  });
});
