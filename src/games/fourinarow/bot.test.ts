import { describe, expect, it } from "vitest";
import { seededRandomInt } from "../kit/testing";
import { think } from "./bot";
import type { FourView } from "./engine";
import { fourInARow as game } from "./index";
import { DECIDED, Position } from "./search";

/** A view of a 7×6 position from rows (top first), with `moves` long enough to be past the opening. */
function view(rows: string[], piece: "x" | "o" = "x"): FourView {
  const state = game.create(game.configSchema.parse({ minutes: 0 }), { now: 0, randomInt: seededRandomInt(1), nameOf: (id) => id, announce: () => {} });
  const v = game.view(state, "nobody");
  const board = rows.join("");
  const discs = [...board].filter((c) => c !== ".").length;
  return { ...v, phase: "playing", board, rows, turn: piece, moves: Array.from({ length: Math.max(discs, 12) }, () => ({ by: "x", column: 1 })), you: { seat: 0, color: piece } };
}

const ops = (v: FourView) => Array.from({ length: v.size.columns }, (_, c) => ({ type: "drop" as const, column: c + 1 })).filter((op) => v.board[op.column - 1] === ".");
const best = (v: FourView, seed = 1, timeMs = 200) => think(v, seededRandomInt(seed), { maxDepth: 14, timeMs });

describe("four in a row bot", () => {
  it("takes a win in one rather than blocking", () => {
    // x wins in column 4 (across the bottom); o threatens column 7 (up).
    const v = view([".......", ".......", "......o", "......o", "......o", "xxx..ox"]);
    expect(best(v).column).toBe(3);
    for (const quick of [true, false]) expect(game.bot.play(v, ops(v), seededRandomInt(3), { quick })).toEqual({ type: "drop", column: 4 });
  });

  it("blocks a loss in one", () => {
    // o has three up column 2; x must drop there.
    const v = view([".......", ".......", ".......", ".o.....", ".o..x..", "xo.xxo."]);
    for (let seed = 1; seed <= 3; seed++) expect(game.bot.play(v, ops(v), seededRandomInt(seed), { quick: true })).toEqual({ type: "drop", column: 2 });
    expect(best(v).column).toBe(1);
  });

  it("doesn't drop right under the other side's four", () => {
    // o completes four across row 2 at column 4, so x mustn't fill column 4's bottom spot.
    const v = view([".......", ".......", ".......", ".......", "ooo.x..", "xxo.x.."]);
    const pos = Position.fromBoard(v.board, 7, 6);
    expect(pos.givesAway(3, 0)).toBe(true);
    for (let seed = 1; seed <= 5; seed++) expect(best(v, seed).column).not.toBe(3);
  });

  it("finds a forced win: three open at both ends", () => {
    // x on c1 and d1 with b1, e1 and f1 open: dropping into column 5 makes a three that can't be blocked at both ends.
    const v = view([".......", ".......", ".......", ".......", ".......", "o.xx..o"]);
    const r = best(v, 1, 500);
    expect(r.score).toBeGreaterThan(DECIDED);
    expect(r.column).toBe(4);
  });

  it("sees a win a few moves deep and plays it out", () => {
    // From a won position, keep playing the bot against a blocker: it must get there.
    const state = game.create(game.configSchema.parse({ minutes: 0 }), { now: 0, randomInt: seededRandomInt(1), nameOf: (id) => id, announce: () => {} });
    const ctx = { now: 0, randomInt: seededRandomInt(1), nameOf: (id: string) => id, announce: () => {} };
    game.apply(state, "bot", { type: "sit", seat: 0 }, ctx);
    game.apply(state, "quick", { type: "sit", seat: 1 }, ctx);
    const rand = seededRandomInt(5);
    for (let i = 0; i < 42 && state.phase === "playing"; i++) {
      const who = game.waitingOn(state)[0]!;
      const v = game.view(state, who);
      const op = who === "bot" ? { type: "drop" as const, column: think(v, rand, { maxDepth: 10, timeMs: Infinity }).column + 1 } : game.bot.play(v, game.legalOps(state, who), rand, { quick: true })!;
      game.apply(state, who, op, ctx);
    }
    expect(state.result?.winner).toBe("x");
  });

  it("opens in the middle and thinks within its budget", () => {
    const v = view(Array.from({ length: 6 }, () => "......."));
    expect(think({ ...v, moves: [] }, seededRandomInt(1), { maxDepth: 14, timeMs: 400 }).column).toBe(3);
    const start = performance.now();
    const r = think({ ...v, board: `${".".repeat(38)}x...`, moves: [{ by: "x", column: 4 }] }, seededRandomInt(1), { maxDepth: 30, timeMs: 150 });
    expect(performance.now() - start).toBeLessThan(400);
    expect(r.depth).toBeGreaterThanOrEqual(6);
  });

  it("is repeatable when quick, but still varies with the seed", () => {
    const v = view([".......", ".......", ".......", ".......", "...o...", "..xx..."], "o");
    const pick = (seed: number) => game.bot.play(v, ops(v), seededRandomInt(seed), { quick: true });
    expect(pick(1)).toEqual(pick(1));
    const picks = new Set(Array.from({ length: 12 }, (_, i) => JSON.stringify(pick(i + 1))));
    expect(picks.size).toBeGreaterThan(1);
  });
});
