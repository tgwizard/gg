import { describe, expect, it } from "vitest";
import { seededRandomInt } from "../kit/testing";
import type { GameContext } from "../types";
import type { OthelloState } from "./engine";
import { othello as game } from "./index";
import { count, START_BOARD } from "./rules";

function setup(minutes = 5, increment = 5) {
  const announcements: string[] = [];
  const ctx = (now = 0): GameContext => ({ now, randomInt: seededRandomInt(1), nameOf: (id) => id, announce: (t) => announcements.push(t) });
  const state = game.create({ minutes, increment }, ctx());
  game.apply(state, "alice", { type: "sit", seat: 0 }, ctx());
  game.apply(state, "bob", { type: "sit", seat: 1 }, ctx());
  return { state, ctx, announcements };
}

/** Moves in turn, by whoever's to move. */
function play(state: OthelloState, ctx: (now?: number) => GameContext, squares: string[], now = 0) {
  for (const square of squares) game.apply(state, game.waitingOn(state)[0]!, { type: "move", square }, ctx(now));
}

describe("othello", () => {
  it("starts when both sit, with seat 0 as Black, and flips what's trapped", () => {
    const { state, ctx } = setup();
    expect(state.phase).toBe("playing");
    expect(game.waitingOn(state)).toEqual(["alice"]);
    expect(() => game.apply(state, "bob", { type: "move", square: "c5" }, ctx())).toThrow(/not your move/);
    expect(() => game.apply(state, "alice", { type: "move", square: "a1" }, ctx())).toThrow(/trap/);
    expect(() => game.apply(state, "alice", { type: "move", square: "d4" }, ctx())).toThrow(/taken/);
    play(state, ctx, ["f5"]);
    expect(count(state.board)).toEqual({ b: 4, w: 1, empty: 59 });
    const view = game.view(state, "bob");
    expect(view.lastMove).toEqual({ by: "b", square: "f5", flipped: ["e5"] });
    expect(view.rows[4]).toBe("...bbb..");
    expect(view.score).toEqual({ b: 4, w: 1 });
    expect(view.you).toEqual({ seat: 1, color: "w" });
    expect(game.legalOps(state, "bob").filter((op) => op.type === "move")).toHaveLength(3);
  });

  it("ends when neither side can move: most discs wins", () => {
    const { state, ctx, announcements } = setup();
    // White to move, and c8 (trapping b8) is the only move; then there's no black left.
    state.board = `${"w".repeat(56)}wb......`;
    state.turn = "w";
    expect(game.legalOps(state, "bob").filter((op) => op.type === "move")).toEqual([{ type: "move", square: "c8" }]);
    play(state, ctx, ["c8"]);
    expect(state.phase).toBe("over");
    expect(state.result).toEqual({ winner: "w", reason: "board", score: { b: 0, w: 59 } });
    expect(announcements.at(-1)).toBe("Othello game 1: bob wins, 59–0.");
    expect(state.seats[1]!.wins).toBe(1);
    expect(game.waitingOn(state)).toEqual([]);
  });

  it("lets the mover go again when the other side has to pass", () => {
    const { state, ctx } = setup();
    // Black plays a1, trapping b1; then White has nothing, while Black still has d1.
    state.board = `.wb.wwbb${".".repeat(56)}`;
    game.apply(state, "alice", { type: "move", square: "a1" }, ctx());
    expect(state.board.slice(0, 8)).toBe("bbb.wwbb");
    expect(state.turn).toBe("b");
    expect(game.waitingOn(state)).toEqual(["alice"]);
    expect(state.moves.at(-1)).toEqual({ by: "w", at: null, flips: [] });
    expect(game.view(state, "bob")).toMatchObject({ passed: "w", lastMove: { by: "b", square: "a1", flipped: ["b1"] } });
    expect(game.view(state, "bob").moves).toEqual([{ by: "b", square: "a1" }, { by: "w", square: null }]);
    game.apply(state, "alice", { type: "move", square: "d1" }, ctx());
    expect(state.result).toEqual({ winner: "b", reason: "board", score: { b: 8, w: 0 } });
  });

  it("swaps colors on a rematch", () => {
    const { state, ctx } = setup();
    game.apply(state, "alice", { type: "resign" }, ctx());
    expect(state.result).toEqual({ winner: "w", reason: "resign", score: { b: 2, w: 2 } });
    game.apply(state, "alice", { type: "rematch" }, ctx());
    expect(state.game).toBe(2);
    expect(state.board).toBe(START_BOARD);
    expect(state.sides).toEqual({ b: "bob", w: "alice" });
    expect(game.waitingOn(state)).toEqual(["bob"]);
    expect(game.view(state, "alice").you).toEqual({ seat: 0, color: "w" });
  });

  it("runs the clocks with an increment, and flags whoever runs out", () => {
    const { state, ctx, announcements } = setup(1, 2);
    expect(game.nextDeadline!(state)).toBe(60_000);
    play(state, ctx, ["f5"], 10_000);
    expect(state.clock).toEqual({ b: 52_000, w: 60_000 });
    expect(game.nextDeadline!(state)).toBe(70_000);
    expect(game.view(state, "alice").clock).toEqual({ b: 52_000, w: 60_000, since: 10_000, running: "w" });
    game.onDeadline!(state, ctx(70_000));
    expect(state.result).toEqual({ winner: "b", reason: "timeout", score: { b: 4, w: 1 } });
    expect(state.clock!.w).toBe(0);
    expect(announcements.at(-1)).toBe("Othello game 1: alice wins on time (bob ran out).");
    expect(game.nextDeadline!(state)).toBeNull();
  });

  it("calls the game off if you leave before moving, and forfeits it after", () => {
    const { state, ctx, announcements } = setup(0, 0);
    expect(state.clock).toBeNull();
    play(state, ctx, ["f5"]);
    game.apply(state, "bob", { type: "leave" }, ctx());
    expect(state.phase).toBe("waiting");
    expect(state.game).toBe(0);
    expect(announcements.at(-1)).toMatch(/called off/);
    game.apply(state, "carol", { type: "sit", seat: 1 }, ctx());
    expect(state.sides).toEqual({ b: "alice", w: "carol" });
    play(state, ctx, ["f5", "f6"]);
    game.apply(state, "alice", { type: "leave" }, ctx());
    expect(state.result).toMatchObject({ winner: "w", reason: "left" });
    expect(game.players(state)).toEqual(["carol"]);
    expect(game.legalOps(state, "carol")).not.toContainEqual({ type: "rematch" });
  });

  it("lets Easy bots play whole games, and the bot takes a corner", () => {
    const winners = new Set<string>();
    for (let seed = 1; seed <= 8; seed++) {
      const rand = seededRandomInt(seed);
      const { state, ctx } = setup(0, 0);
      for (let i = 0; i < 70 && state.phase === "playing"; i++) {
        const who = game.waitingOn(state)[0]!;
        const ops = game.legalOps(state, who).filter((op) => op.type === "move");
        game.apply(state, who, game.bot.easy(game.view(state, who), ops, rand)!, ctx());
        game.checkInvariants!(state);
      }
      expect(state.phase).toBe("over");
      expect(state.result!.reason).toBe("board");
      winners.add(String(state.result!.winner));
    }
    expect(winners.size).toBeGreaterThan(1);

    const { state } = setup();
    // Black can take a1 (trapping b2), or d1 or e1 (trapping d2).
    const cells = ".".repeat(64).split("");
    for (const [sq, c] of [[9, "w"], [18, "b"], [11, "w"], [19, "b"]] as const) cells[sq] = c;
    state.board = cells.join("");
    const ops = game.legalOps(state, "alice").filter((op) => op.type === "move");
    expect(ops.map((op) => op.square)).toEqual(["a1", "d1", "e1"]);
    for (let seed = 1; seed <= 5; seed++) expect(game.bot.easy(game.view(state, "alice"), ops, seededRandomInt(seed))).toEqual({ type: "move", square: "a1" });
  });
});
