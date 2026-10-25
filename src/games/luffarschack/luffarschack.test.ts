import { describe, expect, it } from "vitest";
import { seededRandomInt } from "../kit/testing";
import type { GameContext } from "../types";
import type { LuffaConfig, LuffaState } from "./engine";
import { luffarschack as game } from "./index";

function setup(config: Partial<LuffaConfig> = {}) {
  const announcements: string[] = [];
  const ctx = (now = 0): GameContext => ({ now, randomInt: seededRandomInt(1), nameOf: (id) => id, announce: (t) => announcements.push(t) });
  const state = game.create(game.configSchema.parse({ turnSeconds: 0, ...config }), ctx());
  game.apply(state, "alice", { type: "sit", seat: 0 }, ctx());
  game.apply(state, "bob", { type: "sit", seat: 1 }, ctx());
  return { state, ctx, announcements };
}

/** Marks in turn, by whoever's to move. */
function play(state: LuffaState, ctx: (now?: number) => GameContext, squares: string[], now = 0) {
  for (const square of squares) game.apply(state, game.waitingOn(state)[0]!, { type: "mark", square }, ctx(now));
}

describe("luffarschack", () => {
  it("starts when both sit, seat 0 drawing crosses first, on a 19×19 sheet", () => {
    const { state, ctx } = setup();
    expect(state.phase).toBe("playing");
    expect(game.waitingOn(state)).toEqual(["alice"]);
    expect(() => game.apply(state, "bob", { type: "mark", square: "J10" }, ctx())).toThrow(/not your move/);
    expect(() => game.apply(state, "alice", { type: "mark", square: "T1" }, ctx())).toThrow(/no square T1/);
    play(state, ctx, ["J10", "K10"]);
    expect(() => game.apply(state, "alice", { type: "mark", square: "j10" }, ctx())).toThrow(/already marked/);
    const view = game.view(state, "bob");
    expect(view.size).toBe(19);
    expect(view.rows[9]).toBe(".........xo........");
    expect(view.moves).toEqual([{ by: "x", square: "J10" }, { by: "o", square: "K10" }]);
    expect(view.lastMove).toEqual({ by: "o", square: "K10", cell: 9 * 19 + 10 });
    expect(view.you).toEqual({ seat: 1, color: "o" });
    expect(game.legalOps(state, "alice").filter((op) => op.type === "mark")).toHaveLength(361 - 2);
    expect(game.legalOps(state, "bob").filter((op) => op.type === "mark")).toHaveLength(0);
  });

  it("ends on five in a row, with the line", () => {
    const { state, ctx, announcements } = setup();
    play(state, ctx, ["C3", "C4", "D3", "D4", "E3", "E4", "F3", "F4", "G3"]);
    expect(state.phase).toBe("over");
    expect(state.result).toEqual({ winner: "x", reason: "five", runs: [[2 * 19 + 2, 2 * 19 + 6]] });
    expect(game.view(state, "bob").result).toMatchObject({ winner: "x", reason: "five", squares: ["C3", "D3", "E3", "F3", "G3"] });
    expect(announcements.at(-1)).toBe("Luffarschack game 1: alice wins with five in a row.");
    expect(state.seats[0]!.wins).toBe(1);
    expect(game.waitingOn(state)).toEqual([]);
    expect(game.legalOps(state, "bob")).toContainEqual({ type: "rematch" });
    // Bob draws the first cross next time.
    game.apply(state, "bob", { type: "rematch" }, ctx());
    expect(state.sides).toEqual({ x: "bob", o: "alice" });
    expect(game.waitingOn(state)).toEqual(["bob"]);
    expect(state.board).not.toMatch(/[xo]/);
  });

  it("counts six in a row as a win", () => {
    const { state, ctx } = setup();
    // x: A1 B1 C1 E1 F1, then D1 joins them into six.
    play(state, ctx, ["A1", "A3", "B1", "B3", "C1", "C3", "E1", "D3", "F1", "A5", "D1"]);
    expect(state.result).toMatchObject({ winner: "x", reason: "five" });
    expect(game.view(state, "alice").result!.squares).toEqual(["A1", "B1", "C1", "D1", "E1", "F1"]);
  });

  it("is a draw when the sheet fills with no five", () => {
    const { state, ctx, announcements } = setup({ size: "15" });
    // Pairs along each row, shifted by two every row: no line longer than two.
    const n = 15;
    const piece = (cell: number) => ((cell % n) + 2 * Math.floor(cell / n)) % 4 < 2;
    const xs = Array.from({ length: n * n }, (_, i) => i).filter(piece);
    const os = Array.from({ length: n * n }, (_, i) => i).filter((i) => !piece(i));
    expect(xs.length - os.length).toBe(1);
    const name = (cell: number) => `${"ABCDEFGHIJKLMNO"[cell % n]}${Math.floor(cell / n) + 1}`;
    play(state, ctx, xs.flatMap((x, i) => (os[i] === undefined ? [name(x)] : [name(x), name(os[i]!)])));
    expect(state.result).toEqual({ winner: null, reason: "full", runs: [] });
    expect(announcements.at(-1)).toBe("Luffarschack game 1: A draw: the sheet is full.");
    expect(state.draws).toBe(1);
  });

  it("gives each turn its own timer, and running out loses", () => {
    const { state, ctx, announcements } = setup({ turnSeconds: 30 });
    expect(game.nextDeadline!(state)).toBe(30_000);
    play(state, ctx, ["J10"], 10_000);
    expect(game.nextDeadline!(state)).toBe(40_000);
    expect(game.view(state, "alice").turnDeadline).toBe(40_000);
    game.onDeadline!(state, ctx(40_000));
    expect(state.result).toMatchObject({ winner: "x", reason: "timeout" });
    expect(announcements.at(-1)).toBe("Luffarschack game 1: alice wins on time (bob ran out).");
    expect(game.nextDeadline!(state)).toBeNull();
    expect(game.view(state, "alice").turnDeadline).toBeNull();
    // No timer at all with 0.
    expect(game.nextDeadline!(setup({ turnSeconds: 0 }).state)).toBeNull();
  });

  it("calls the game off if you leave before marking, and forfeits it after", () => {
    const { state, ctx, announcements } = setup();
    play(state, ctx, ["J10"]);
    game.apply(state, "bob", { type: "leave" }, ctx());
    expect(state.phase).toBe("waiting");
    expect(state.game).toBe(0);
    expect(state.board).not.toContain("x");
    expect(announcements.at(-1)).toMatch(/called off/);
    game.apply(state, "carol", { type: "sit", seat: 1 }, ctx());
    expect(state.sides).toEqual({ x: "alice", o: "carol" });
    play(state, ctx, ["J10", "K10"]);
    game.apply(state, "alice", { type: "leave" }, ctx());
    expect(state.result).toMatchObject({ winner: "o", reason: "left" });
    expect(game.players(state)).toEqual(["carol"]);
    expect(game.legalOps(state, "carol")).not.toContainEqual({ type: "rematch" });
  });

  it("resigns", () => {
    const { state, ctx } = setup();
    game.apply(state, "bob", { type: "resign" }, ctx());
    expect(state.result).toMatchObject({ winner: "x", reason: "resign" });
    expect(() => game.apply(state, "alice", { type: "resign" }, ctx())).toThrow(/no game on/);
  });

  it("plays the small and big sheets", () => {
    for (const [size, n] of [["15", 15], ["25", 25]] as const) {
      const { state, ctx } = setup({ size });
      expect(game.view(state, "alice").size).toBe(n);
      expect(game.legalOps(state, "alice").filter((op) => op.type === "mark")).toHaveLength(n * n);
      const last = String.fromCharCode(64 + n);
      play(state, ctx, [`${last}${n}`, "A1", `${last}${n - 1}`, "A2", `${last}${n - 2}`, "A3", `${last}${n - 3}`, "A4", `${last}${n - 4}`]);
      expect(state.result).toMatchObject({ winner: "x", reason: "five" });
      game.checkInvariants!(state);
    }
  });

  it("lets built-in bots play whole games", () => {
    for (let seed = 1; seed <= 6; seed++) {
      const rand = seededRandomInt(seed);
      const { state, ctx } = setup({ size: "15" });
      for (let i = 0; i < 225 && state.phase === "playing"; i++) {
        const who = game.waitingOn(state)[0]!;
        const ops = game.legalOps(state, who).filter((op) => op.type === "mark");
        game.apply(state, who, game.bot.play(game.view(state, who), ops, rand, { quick: true })!, ctx());
        game.checkInvariants!(state);
      }
      expect(state.phase).toBe("over");
    }
  });
});
