import { describe, expect, it } from "vitest";
import { GameError } from "../types";
import { clockwiseDistance, emptySeating, nextClockwise, type Seat, seatedPlayers, seatOf, sitDown, standUp } from "./seating";
import { nextTimer, setTimer, takeDueTimer, type Timers } from "./timers";

type ScoreSeat = Seat & { score: number };

describe("seating", () => {
  it("seats, refuses double seating and taken seats, and restores data on return", () => {
    const t = emptySeating<ScoreSeat>(3);
    sitDown(t, "a", 0, () => ({ score: 0 }));
    expect(() => sitDown(t, "a", 1, () => ({ score: 0 }))).toThrow(GameError);
    expect(() => sitDown(t, "b", 0, () => ({ score: 0 }))).toThrow(/taken/);
    expect(() => sitDown(t, "b", 7, () => ({ score: 0 }))).toThrow(/No such seat/);
    t.seats[0]!.score = 5;
    expect(standUp(t, "a")).toBe(0);
    expect(seatOf(t, "a")).toBe(-1);
    sitDown(t, "a", 2, () => ({ score: 0 }));
    expect(t.seats[2]).toEqual({ playerId: "a", sittingOut: false, score: 5 });
    expect(t.away).toEqual({});
    expect(seatedPlayers(t)).toEqual(["a"]);
  });

  it("walks clockwise, wrapping around", () => {
    const items = [{ seat: 1 }, { seat: 4 }, { seat: 7 }];
    expect(nextClockwise(items, 4)!.seat).toBe(7);
    expect(nextClockwise(items, 7)!.seat).toBe(1);
    expect(nextClockwise(items, 8)!.seat).toBe(1);
    expect(nextClockwise(items, 1, (i) => i.seat !== 4)!.seat).toBe(7);
    expect(clockwiseDistance(7, 1, 9)).toBe(3);
    expect(clockwiseDistance(7, 7, 9)).toBe(9);
  });
});

describe("timers", () => {
  it("reports the earliest deadline and takes due ones in order", () => {
    const t: Timers<"turn" | "round"> = {};
    expect(nextTimer(t)).toBeNull();
    setTimer(t, "turn", 200);
    setTimer(t, "round", 100);
    expect(nextTimer(t)).toBe(100);
    expect(takeDueTimer(t, 50)).toBeNull();
    expect(takeDueTimer(t, 300)).toBe("round");
    expect(takeDueTimer(t, 300)).toBe("turn");
    expect(t).toEqual({});
    setTimer(t, "turn", 5);
    setTimer(t, "turn", null);
    expect(nextTimer(t)).toBeNull();
  });
});
