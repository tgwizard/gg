import { describe, expect, it } from "vitest";
import { seededRandomInt } from "../kit/testing";
import type { GameContext } from "../types";
import type { FourConfig, FourState } from "./engine";
import { fourInARow as game } from "./index";

function setup(config: Partial<FourConfig> = {}) {
  const announcements: string[] = [];
  const ctx = (now = 0): GameContext => ({ now, randomInt: seededRandomInt(1), nameOf: (id) => id, announce: (t) => announcements.push(t) });
  const state = game.create(game.configSchema.parse({ minutes: 0, increment: 0, ...config }), ctx());
  game.apply(state, "alice", { type: "sit", seat: 0 }, ctx());
  game.apply(state, "bob", { type: "sit", seat: 1 }, ctx());
  return { state, ctx, announcements };
}

/** Drops in turn, by whoever's to move (columns from 1). */
function play(state: FourState, ctx: (now?: number) => GameContext, columns: number[], now = 0) {
  for (const column of columns) game.apply(state, game.waitingOn(state)[0]!, { type: "drop", column }, ctx(now));
}

describe("four in a row", () => {
  it("starts when both sit, seat 0 first, and drops discs to the bottom", () => {
    const { state, ctx } = setup();
    expect(state.phase).toBe("playing");
    expect(game.waitingOn(state)).toEqual(["alice"]);
    expect(() => game.apply(state, "bob", { type: "drop", column: 4 }, ctx())).toThrow(/not your move/);
    expect(() => game.apply(state, "alice", { type: "drop", column: 8 }, ctx())).toThrow(/no such column/);
    play(state, ctx, [4, 4]);
    const view = game.view(state, "bob");
    expect(view.rows.slice(-2)).toEqual(["...o...", "...x..."]);
    expect(view.lastMove).toEqual({ by: "o", column: 4, row: 2, cell: 31 });
    expect(view.moves).toEqual([{ by: "x", column: 4 }, { by: "o", column: 4 }]);
    expect(view.you).toEqual({ seat: 1, color: "o" });
    expect(game.legalOps(state, "alice").filter((op) => op.type === "drop")).toHaveLength(7);
    expect(game.legalOps(state, "bob").filter((op) => op.type === "drop")).toHaveLength(0);
    play(state, ctx, [4, 4, 4, 4]);
    expect(game.legalOps(state, "alice").map((op) => op.type === "drop" && op.column)).not.toContain(4);
    expect(() => game.apply(state, "alice", { type: "drop", column: 4 }, ctx())).toThrow(/full/);
  });

  it("ends on four in a row, with the line", () => {
    const { state, ctx, announcements } = setup();
    // x: 1, 2, 3, 4 along the bottom; o stacks on 1, 2, 3.
    play(state, ctx, [1, 1, 2, 2, 3, 3, 4]);
    expect(state.phase).toBe("over");
    expect(state.result).toEqual({ winner: "x", reason: "four", line: [35, 36, 37, 38] });
    expect(game.view(state, "bob").result).toMatchObject({ winner: "x", reason: "four", line: [{ column: 1, row: 1 }, { column: 2, row: 1 }, { column: 3, row: 1 }, { column: 4, row: 1 }] });
    expect(announcements.at(-1)).toBe("Four in a Row game 1: alice wins with four in a row.");
    expect(state.seats[0]!.wins).toBe(1);
    expect(game.waitingOn(state)).toEqual([]);
    expect(game.legalOps(state, "bob")).toContainEqual({ type: "rematch" });
  });

  it("is a draw when the board fills with no four", () => {
    const { state, ctx, announcements } = setup();
    // Columns in pairs, three discs at a time, so colors alternate in blocks of three up each column: no four anywhere.
    const order = [1, 2, 1, 2, 1, 2, 2, 1, 2, 1, 2, 1, 3, 4, 3, 4, 3, 4, 4, 3, 4, 3, 4, 3, 5, 6, 5, 6, 5, 6, 6, 5, 6, 5, 6, 5, 7, 7, 7, 7, 7, 7];
    play(state, ctx, order);
    expect(state.result).toEqual({ winner: null, reason: "full", line: [] });
    expect(announcements.at(-1)).toBe("Four in a Row game 1: A draw: the board is full.");
    expect(state.draws).toBe(1);
  });

  it("alternates who starts, or lets the loser start", () => {
    const { state, ctx } = setup();
    game.apply(state, "alice", { type: "resign" }, ctx());
    expect(state.result).toMatchObject({ winner: "o", reason: "resign" });
    game.apply(state, "bob", { type: "rematch" }, ctx());
    expect(state.sides).toEqual({ x: "bob", o: "alice" });
    expect(game.waitingOn(state)).toEqual(["bob"]);

    const loser = setup({ opener: "loser" });
    game.apply(loser.state, "bob", { type: "resign" }, loser.ctx());
    // Bob lost, so Bob starts.
    expect(game.view(loser.state, "alice").nextOpenerSeat).toBe(1);
    game.apply(loser.state, "alice", { type: "rematch" }, loser.ctx());
    expect(loser.state.sides).toEqual({ x: "bob", o: "alice" });
    game.apply(loser.state, "alice", { type: "resign" }, loser.ctx());
    game.apply(loser.state, "alice", { type: "rematch" }, loser.ctx());
    expect(loser.state.sides).toEqual({ x: "alice", o: "bob" });
  });

  it("runs the clocks with an increment, and flags whoever runs out", () => {
    const { state, ctx, announcements } = setup({ minutes: 1, increment: 2 });
    expect(game.nextDeadline!(state)).toBe(60_000);
    play(state, ctx, [4], 10_000);
    expect(state.clock).toEqual({ x: 52_000, o: 60_000 });
    expect(game.view(state, "alice").clock).toEqual({ x: 52_000, o: 60_000, since: 10_000, running: "o" });
    game.onDeadline!(state, ctx(70_000));
    expect(state.result).toMatchObject({ winner: "x", reason: "timeout" });
    expect(state.clock!.o).toBe(0);
    expect(announcements.at(-1)).toBe("Four in a Row game 1: alice wins on time (bob ran out).");
    expect(game.nextDeadline!(state)).toBeNull();
  });

  it("calls the game off if you leave before moving, and forfeits it after", () => {
    const { state, ctx, announcements } = setup();
    play(state, ctx, [4]);
    game.apply(state, "bob", { type: "leave" }, ctx());
    expect(state.phase).toBe("waiting");
    expect(state.game).toBe(0);
    expect(state.board).not.toContain("x");
    expect(announcements.at(-1)).toMatch(/called off/);
    game.apply(state, "carol", { type: "sit", seat: 1 }, ctx());
    expect(state.sides).toEqual({ x: "alice", o: "carol" });
    play(state, ctx, [4, 4]);
    game.apply(state, "alice", { type: "leave" }, ctx());
    expect(state.result).toMatchObject({ winner: "o", reason: "left" });
    expect(game.players(state)).toEqual(["carol"]);
    expect(game.legalOps(state, "carol")).not.toContainEqual({ type: "rematch" });
  });

  it("plays bigger boards", () => {
    const { state, ctx } = setup({ board: "9x7" });
    expect(game.view(state, "alice").size).toEqual({ columns: 9, rows: 7 });
    expect(game.legalOps(state, "alice").filter((op) => op.type === "drop")).toHaveLength(9);
    play(state, ctx, [9, 1, 9, 1, 9, 1, 9]);
    expect(state.result).toMatchObject({ winner: "x", reason: "four" });
    game.checkInvariants!(state);
  });

  it("lets built-in bots play whole games", () => {
    for (let seed = 1; seed <= 6; seed++) {
      const rand = seededRandomInt(seed);
      const { state, ctx } = setup();
      for (let i = 0; i < 50 && state.phase === "playing"; i++) {
        const who = game.waitingOn(state)[0]!;
        const ops = game.legalOps(state, who).filter((op) => op.type === "drop");
        game.apply(state, who, game.bot.play(game.view(state, who), ops, rand, { quick: true })!, ctx());
        game.checkInvariants!(state);
      }
      expect(state.phase).toBe("over");
    }
  });
});
