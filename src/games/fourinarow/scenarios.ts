import { playUntil, type Scenario, scenarioContext } from "../kit/scenario";
import { setTimer } from "../kit/timers";
import type { GameContext } from "../types";
import { type FourConfig, type FourState, sizeOf } from "./engine";
import { fourInARow as game } from "./index";
import { count, openColumns, type Piece } from "./rules";
import { Position } from "./search";

/** A first game with you starting (seat 0), played by built-in bots on both sides until `done`, from the first seed that gets there. */
function reach(players: string[], ctx: GameContext, done: (state: FourState) => boolean, config: Partial<FourConfig> = {}): FourState {
  for (let seed = 1; seed <= 200; seed++) {
    const c = scenarioContext(ctx, seed);
    const [you, bot] = players as [string, string];
    const state = game.create(game.configSchema.parse(config), c);
    game.apply(state, you, { type: "sit", seat: 0 }, c);
    game.apply(state, bot, { type: "sit", seat: 1 }, c);
    try {
      playUntil(game, state, c, done, { seed, maxSteps: 70 });
      // Full clocks, not the increments the bots banked by moving in no time.
      if (state.clock && state.phase === "playing") {
        const ms = state.config.minutes * 60_000;
        state.clock = { x: ms, o: ms };
        state.clockSince = ctx.now;
        setTimer(state.timers, "flag", ctx.now + ms);
      }
      return state;
    } catch {
      // The game ended before getting there; try another.
    }
  }
  throw new Error("no seed gets there");
}

const yourMove = (state: FourState) => state.phase === "playing" && state.turn === "x";

/** Columns where `p` would complete four right now. */
function winningColumns(state: FourState, p: Piece): number[] {
  const size = sizeOf(state);
  const pos = Position.fromBoard(state.board, size.columns, size.rows);
  return openColumns(state.board, size).filter((c) => pos.wins(c, p === "x" ? 0 : 1));
}

export const scenarios: Scenario<FourState>[] = [
  {
    id: "opening",
    name: "A new game",
    description: "7×6, you drop the first disc.",
    bots: 1,
    build: (players, ctx) => reach(players, ctx, () => true),
  },
  {
    id: "win",
    name: "Four for the taking",
    description: "Your move, and one drop wins the game.",
    bots: 1,
    build: (players, ctx) => reach(players, ctx, (s) => yourMove(s) && s.moves.length >= 10 && winningColumns(s, "x").length > 0),
  },
  {
    id: "block",
    name: "Block them",
    description: "The bot has three in a row with the fourth spot open: block it or lose.",
    bots: 1,
    build: (players, ctx) => reach(players, ctx, (s) => yourMove(s) && s.moves.length >= 8 && !winningColumns(s, "x").length && winningColumns(s, "o").length === 1),
  },
  {
    id: "nearly-full",
    name: "Nearly full",
    description: "A few spots left and your move: fill the board for a draw, or find the four.",
    bots: 1,
    build: (players, ctx) => reach(players, ctx, (s) => yourMove(s) && count(s.board).empty <= 6),
  },
  {
    id: "big-board",
    name: "A 9×7 game",
    description: "The biggest board, a dozen discs in, your move.",
    bots: 1,
    build: (players, ctx) => reach(players, ctx, (s) => yourMove(s) && s.moves.length >= 12, { board: "9x7" }),
  },
  {
    id: "game-over",
    name: "You won",
    description: "Game over: four in a row is yours, lit up on the board. Play again is offered.",
    bots: 1,
    build: (players, ctx) => reach(players, ctx, (s) => s.phase === "over" && s.result?.winner === "x" && s.result.reason === "four"),
  },
];
