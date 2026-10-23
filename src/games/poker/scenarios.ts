import { newDeck, shuffle } from "../kit/cards";
import { type Policy, playUntil, type Scenario, scenarioContext } from "../kit/scenario";
import type { GameContext } from "../types";
import type { PokerState, PokerView } from "./engine";
import { type PokerOp, poker as game } from "./index";

const BOT_SEAT = 4;
/** You flop the nut flush draw and make it on the river; the bot flopped a set of Kings. */
const YOUR_CARDS = ["Ah", "5h"];
const BOT_CARDS = ["Kd", "Ks"];
const BOARD = ["Kh", "9h", "4c", "Jd", "2h"];

const passive: Policy<PokerView, PokerOp> = (_view, ops) => ops.find((op) => op.type === "check") ?? ops.find((op) => op.type === "call")!;
const isRiver = (state: PokerState) => state.hand?.street === "river";

/**
 * Heads-up, first hand: the bot raises before the flop and bets the flop, you call,
 * the turn goes check-check. On the river it moves all-in, and it's your call.
 */
function riverShove(players: string[], ctx: GameContext): PokerState {
  const c = scenarioContext(ctx);
  const [you, bot] = players as [string, string];
  const state = game.create(game.configSchema.parse({}), c);
  game.apply(state, you, { type: "sit", seat: 0 }, c);
  game.apply(state, bot, { type: "sit", seat: BOT_SEAT }, c);
  game.apply(state, you, { type: "start" }, c);

  const aggressor: Policy<PokerView, PokerOp> = (view, ops, rand) => {
    const target = { preflop: 30, flop: 60, turn: 0, river: 0 }[view.hand!.street];
    const canRaise = ops.some((op) => op.type === "raise");
    return canRaise && view.hand!.currentBet < target ? { type: "raise", to: target } : passive(view, ops, rand);
  };
  playUntil(game, state, c, isRiver, { policies: { [you]: passive, [bot]: aggressor } });

  // The cards, as if dealt that way: the rest of the deck stays a deck (less three burns).
  const hand = state.hand!;
  for (const p of hand.players) p.cards = [...(p.playerId === you ? YOUR_CARDS : BOT_CARDS)];
  hand.board = [...BOARD];
  const used = new Set([...YOUR_CARDS, ...BOT_CARDS, ...BOARD]);
  hand.deck = shuffle(newDeck().filter((card) => !used.has(card)), c.randomInt).slice(3);

  const shove: Policy<PokerView, PokerOp> = (_view, ops) => ops.findLast((op) => op.type === "raise") ?? null;
  playUntil(game, state, c, (s) => s.hand?.toAct === 0 && hand.currentBet > 0, { policies: { [you]: passive, [bot]: shove } });
  return state;
}

export const scenarios: Scenario<PokerState>[] = [
  {
    id: "river-call",
    name: "All-in on the river",
    description: "Heads-up: you made the nut flush on the river and the bot has moved all-in. Call (or fold).",
    bots: 1,
    build: riverShove,
  },
  {
    id: "showdown",
    name: "Showdown",
    description: "You called the river all-in: the hands are shown and your flush takes the bot's stack.",
    bots: 1,
    build(players, ctx) {
      const state = riverShove(players, ctx);
      game.apply(state, players[0]!, { type: "call" }, scenarioContext(ctx));
      return state;
    },
  },
];
