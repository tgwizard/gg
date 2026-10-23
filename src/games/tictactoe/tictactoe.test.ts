import { describe, expect, it } from "vitest";
import { seededRandomInt } from "../kit/testing";
import type { GameContext } from "../types";
import { NEXT_ROUND_DELAY_MS, type TttState, ticTacToe as game } from "./index";

function setup(turnSeconds = 30) {
  const announcements: string[] = [];
  const ctx = (now = 0): GameContext => ({ now, randomInt: seededRandomInt(1), nameOf: (id) => id, announce: (t) => announcements.push(t) });
  const state = game.create({ turnSeconds }, ctx());
  game.apply(state, "x", { type: "sit", seat: 0 }, ctx());
  game.apply(state, "o", { type: "sit", seat: 1 }, ctx());
  return { state, ctx, announcements };
}

const play = (state: TttState, ctx: () => GameContext, moves: [string, number][]) => {
  for (const [who, cell] of moves) game.apply(state, who, { type: "place", cell }, ctx());
};

describe("tic-tac-toe", () => {
  it("starts when both seats fill, detects a win, and scores it", () => {
    const { state, ctx, announcements } = setup();
    expect(state.status).toBe("playing");
    expect(game.waitingOn(state)).toEqual(["x"]);
    play(state, ctx, [["x", 0], ["o", 3], ["x", 1], ["o", 4], ["x", 2]]);
    expect(state.status).toBe("over");
    expect(state.result).toEqual({ winner: 0, line: [0, 1, 2], forfeit: false });
    expect(state.seats[0]!.wins).toBe(1);
    expect(announcements.at(-1)).toBe("Round 1: x wins as X.");
  });

  it("rejects moves out of turn and onto taken squares", () => {
    const { state, ctx } = setup();
    expect(() => game.apply(state, "o", { type: "place", cell: 0 }, ctx())).toThrow(/not your turn/);
    game.apply(state, "x", { type: "place", cell: 4 }, ctx());
    expect(() => game.apply(state, "o", { type: "place", cell: 4 }, ctx())).toThrow(/taken/);
    expect(() => game.apply(state, "spectator", { type: "place", cell: 0 }, ctx())).toThrow(/not seated/);
  });

  it("scores draws and alternates who opens", () => {
    const { state, ctx } = setup();
    play(state, ctx, [["x", 0], ["o", 1], ["x", 2], ["o", 4], ["x", 3], ["o", 5], ["x", 7], ["o", 6], ["x", 8]]);
    expect(state.result!.winner).toBeNull();
    expect(state.draws).toBe(1);
    game.onDeadline!(state, ctx(NEXT_ROUND_DELAY_MS));
    expect(state.round).toBe(2);
    expect(game.waitingOn(state)).toEqual(["o"]);
  });

  it("forfeits on timeout or leaving mid-round, and keeps scores across re-seating", () => {
    const { state, ctx, announcements } = setup(10);
    game.onDeadline!(state, ctx(10_000));
    expect(state.result).toMatchObject({ winner: 1, forfeit: true });
    // Running out of time gives up the seat: no next round until someone takes it.
    expect(announcements.at(-1)).toBe("x ran out of time and left the table.");
    expect(game.players(state)).toEqual(["o"]);
    expect(game.nextDeadline!(state)).toBeNull();
    game.apply(state, "x", { type: "sit", seat: 0 }, ctx(15_000));
    game.apply(state, "x", { type: "leave" }, ctx(20_000)); // o opens round 2, x leaves: o wins again
    expect(state.seats[1]!.wins).toBe(2);
    game.apply(state, "o", { type: "leave" }, ctx(20_000));
    game.apply(state, "o", { type: "sit", seat: 0 }, ctx(20_000));
    expect(state.seats[0]!.wins).toBe(2);
    expect(game.players(state)).toEqual(["o"]);
  });

  it("doesn't play on by itself when nobody's moving", () => {
    const { state, ctx } = setup(1);
    for (let t = 1; t < 100 && game.nextDeadline!(state) !== null; t++) game.onDeadline!(state, ctx(game.nextDeadline!(state)!));
    expect(state.round).toBe(1);
    expect(game.nextDeadline!(state)).toBeNull();
  });

  it("removes a player for good like leaving, and keeps only so many who left", () => {
    const { state, ctx } = setup();
    game.removePlayer(state, "x", ctx());
    expect(game.players(state)).toEqual(["o"]);
    expect(state.result).toMatchObject({ winner: 1, forfeit: true });
    for (let i = 0; i < 100; i++) {
      game.apply(state, `p${i}`, { type: "sit", seat: 0 }, ctx());
      game.removePlayer(state, `p${i}`, ctx());
    }
    expect(Object.keys(state.away)).toHaveLength(32);
    expect(game.view(state, "o")).not.toHaveProperty("away");
  });
});
