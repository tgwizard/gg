import { playUntil, type Scenario, scenarioContext } from "../kit/scenario";
import { setTimer } from "../kit/timers";
import type { GameContext } from "../types";
import { goMove } from "./bot";
import { countScore, type GoConfig, type GoState, type GoView } from "./engine";
import { go as game, type GoOp } from "./index";
import { chains } from "./rules";

/** A first game with you as Black (seat 0) against a bot. */
function start(players: string[], ctx: GameContext, config: Partial<GoConfig> = {}): GoState {
  const [you, bot] = players as [string, string];
  const state = game.create(game.configSchema.parse(config), ctx);
  game.apply(state, you, { type: "sit", seat: 0 }, ctx);
  game.apply(state, bot, { type: "sit", seat: 1 }, ctx);
  return state;
}

/** Full clocks, not what the bots used up playing in no time. */
function freshClocks(state: GoState, ctx: GameContext) {
  if (!state.clock || state.phase !== "playing") return;
  const fresh = () => ({ main: state.config.minutes * 60_000, periods: state.config.periods });
  state.clock = { b: fresh(), w: fresh() };
  state.clockSince = ctx.now;
  setTimer(state.timers, "flag", ctx.now + state.clock.b.main + state.clock.b.periods * state.config.seconds * 1000);
}

/** Bots on both sides play until `done`, from the first seed that gets there. */
function reach(
  players: string[],
  ctx: GameContext,
  done: (state: GoState) => boolean,
  opts: { config?: Partial<GoConfig>; maxSteps?: number; playouts?: [black: number, white: number] } = {},
): GoState {
  const [black, white] = opts.playouts ?? [200, 200];
  for (let seed = 1; seed <= 60; seed++) {
    const c = scenarioContext(ctx, seed);
    const state = start(players, c, opts.config);
    try {
      // Better than the quick bots, so the position looks like a real game.
      const policy = (playouts: number) => (view: GoView, ops: GoOp[], rand: (n: number) => number) => goMove(view, ops, rand, { playouts, timeMs: Infinity });
      playUntil(game, state, c, done, { seed, maxSteps: opts.maxSteps ?? 400, policies: { [players[0]!]: policy(black), [players[1]!]: policy(white) } });
      freshClocks(state, ctx);
      return state;
    } catch {
      // The game ended before getting there; try another.
    }
  }
  throw new Error("no seed gets there");
}

const blackAhead = (s: GoState) => {
  const { b, w } = countScore(s.board, s.scoring!.dead);
  return b > w;
};

const yourMove = (state: GoState) => state.phase === "playing" && state.turn === "b";

export const scenarios: Scenario<GoState>[] = [
  {
    id: "opening",
    name: "A new game",
    description: "9×9, you're Black and move first.",
    bots: 1,
    build: (players, ctx) => start(players, ctx),
  },
  {
    id: "capture",
    name: "Stones to take",
    description: "Your move, and a white group is down to its last liberty.",
    bots: 1,
    build: (players, ctx) =>
      reach(players, ctx, (s) => yourMove(s) && s.moves.length > 12 && chains(s.board).some((ch) => ch.color === "w" && ch.liberties.length === 1)),
  },
  {
    id: "ko",
    name: "A ko",
    description: "White just took a stone in a ko: you can't take it straight back, so play elsewhere first.",
    bots: 1,
    build: (players, ctx) => {
      const state = start(players, ctx);
      const c = scenarioContext(ctx);
      for (const point of ["G3", "C3", "C7", "G7", "D6", "E6", "C5", "F5", "D4", "E4", "E5", "D5"]) {
        game.apply(state, game.waitingOn(state)[0]!, { type: "play", point }, c);
      }
      freshClocks(state, ctx);
      return state;
    },
  },
  {
    id: "counting",
    name: "Counting",
    description: "Both passed: mark the dead stones and accept the score, or resume play.",
    bots: 1,
    build: (players, ctx) => reach(players, ctx, (s) => s.phase === "scoring"),
  },
  {
    id: "game-over",
    name: "You won",
    description: "A counted game you won, with the territory on the board. Play again is offered.",
    bots: 1,
    build: (players, ctx) => {
      // You (Black) get the stronger bot, to win in fewer tries.
      const state = reach(players, ctx, (s) => s.phase === "scoring" && blackAhead(s), { playouts: [300, 60] });
      const c = scenarioContext(ctx);
      for (const id of players.slice(0, 2)) game.apply(state, id, { type: "accept" }, c);
      return state;
    },
  },
  {
    id: "big-board",
    name: "A 19×19 game",
    description: "The full-size board, thirty moves in, your move.",
    bots: 1,
    build: (players, ctx) => reach(players, ctx, (s) => yourMove(s) && s.moves.length >= 30, { config: { size: 19, minutes: 20, periods: 5, seconds: 30 }, maxSteps: 60 }),
  },
];
