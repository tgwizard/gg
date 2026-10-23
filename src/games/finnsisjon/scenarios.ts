import { setTimer } from "../kit/timers";
import { type Scenario, scenarioContext } from "../kit/scenario";
import type { GameContext } from "../types";
import type { FishEvent, FishState } from "./engine";
import { finnsISjon as game } from "./index";

/** Books laid down so far, in order, by player index (0 = you). The Queens are still out. */
const BOOKS: [number, string][] = [
  [1, "7"], [0, "3"], [2, "J"], [1, "2"], [0, "9"], [0, "K"],
  [1, "A"], [2, "5"], [0, "6"], [1, "T"], [0, "4"], [1, "8"],
];

/**
 * Three players, 12 books down (you 5, the first bot 5, the second 2), the lake empty,
 * and your turn. You hold two Queens and the first bot the other two: it just asked
 * the second bot for Queens and got none.
 */
function lastBook(players: string[], ctx: GameContext): FishState {
  const c = scenarioContext(ctx);
  const state = game.create(game.configSchema.parse({}), c);
  players.forEach((id, seat) => game.apply(state, id, { type: "sit", seat }, c));
  game.apply(state, players[0]!, { type: "start" }, c);

  const log: FishEvent[] = BOOKS.map(([i, rank]) => ({ type: "book", who: players[i]!, rank }));
  log.push({ type: "ask", from: players[1]!, to: players[2]!, rank: "Q", got: 0, cards: [] });
  state.players.forEach((p, i) => {
    p.books = BOOKS.filter(([j]) => j === i).map(([, rank]) => rank);
    p.hand = i === 0 ? ["Qh", "Qs"] : i === 1 ? ["Qd", "Qc"] : [];
    p.lastDrawn = null;
  });
  state.lake = [];
  state.log = log;
  state.logged = log.length;
  state.turn = state.players[0]!.seat;
  state.turnEndsAt = state.config.turnSeconds > 0 ? ctx.now + state.config.turnSeconds * 1000 : null;
  setTimer(state.timers, "turn", state.turnEndsAt);
  return state;
}

export const scenarios: Scenario<FishState>[] = [
  {
    id: "last-book",
    name: "Last book",
    description: "12 books down and your turn: ask the first bot for Queens to lay down the last book and win.",
    bots: 2,
    build: lastBook,
  },
  {
    id: "won",
    name: "You won",
    description: "Game over: you laid down the last book and won 6–5–2.",
    bots: 2,
    build(players, ctx) {
      const state = lastBook(players, ctx);
      game.apply(state, players[0]!, { type: "ask", target: players[1]!, rank: "Q" }, scenarioContext(ctx));
      return state;
    },
  },
];
