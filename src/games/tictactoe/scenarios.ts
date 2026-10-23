import { type Scenario, scenarioContext } from "../kit/scenario";
import type { GameContext } from "../types";
import { type TttState, ticTacToe as game } from "./index";

/** You play X and move first; X on 0 and 1, O on 3 and 4. */
function winInOne(players: string[], ctx: GameContext): TttState {
  const c = scenarioContext(ctx);
  const [you, bot] = players as [string, string];
  const state = game.create(game.configSchema.parse({}), c);
  game.apply(state, you, { type: "sit", seat: 0 }, c);
  game.apply(state, bot, { type: "sit", seat: 1 }, c);
  for (const [who, cell] of [[you, 0], [bot, 3], [you, 1], [bot, 4]] as const) game.apply(state, who, { type: "place", cell }, c);
  return state;
}

export const scenarios: Scenario<TttState>[] = [
  {
    id: "win-in-one",
    name: "Win in one",
    description: "Your move as X, with two in a row on top: the top-right square wins.",
    bots: 1,
    build: winInOne,
  },
  {
    id: "won",
    name: "You won",
    description: "You just completed the top row; the next round starts in a few seconds.",
    bots: 1,
    build(players, ctx) {
      const state = winInOne(players, ctx);
      game.apply(state, players[0]!, { type: "place", cell: 2 }, scenarioContext(ctx));
      return state;
    },
  },
];
