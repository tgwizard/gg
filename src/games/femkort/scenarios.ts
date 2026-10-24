import { type Card, newDeck } from "../kit/cards";
import { type Scenario, scenarioContext } from "../kit/scenario";
import type { GameContext } from "../types";
import type { FemEvent, FemState } from "./engine";
import { femKort as game } from "./index";

/** You (seat 0) and the bots around a table, a game started with you on lead. */
function table(players: string[], ctx: GameContext, config: object = {}): FemState {
  const c = scenarioContext(ctx);
  const state = game.create(game.configSchema.parse(config), c);
  players.forEach((id, seat) => game.apply(state, id, { type: "sit", seat }, c));
  // The deal passes clockwise from here: the last seat deals and you, on its left, lead.
  state.dealer = players.length - 2;
  game.apply(state, players[0]!, { type: "start" }, c);
  return state;
}

/** Swap cards into a player's hand from wherever they are (others' hands or the stock). */
function give(state: FemState, playerIndex: number, cards: Card[]) {
  const p = state.players[playerIndex]!;
  const spare = p.hand.filter((c) => !cards.includes(c));
  for (const card of cards) {
    if (p.hand.includes(card)) continue;
    const out = spare.pop()!;
    const holder = [state.stock, ...state.players.map((o) => o.hand)].find((h) => h.includes(card))!;
    holder[holder.indexOf(card)] = out;
    p.hand[p.hand.indexOf(out)] = card;
  }
}

/**
 * The sixth deal of a game to 3 between you and two bots, two deals each to you and the
 * first bot (one to the second). The hands are set so that on the fourth trick, your
 * lead with K♠ and 4♥, leading the king loses the deal and leading the heart wins it.
 */
const HANDS: Card[][] = [
  ["3c", "6d", "Qs", "Ks", "4h"],
  ["9c", "4d", "6c", "8h", "2d"],
  ["5c", "Jd", "2s", "Th", "7s"],
];
/** Plays by player index: three tricks (bot 1, bot 2, then you take one), then the end of the deal. */
const PLAYS: [number, Card][] = [
  [0, "3c"], [1, "9c"], [2, "5c"],
  [1, "4d"], [2, "Jd"], [0, "6d"],
  [2, "2s"], [0, "Qs"], [1, "6c"],
  [0, "4h"], [1, "8h"], [2, "Th"],
  [2, "7s"], [0, "Ks"], [1, "2d"],
];
const WON_WITH: Card[][] = [["Kh", "As"], ["Qc", "Ad"], ["Js"]];
const DEAL_WINNERS = [0, 1, 2, 0, 1];

function deciding(players: string[], ctx: GameContext, plays: number): FemState {
  const c = scenarioContext(ctx);
  const state = table(players, ctx);
  const log: FemEvent[] = DEAL_WINNERS.map((i, d) => ({ type: "deal", deal: d + 1, winner: players[i]!, card: WON_WITH[i]![DEAL_WINNERS.slice(0, d).filter((j) => j === i).length]! }));
  state.players.forEach((p, i) => {
    p.hand = [...HANDS[i]!];
    p.wonWith = [...WON_WITH[i]!];
    p.deals = p.wonWith.length;
  });
  state.stock = newDeck().filter((card) => !HANDS.flat().includes(card));
  state.streak = { playerId: players[1]!, count: 1 };
  state.deal = 6;
  state.log = log;
  state.logged = log.length;
  for (const [i, card] of PLAYS.slice(0, plays)) game.apply(state, players[i]!, { type: "play", card }, c);
  return state;
}

export const scenarios: Scenario<FemState>[] = [
  {
    id: "first-deal",
    name: "A new game",
    description: "Three players, five cards each, and you lead the first trick.",
    bots: 2,
    build: (players, ctx) => table(players, ctx),
  },
  {
    id: "fourth-trick",
    name: "Keep the king?",
    description: "Two deals each, and your lead to the fourth trick with K♠ and 4♥: take the lead for the last trick, or keep the king?",
    bots: 2,
    build: (players, ctx) => deciding(players, ctx, 9),
  },
  {
    id: "last-trick",
    name: "The last trick",
    description: "The deal that decides the game: the bot led the 7♠ to the last trick, and you hold the K♠.",
    bots: 2,
    build: (players, ctx) => deciding(players, ctx, 13),
  },
  {
    id: "game-over",
    name: "You won",
    description: "Game over: your K♠ took the last trick and your third deal.",
    bots: 2,
    build: (players, ctx) => deciding(players, ctx, PLAYS.length),
  },
  {
    id: "better-cards",
    name: "Bättre kort",
    description: "Playing with better cards: your lead with nothing above a 6. Ask for new cards, and the bots answer.",
    bots: 2,
    build(players, ctx) {
      const state = table(players, ctx, { betterCards: true });
      give(state, 0, ["2c", "4s", "5d", "3h", "6c"]);
      return state;
    },
  },
];
