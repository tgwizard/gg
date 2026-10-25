import { describe, expect, it } from "vitest";
import { seededRandomInt } from "../kit/testing";
import type { GameContext } from "../types";
import { type GoConfig, type GoState, MAX_RESUMES, maxMoves, SETTLE_MS } from "./engine";
import { estimateDead } from "./montecarlo";
import { go as game, type GoOp } from "./index";
import { chains, parsePoint, positionKey } from "./rules";

function setup(config: Partial<GoConfig> = {}) {
  const announcements: string[] = [];
  const ctx = (now = 0): GameContext => ({ now, randomInt: seededRandomInt(1), nameOf: (id) => id, announce: (t) => announcements.push(t) });
  const state = game.create({ size: 9, minutes: 0, periods: 0, seconds: 0, ...config }, ctx());
  game.apply(state, "alice", { type: "sit", seat: 0 }, ctx());
  game.apply(state, "bob", { type: "sit", seat: 1 }, ctx());
  return { state, ctx, announcements };
}

/** Moves in turn, by whoever's to move: points, or "pass". */
function play(state: GoState, ctx: (now?: number) => GameContext, moves: string[], now = 0) {
  for (const m of moves) {
    const op: GoOp = m === "pass" ? { type: "pass" } : { type: "play", point: m };
    game.apply(state, game.waitingOn(state)[0]!, op, ctx(now));
    game.checkInvariants!(state);
  }
}

/** Start from a drawn position (rows top first), with `turn` to move. */
function position(state: GoState, rows: string[], turn: "b" | "w" = "b") {
  state.board = rows.join("");
  state.history = [positionKey(state.board)];
  state.turn = turn;
}

describe("go", () => {
  it("starts when both sit, with seat 0 as Black, and takes stones with no liberties", () => {
    const { state, ctx } = setup();
    expect(state.phase).toBe("playing");
    expect(game.waitingOn(state)).toEqual(["alice"]);
    expect(() => game.apply(state, "bob", { type: "play", point: "E5" }, ctx())).toThrow(/not your move/);
    expect(() => game.apply(state, "alice", { type: "play", point: "K5" }, ctx())).toThrow(/no K5/);
    // Black surrounds White's E5.
    play(state, ctx, ["E6", "E5", "D5", "A1", "F5"]);
    expect(() => game.apply(state, "bob", { type: "play", point: "E6" }, ctx())).toThrow(/taken/);
    play(state, ctx, ["A2", "E4"]);
    expect(state.board[parsePoint("E5", 9)!]).toBe(".");
    expect(state.captures).toEqual({ b: 1, w: 0 });
    const view = game.view(state, "bob");
    expect(view.lastMove).toEqual({ by: "b", point: "E4", captured: ["E5"] });
    expect(view.rows[4]).toBe("...b.b...");
    expect(view.you).toEqual({ seat: 1, color: "w" });
    // White can't play back into E5: no liberties, and nothing to take.
    expect(() => game.apply(state, "bob", { type: "play", point: "E5" }, ctx())).toThrow(/no liberties/);
    expect(game.legalOps(state, "bob")).not.toContainEqual({ type: "play", point: "E5" });
  });

  it("won't let a ko be taken straight back", () => {
    const { state, ctx } = setup();
    position(state, ["........."
      , "........."
      , "........."
      , "...bw...."
      , "..b.bw..."
      , "...bw...."
      , "........."
      , "........."
      , "........."], "w");
    play(state, ctx, ["D5"]);
    expect(state.moves.at(-1)!.captured).toEqual([parsePoint("E5", 9)]);
    expect(game.view(state, "alice").ko).toEqual(["E5"]);
    expect(() => game.apply(state, "alice", { type: "play", point: "E5" }, ctx())).toThrow(/earlier position/);
    // After a move elsewhere each, it can be taken back.
    play(state, ctx, ["A1", "J9", "E5"]);
    expect(state.moves.at(-1)!.captured).toEqual([parsePoint("D5", 9)]);
  });

  it("counts after two passes: dead stones marked, either can change it, both accept", () => {
    const { state, ctx, announcements } = setup();
    // Black walls off the left, White the right; a lone white stone sits in Black's area.
    position(state, [
      "...bw....",
      "...bw....",
      "...bw....",
      ".w.bw....",
      "...bw....",
      "...bw....",
      "...bw....",
      "...bw....",
      "...bw....",
    ]);
    play(state, ctx, ["pass", "pass"]);
    expect(state.phase).toBe("scoring");
    expect(game.waitingOn(state).sort()).toEqual(["alice", "bob"]);
    let view = game.view(state, "alice");
    expect(view.scoring!.dead).toEqual(["B6"]);
    expect(view.scoring!.score).toEqual({ b: 36, w: 52.5 });
    expect(() => game.apply(state, "alice", { type: "play", point: "A1" }, ctx())).toThrow(/counted/);

    // Marking it alive again takes back everyone's acceptance.
    game.apply(state, "alice", { type: "accept" }, ctx());
    game.apply(state, "bob", { type: "mark", point: "B6" }, ctx(1000));
    view = game.view(state, "alice");
    expect(view.scoring).toMatchObject({ dead: [], accepted: { b: false, w: false }, deadline: 1000 + SETTLE_MS });
    // Alive, it makes Black's side nobody's.
    expect(view.scoring!.score).toEqual({ b: 9, w: 53.5 });
    game.apply(state, "bob", { type: "mark", point: "B6" }, ctx());
    game.apply(state, "alice", { type: "accept" }, ctx());
    expect(game.waitingOn(state)).toEqual(["bob"]);
    game.apply(state, "bob", { type: "accept" }, ctx());
    expect(state.result).toEqual({ winner: "w", reason: "score", score: { b: 36, w: 52.5 } });
    expect(announcements.at(-1)).toBe("Go game 1: bob wins by 16.5 points.");
    expect(state.seats[1]!.wins).toBe(1);
  });

  it("can resume play from counting (the other side first), and scores as marked if counting goes quiet", () => {
    const { state, ctx, announcements } = setup();
    play(state, ctx, ["E5", "pass", "pass"]);
    expect(state.phase).toBe("scoring");
    game.apply(state, "bob", { type: "resume" }, ctx());
    expect(state.phase).toBe("playing");
    expect(game.waitingOn(state)).toEqual(["alice"]);
    expect(announcements.at(-1)).toMatch(/bob resumed play/);
    // One pass isn't the end any more.
    play(state, ctx, ["pass"]);
    expect(state.phase).toBe("playing");
    play(state, ctx, ["pass"], 5000);
    expect(game.nextDeadline!(state)).toBe(5000 + SETTLE_MS);
    game.onDeadline!(state, ctx(5000 + SETTLE_MS));
    // A lone black stone owns the whole board.
    expect(state.result).toEqual({ winner: "b", reason: "score", score: { b: 81, w: 7.5 } });
  });

  it("resumes from counting only a few times a game, and counts a game that goes on too long", () => {
    const { state, ctx } = setup();
    play(state, ctx, ["E5"]);
    for (let i = 0; i < MAX_RESUMES; i++) {
      play(state, ctx, ["pass", "pass"]);
      game.apply(state, game.waitingOn(state)[0] === "alice" ? "bob" : "alice", { type: "resume" }, ctx());
    }
    play(state, ctx, ["pass", "pass"]);
    expect(state.phase).toBe("scoring");
    expect(game.legalOps(state, "alice")).not.toContainEqual({ type: "resume" });
    expect(game.view(state, "alice").scoring!.canResume).toBe(false);
    expect(() => game.apply(state, "alice", { type: "resume" }, ctx())).toThrow(/can't be resumed/);

    const long = setup();
    long.state.moves = Array.from({ length: maxMoves(9) - 1 }, (_, i) => ({ by: i % 2 ? "w" : "b", at: null, captured: [] }));
    play(long.state, long.ctx, ["E5"]);
    expect(long.state.phase).toBe("scoring");
    expect(long.announcements.at(-1)).toMatch(/counted as it stands/);
    expect(game.legalOps(long.state, "bob")).not.toContainEqual({ type: "resume" });
  });

  it("guesses whole chains dead or alive, never part of one", () => {
    const rows = ["b.bw.bw.b", ".w.w.bwwb", "..bbwb..w", "b.wbwb.w.", ".w..bb..w", "b.bww.b.b", "ww.bb..ww", ".w..w..b.", ".ww.bb.bw"];
    const board = rows.join("");
    for (const seed of [1, 2, 3]) {
      const dead = new Set(estimateDead(board, "b", { playouts: 400, seed }));
      for (const ch of chains(board)) expect(new Set(ch.stones.map((p) => dead.has(p))).size).toBe(1);
    }
  });

  it("runs byo-yomi clocks: main time, then periods kept by moving in time", () => {
    const { state, ctx, announcements } = setup({ minutes: 1, periods: 2, seconds: 10 });
    expect(game.nextDeadline!(state)).toBe(80_000);
    // Black moves 5 s into its byo-yomi: still two periods.
    play(state, ctx, ["E5"], 65_000);
    expect(state.clock!.b).toEqual({ main: 0, periods: 2 });
    play(state, ctx, ["C3"], 70_000);
    expect(game.nextDeadline!(state)).toBe(90_000);
    // 15 s: one period used up.
    play(state, ctx, ["G7"], 85_000);
    expect(state.clock!.b).toEqual({ main: 0, periods: 1 });
    expect(game.view(state, "alice").clock).toEqual({ b: { main: 0, periods: 1 }, w: { main: 55_000, periods: 2 }, since: 85_000, running: "w", period: 10_000 });
    play(state, ctx, ["C7"], 90_000);
    game.onDeadline!(state, ctx(100_000));
    expect(state.result).toEqual({ winner: "w", reason: "timeout", score: null });
    expect(announcements.at(-1)).toBe("Go game 1: bob wins on time (alice ran out).");
  });

  it("calls the game off if you leave before moving, forfeits it after, and swaps colors on a rematch", () => {
    const { state, ctx, announcements } = setup();
    play(state, ctx, ["E5"]);
    game.apply(state, "bob", { type: "leave" }, ctx());
    expect(state.phase).toBe("waiting");
    expect(announcements.at(-1)).toMatch(/called off/);
    game.apply(state, "carol", { type: "sit", seat: 1 }, ctx());
    expect(state.sides).toEqual({ b: "alice", w: "carol" });
    play(state, ctx, ["E5", "C3"]);
    game.apply(state, "alice", { type: "resign" }, ctx());
    expect(state.result).toEqual({ winner: "w", reason: "resign", score: null });
    game.apply(state, "carol", { type: "rematch" }, ctx());
    expect(state.sides).toEqual({ b: "carol", w: "alice" });
    expect(state.board).toBe(".".repeat(81));
    expect(state.captures).toEqual({ b: 0, w: 0 });
    play(state, ctx, ["E5"]);
    game.apply(state, "carol", { type: "leave" }, ctx());
    expect(state.result).toMatchObject({ winner: "w", reason: "left" });
  });

  it("has a bot that takes stones in atari, passes when it's won, and fixes a cheeky marking", () => {
    const { state, ctx } = setup();
    // White's two stones at E5-E4 have one liberty left, at E3.
    position(state, [
      ".........",
      ".........",
      ".........",
      "....b....",
      "...bwb...",
      "...bwb...",
      ".........",
      ".........",
      ".........",
    ]);
    const ops = () => game.legalOps(state, "alice").filter((op) => op.type !== "leave" && op.type !== "sit");
    for (let seed = 1; seed <= 3; seed++) expect(game.bot.play(game.view(state, "alice"), ops(), seededRandomInt(seed))).toEqual({ type: "play", point: "E3" });

    // Black has the whole board (a wall down the middle); White passes: Black passes too.
    position(state, Array(9).fill("....b...."), "w");
    play(state, ctx, ["pass"]);
    const bot = game.bot.play(game.view(state, "alice"), ops(), seededRandomInt(1));
    expect(bot).toEqual({ type: "pass" });
    game.apply(state, "alice", bot!, ctx());
    expect(state.phase).toBe("scoring");
    expect(game.view(state, "alice").scoring!.dead).toEqual([]);

    // White marks Black's wall dead; Black's bot marks it alive again, then accepts.
    game.apply(state, "bob", { type: "mark", point: "E5" }, ctx());
    expect(game.view(state, "alice").scoring!.score).toEqual({ b: 0, w: 7.5 });
    expect(game.bot.play(game.view(state, "alice"), ops(), seededRandomInt(1))).toEqual({ type: "mark", point: "E9" });
    game.apply(state, "alice", { type: "mark", point: "E9" }, ctx());
    expect(game.bot.play(game.view(state, "alice"), ops(), seededRandomInt(1))).toEqual({ type: "accept" });
  });

  it("lets bots play whole games on every board size", () => {
    for (const size of [9, 13, 19] as const) {
      const rand = seededRandomInt(size);
      const { state, ctx } = setup({ size });
      for (let i = 0; i < 2000 && state.phase !== "over"; i++) {
        const who = game.waitingOn(state)[0]!;
        const ops = game.legalOps(state, who).filter((op) => op.type !== "leave");
        game.apply(state, who, game.bot.play(game.view(state, who), ops, rand, { quick: true })!, ctx());
        game.checkInvariants!(state);
      }
      expect(state.phase).toBe("over");
      expect(state.moves.length).toBeGreaterThan(size * 2);
    }
  });
});
