import { playUntil, type Scenario, scenarioContext } from "../kit/scenario";
import { setTimer } from "../kit/timers";
import type { GameContext } from "../types";
import type { OthelloState } from "./engine";
import { othello as game } from "./index";
import { CORNERS, count, legalMoves } from "./rules";

/** A first game with you as Black (seat 0), played by built-in bots on both sides until `done`, from the first seed that gets there. */
function reach(players: string[], ctx: GameContext, done: (state: OthelloState) => boolean): OthelloState {
  for (let seed = 1; seed <= 200; seed++) {
    const c = scenarioContext(ctx, seed);
    const [you, bot] = players as [string, string];
    const state = game.create(game.configSchema.parse({}), c);
    game.apply(state, you, { type: "sit", seat: 0 }, c);
    game.apply(state, bot, { type: "sit", seat: 1 }, c);
    try {
      playUntil(game, state, c, done, { seed, maxSteps: 130 });
      // Full clocks, not the increments the bots banked by moving in no time.
      if (state.clock && state.phase === "playing") {
        const ms = state.config.minutes * 60_000;
        state.clock = { b: ms, w: ms };
        setTimer(state.timers, "flag", ctx.now + ms);
      }
      return state;
    } catch {
      // The game ended before getting there; try another.
    }
  }
  throw new Error("no seed gets there");
}

const yourMove = (state: OthelloState) => state.phase === "playing" && state.turn === "b";

export const scenarios: Scenario<OthelloState>[] = [
  {
    id: "opening",
    name: "A new game",
    description: "You're Black and move first.",
    bots: 1,
    build: (players, ctx) => reach(players, ctx, () => true),
  },
  {
    id: "corner",
    name: "A corner to take",
    description: "Your move, and one of the corners is yours for the taking.",
    bots: 1,
    build: (players, ctx) => reach(players, ctx, (s) => yourMove(s) && legalMoves(s.board, "b").some((sq) => CORNERS.includes(sq))),
  },
  {
    id: "pass",
    name: "They had to pass",
    description: "White had no move after yours, so it's your turn again.",
    bots: 1,
    build: (players, ctx) => reach(players, ctx, (s) => yourMove(s) && s.moves.at(-1)?.at === null),
  },
  {
    id: "last-move",
    name: "The last square",
    description: "One empty square left and it's your move: fill it and the game is over.",
    bots: 1,
    build: (players, ctx) => reach(players, ctx, (s) => yourMove(s) && count(s.board).empty === 1),
  },
  {
    id: "game-over",
    name: "You won",
    description: "Game over: you have the most discs. Play again is offered.",
    bots: 1,
    build: (players, ctx) => reach(players, ctx, (s) => s.phase === "over" && s.result?.winner === "b"),
  },
];
