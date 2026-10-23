/**
 * The Easy poker bot: a loose, passive player with a rough sense of hand strength.
 * It calls a lot, folds weak hands to big bets and now and then raises a good one.
 */
import { type Card, rankOf, rankValue, suitOf } from "../kit/cards";
import type { GameBot } from "../types";
import type { PokerView } from "./engine";
import type { PokerOp } from "./index";

export const pokerBot: GameBot<PokerView, PokerOp> = {
  easy(view, ops, rand) {
    const find = <T extends PokerOp["type"]>(type: T) => ops.find((op): op is Extract<PokerOp, { type: T }> => op.type === type);
    const rebuy = find("rebuy");
    if (rebuy) return rebuy;
    const hand = view.hand;
    const cards = hand?.players.find((p) => p.seat === view.you.seat)?.cards;
    const actions = view.you.actions;
    if (!hand || !cards || !actions) return null;

    const good = strong(cards, hand.board);
    const raise = find("raise");
    const passive = find("check") ?? find("call")!;
    if (good && raise && rand(4) === 0) return raise; // the smallest raise comes first
    if (actions.canCheck) return passive;
    // Facing a bet: weak hands fold to anything bigger than about a third of the pot.
    const cheap = actions.toCall <= Math.max(hand.bb * 2, hand.pot / 3);
    if (good || cheap || rand(5) === 0) return passive;
    return find("fold")!;
  },
};

/** A pair or better with the board, or a strong-looking starting hand before the flop. */
function strong(cards: Card[], board: Card[]): boolean {
  const [a, b] = cards as [Card, Card];
  if (rankOf(a) === rankOf(b)) return true;
  if (!board.length) return Math.min(rankValue(a), rankValue(b)) >= 10 || (suitOf(a) === suitOf(b) && Math.abs(rankValue(a) - rankValue(b)) === 1);
  const boardRanks = new Set(board.map(rankOf));
  return cards.some((c) => boardRanks.has(rankOf(c)));
}
