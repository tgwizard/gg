import { describe, expect, it } from "vitest";
import { seededRandomInt } from "../kit/testing";
import type { GameContext } from "../types";
import type { ChessState } from "./engine";
import { chess as game } from "./index";

function setup(minutes = 10, increment = 5) {
  const announcements: string[] = [];
  const ctx = (now = 0): GameContext => ({ now, randomInt: seededRandomInt(1), nameOf: (id) => id, announce: (t) => announcements.push(t) });
  const state = game.create({ minutes, increment }, ctx());
  game.apply(state, "alice", { type: "sit", seat: 0 }, ctx());
  game.apply(state, "bob", { type: "sit", seat: 1 }, ctx());
  return { state, ctx, announcements };
}

/** Alternate moves, starting with whoever's to move. */
function play(state: ChessState, ctx: (now?: number) => GameContext, ucis: string[], now = 0) {
  for (const move of ucis) game.apply(state, game.waitingOn(state)[0]!, { type: "move", move }, ctx(now));
}

describe("chess", () => {
  it("starts when both sit, with seat 0 as White, and ends on checkmate", () => {
    const { state, ctx, announcements } = setup();
    expect(state.phase).toBe("playing");
    expect(game.waitingOn(state)).toEqual(["alice"]);
    expect(() => game.apply(state, "bob", { type: "move", move: "e7e5" }, ctx())).toThrow(/not your move/);
    expect(() => game.apply(state, "alice", { type: "move", move: "e2e5" }, ctx())).toThrow(/isn't allowed/);
    play(state, ctx, ["f2f3", "e7e5", "g2g4", "d8h4"]);
    expect(state.result).toEqual({ winner: "b", reason: "checkmate" });
    expect(state.seats[1]!.wins).toBe(1);
    expect(state.moves.map((m) => m.san)).toEqual(["f3", "e5", "g4", "Qh4#"]);
    expect(announcements.at(-1)).toBe("Chess game 1: bob wins by checkmate.");
    expect(game.legalOps(state, "alice")).toContainEqual({ type: "rematch" });
  });

  it("swaps colors on a rematch", () => {
    const { state, ctx } = setup();
    game.apply(state, "alice", { type: "resign" }, ctx());
    expect(state.result).toEqual({ winner: "b", reason: "resign" });
    game.apply(state, "alice", { type: "rematch" }, ctx());
    expect(state.game).toBe(2);
    expect(state.sides).toEqual({ w: "bob", b: "alice" });
    expect(game.waitingOn(state)).toEqual(["bob"]);
    expect(game.view(state, "alice").you).toMatchObject({ seat: 0, color: "b" });
  });

  it("asks which piece a pawn becomes", () => {
    const { state, ctx } = setup();
    state.fen = "4k3/1P6/8/8/8/8/8/4K3 w - - 0 1";
    state.positions = [];
    expect(() => game.apply(state, "alice", { type: "move", move: "b7b8" }, ctx())).toThrow(/which piece/);
    game.apply(state, "alice", { type: "move", move: "b7b8n" }, ctx());
    expect(state.moves.at(-1)!.san).toBe("b8=N");
  });

  it("runs the clocks with an increment, and flags whoever runs out", () => {
    const { state, ctx, announcements } = setup(1, 2);
    expect(game.nextDeadline!(state)).toBe(60_000);
    play(state, ctx, ["e2e4"], 10_000); // White used 10s and gets 2 back
    expect(state.clock).toEqual({ w: 52_000, b: 60_000 });
    expect(game.nextDeadline!(state)).toBe(70_000); // Black's flag
    const view = game.view(state, "alice");
    expect(view.clock).toEqual({ w: 52_000, b: 60_000, since: 10_000, running: "b" });
    game.onDeadline!(state, ctx(70_000));
    expect(state.result).toEqual({ winner: "w", reason: "timeout" });
    expect(state.clock!.b).toBe(0);
    expect(announcements.at(-1)).toBe("Chess game 1: alice wins on time (bob ran out).");
    expect(game.nextDeadline!(state)).toBeNull();
  });

  it("calls it a draw when the side with time left has only a king", () => {
    const { state, ctx } = setup(1, 0);
    state.fen = "4k3/8/8/8/8/8/4P3/4K2R w K - 0 1";
    state.positions = [];
    game.onDeadline!(state, ctx(60_000));
    expect(state.result).toEqual({ winner: null, reason: "timeoutDraw" });
    expect(state.draws).toBe(1);
  });

  it("has no clock with zero minutes", () => {
    const { state, ctx } = setup(0, 0);
    play(state, ctx, ["e2e4", "e7e5"], 999_999);
    expect(state.clock).toBeNull();
    expect(game.nextDeadline!(state)).toBeNull();
    expect(game.view(state, "alice").clock).toBeNull();
  });

  it("handles draw offers: one per move, declined by moving, or accepted", () => {
    const { state, ctx } = setup();
    game.apply(state, "alice", { type: "offerDraw" }, ctx());
    expect(() => game.apply(state, "alice", { type: "offerDraw" }, ctx())).toThrow(/standing/);
    expect(game.legalOps(state, "bob")).toEqual(expect.arrayContaining([{ type: "acceptDraw" }, { type: "declineDraw" }]));
    play(state, ctx, ["e2e4"]);
    expect(state.drawOffer).toBe("w"); // still standing after the offerer moves
    play(state, ctx, ["e7e5"]);
    expect(state.drawOffer).toBeNull(); // Bob moved instead
    expect(game.view(state, "alice").you.canOfferDraw).toBe(true);
    game.apply(state, "alice", { type: "offerDraw" }, ctx());
    game.apply(state, "bob", { type: "declineDraw" }, ctx());
    expect(() => game.apply(state, "alice", { type: "offerDraw" }, ctx())).toThrow(/after the next move/);
    play(state, ctx, ["g1f3"]);
    game.apply(state, "bob", { type: "offerDraw" }, ctx());
    game.apply(state, "alice", { type: "acceptDraw" }, ctx());
    expect(state.result).toEqual({ winner: null, reason: "agreement" });
  });

  it("draws by stalemate, repetition and the fifty-move rule", () => {
    const stalemate = setup();
    // Sam Loyd's ten-move stalemate.
    play(stalemate.state, stalemate.ctx, "e2e3 a7a5 d1h5 a8a6 h5a5 h7h5 h2h4 a6h6 a5c7 f7f6 c7d7 e8f7 d7b7 d8d3 b7b8 d3h7 b8c8 f7g6 c8e6".split(" "));
    expect(stalemate.state.result).toEqual({ winner: null, reason: "stalemate" });

    const repetition = setup();
    play(repetition.state, repetition.ctx, "g1f3 g8f6 f3g1 f6g8 g1f3 g8f6 f3g1".split(" "));
    expect(repetition.state.phase).toBe("playing");
    play(repetition.state, repetition.ctx, ["f6g8"]); // the opening position, a third time
    expect(repetition.state.result).toEqual({ winner: null, reason: "repetition" });

    const fifty = setup();
    fifty.state.fen = "4k3/8/8/8/8/8/R7/4K3 w - - 99 80";
    fifty.state.positions = [];
    play(fifty.state, fifty.ctx, ["a2a3"]);
    expect(fifty.state.result).toEqual({ winner: null, reason: "fifty" });
  });

  it("calls the game off if you leave before moving, and forfeits it after", () => {
    const { state, ctx, announcements } = setup();
    game.apply(state, "alice", { type: "leave" }, ctx());
    expect(state.phase).toBe("waiting");
    expect(state.game).toBe(0);
    expect(announcements.at(-1)).toMatch(/called off/);
    game.apply(state, "carol", { type: "sit", seat: 0 }, ctx());
    expect(state.sides).toEqual({ w: "carol", b: "bob" });
    play(state, ctx, ["e2e4", "e7e5"]);
    game.apply(state, "carol", { type: "leave" }, ctx());
    expect(state.result).toEqual({ winner: "b", reason: "left" });
    expect(game.players(state)).toEqual(["bob"]);
    expect(game.legalOps(state, "bob")).not.toContainEqual({ type: "rematch" });
  });

  it("shows the board to bots as rows and names the last move", () => {
    const { state, ctx } = setup();
    play(state, ctx, ["e2e4"]);
    const view = game.view(state, "bob");
    expect(view.board[0]).toBe("rnbqkbnr");
    expect(view.board[4]).toBe("....P...");
    expect(view.lastMove).toEqual({ uci: "e2e4", san: "e4", piece: "p", took: null, tookAt: null });
    play(state, ctx, ["d7d5", "e4d5"]);
    expect(game.view(state, "bob").lastMove).toMatchObject({ san: "exd5", piece: "p", took: "p", tookAt: "d5" });
    expect(game.view(state, "bob").moves.at(-1)).toEqual({ san: "exd5", took: "p" });
    expect(view.you).toEqual({ seat: 1, color: "b", canOfferDraw: true });
    expect(view).not.toHaveProperty("positions");
  });

  it("lets Easy bots play whole games, and the bot takes a mate in one", () => {
    let decisive = 0;
    for (let seed = 1; seed <= 6; seed++) {
      const rand = seededRandomInt(seed);
      const { state, ctx } = setup(0, 0);
      for (let i = 0; i < 600 && state.phase === "playing"; i++) {
        const who = game.waitingOn(state)[0]!;
        const ops = game.legalOps(state, who).filter((op) => op.type !== "leave" && op.type !== "resign");
        const op = game.bot.easy(game.view(state, who), ops, rand)!;
        game.apply(state, who, op, ctx());
        game.checkInvariants!(state);
      }
      expect(state.phase).toBe("over");
      if (state.result!.winner) decisive++;
    }
    expect(decisive).toBeGreaterThan(0);

    const { state } = setup();
    state.fen = "6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1";
    const view = game.view(state, "alice");
    expect(game.bot.easy(view, game.legalOps(state, "alice").filter((op) => op.type === "move"), seededRandomInt(3))).toEqual({ type: "move", move: "a1a8" });
  });
});
