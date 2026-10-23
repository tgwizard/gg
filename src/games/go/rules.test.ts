import { describe, expect, it } from "vitest";
import { areaScore, chainAt, legalPoints, parsePoint, pointName, positionKey, starPoints, tryPlay } from "./rules";

/** A board from rows drawn top first. */
const draw = (...rows: string[]) => rows.join("");
const at = (name: string, size = 5) => parsePoint(name, size)!;

describe("go rules", () => {
  it("names points with a column letter (no I) and the row from the bottom", () => {
    expect(pointName(0, 9)).toBe("A9");
    expect(pointName(80, 9)).toBe("J1");
    expect(pointName(360, 19)).toBe("T1");
    expect(parsePoint("A1", 9)).toBe(72);
    expect(parsePoint("E5", 9)).toBe(40);
    for (const bad of ["I3", "K1", "A10", "A0", "e5"]) expect(parsePoint(bad, 9)).toBeNull();
    expect(starPoints(9).map((p) => pointName(p, 9))).toEqual(["C7", "G7", "E5", "C3", "G3"]);
    expect(starPoints(19)).toHaveLength(9);
  });

  it("finds chains and their liberties", () => {
    const board = draw(".....", ".bb..", ".bw..", ".....", ".....");
    const chain = chainAt(board, at("B4"));
    expect(chain.stones.sort()).toEqual([at("B4"), at("C4"), at("B3")].sort());
    expect(chain.liberties).toHaveLength(6);
  });

  it("captures, refuses suicide, and refuses taking a ko straight back", () => {
    // White's C3 has one liberty left, at D3.
    const board = draw(".....", "..b..", ".bw..", "..b..", ".....");
    const took = tryPlay(board, "b", at("D3"));
    expect(took).toEqual({ board: draw(".....", "..b..", ".b.b.", "..b..", "....."), captured: [at("C3")] });
    // White can't play into C3 now: no liberties and nothing to take.
    if ("illegal" in took) throw new Error("expected a capture");
    expect(tryPlay(took.board, "w", at("C3"))).toEqual({ illegal: "suicide" });
    expect(tryPlay(took.board, "w", at("C4"))).toEqual({ illegal: "occupied" });

    // A ko: Black takes at C3, and White taking back at B3 would repeat the position.
    const ko = draw(".....", ".bw..", "b.bw.", ".bw..", ".....");
    const seen = new Set([positionKey(ko)]);
    const take = tryPlay(ko, "w", at("B3"), seen);
    if ("illegal" in take) throw new Error("expected a capture");
    expect(take.captured).toEqual([at("C3")]);
    seen.add(positionKey(take.board));
    expect(tryPlay(take.board, "b", at("C3"), seen)).toEqual({ illegal: "repeat" });
    expect(legalPoints(take.board, "b", seen)).not.toContain(at("C3"));
    // Without the history it'd be a capture.
    expect(tryPlay(take.board, "b", at("C3"))).toMatchObject({ captured: [at("B3")] });
  });

  it("scores by area: stones, surrounded points, and dead stones taken off", () => {
    const board = draw("..bw.", "..bw.", "..bw.", "..bww", "..bw.");
    expect(areaScore(board)).toMatchObject({ b: 15, w: 10 });
    // A white stone in Black's area, marked dead, counts for Black.
    const invaded = draw(".wbw.", "..bw.", "..bw.", "..bww", "..bw.");
    expect(areaScore(invaded)).toMatchObject({ b: 5, w: 11 });
    const scored = areaScore(invaded, [at("B5")]);
    expect(scored).toMatchObject({ b: 15, w: 10 });
    expect(scored.owner.slice(0, 5)).toBe("bbbww");
  });
});
