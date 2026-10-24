import { playUntil, type Scenario, scenarioContext } from "../kit/scenario";
import { setTimer } from "../kit/timers";
import type { GameContext } from "../types";
import { threats } from "./bot";
import { boardSize, type LuffaConfig, type LuffaState } from "./engine";
import { luffarschack as game } from "./index";
import { count, squareName } from "./rules";

/** A first game with you drawing the crosses (seat 0), played by built-in bots on both sides until `done`, from the first seed that gets there. */
function reach(players: string[], ctx: GameContext, done: (state: LuffaState) => boolean, config: Partial<LuffaConfig> = {}): LuffaState {
  for (let seed = 1; seed <= 200; seed++) {
    const c = scenarioContext(ctx, seed);
    const state = seated(players, c, config);
    try {
      playUntil(game, state, c, done, { seed, maxSteps: 400 });
      freshTimer(state, ctx);
      return state;
    } catch {
      // The game ended before getting there; try another.
    }
  }
  throw new Error("no seed gets there");
}

function seated(players: string[], ctx: GameContext, config: Partial<LuffaConfig>): LuffaState {
  const [you, bot] = players as [string, string];
  const state = game.create(game.configSchema.parse(config), ctx);
  game.apply(state, you, { type: "sit", seat: 0 }, ctx);
  game.apply(state, bot, { type: "sit", seat: 1 }, ctx);
  return state;
}

/** A whole turn on the clock from now, not what's left of the bots' instant moves. */
function freshTimer(state: LuffaState, ctx: GameContext) {
  if (state.phase === "playing" && state.config.turnSeconds > 0) setTimer(state.timers, "turn", ctx.now + state.config.turnSeconds * 1000);
}

const yourMove = (state: LuffaState) => state.phase === "playing" && state.turn === "x";
const threatsOf = (state: LuffaState, p: "x" | "o") => threats(state.board, boardSize(state), p);

/**
 * A sheet filled with no five anywhere and `empty` squares left (an odd number, so it's your move): crosses and
 * circles in pairs along each row, shifted by two every row, so no line is longer than two.
 */
function nearlyFull(players: string[], ctx: GameContext, empty: number): LuffaState {
  const state = seated(players, ctx, { size: "15" });
  const n = boardSize(state);
  const piece = (cell: number) => (((cell % n) + 2 * Math.floor(cell / n)) % 4 < 2 ? "x" : "o");
  const xs: number[] = [];
  const os: number[] = [];
  for (let cell = 0; cell < n * n; cell++) (piece(cell) === "x" ? xs : os).push(cell);
  // Leave the last squares in reading order, keeping as many crosses as circles (so it's your move).
  while (xs.length + os.length > n * n - empty) (xs.length >= os.length ? xs : os).pop();
  for (let i = 0; i < xs.length; i++) {
    game.apply(state, players[0]!, { type: "mark", square: squareName(n, xs[i]!) }, ctx);
    if (os[i] !== undefined) game.apply(state, players[1]!, { type: "mark", square: squareName(n, os[i]!) }, ctx);
  }
  freshTimer(state, ctx);
  return state;
}

export const scenarios: Scenario<LuffaState>[] = [
  {
    id: "opening",
    name: "A new game",
    description: "A clean 19×19 sheet; you draw the first cross.",
    bots: 1,
    build: (players, ctx) => reach(players, ctx, () => true),
  },
  {
    id: "win",
    name: "Five for the taking",
    description: "Your move, and one cross makes five in a row.",
    bots: 1,
    build: (players, ctx) => reach(players, ctx, (s) => yourMove(s) && s.moves.length >= 12 && threatsOf(s, "x").five.length > 0),
  },
  {
    id: "block",
    name: "Block the four",
    description: "The bot has four in a row with one way to finish it: block it or lose.",
    bots: 1,
    build: (players, ctx) => reach(players, ctx, (s) => yourMove(s) && s.moves.length >= 10 && !threatsOf(s, "x").five.length && threatsOf(s, "o").five.length === 1),
  },
  {
    id: "open-three",
    name: "An open three",
    description: "The bot has an open three: leave it and it becomes an open four you can't stop.",
    bots: 1,
    build: (players, ctx) =>
      reach(players, ctx, (s) => {
        if (!yourMove(s) || s.moves.length < 8) return false;
        const [you, bot] = [threatsOf(s, "x"), threatsOf(s, "o")];
        return !you.five.length && !you.openFour.length && !bot.five.length && bot.openFour.length > 0;
      }),
  },
  {
    id: "small-sheet",
    name: "A 15×15 game",
    description: "The small sheet, ten marks in, your move.",
    bots: 1,
    build: (players, ctx) => reach(players, ctx, (s) => yourMove(s) && s.moves.length >= 10, { size: "15" }),
  },
  {
    id: "big-sheet",
    name: "A 25×25 game",
    description: "The big sheet, a dozen marks in, your move.",
    bots: 1,
    build: (players, ctx) => reach(players, ctx, (s) => yourMove(s) && s.moves.length >= 12, { size: "25" }),
  },
  {
    id: "nearly-full",
    name: "Nearly full",
    description: "A 15×15 sheet with five squares left and no five anywhere: fill it for a draw.",
    bots: 1,
    build: (players, ctx) => nearlyFull(players, ctx, 5),
  },
  {
    id: "game-over",
    name: "You won",
    description: "Game over: your five is ringed on the sheet. Play again is offered.",
    bots: 1,
    build: (players, ctx) => reach(players, ctx, (s) => s.phase === "over" && s.result?.winner === "x" && s.result.reason === "five" && count(s.board).x >= 8),
  },
];
