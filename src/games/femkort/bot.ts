/**
 * The built-in Fem kort bot. Only the last trick counts, so it plays for that: it keeps
 * the card most likely to take a last trick (an ace, or a king whose ace is gone),
 * dumps its weakest cards on the first tricks, and follows as cheaply as it may. On the
 * fourth trick it weighs keeping its better card against winning the lead for the last
 * trick (whoever leads it needs only their card to stand up in its own suit).
 *
 * "How likely a card is to take the last trick" counts the cards of its suit above it
 * that it hasn't seen played, against the cards the others still hold.
 *
 * Easy, it plays any card it may, except that it keeps its highest for the last trick.
 */
import { chance, easy } from "../kit/bot";
import { type Card, newDeck, rankValue, suitOf } from "../kit/cards";
import type { GameBot } from "../types";
import type { FemView } from "./engine";
import type { FemOp } from "./index";
import { winningPlay } from "./rules";

const DECK = newDeck();

export const femBot: GameBot<FemView, FemOp> = {
  play(view, ops, rand, opts) {
    const me = view.players.find((p) => p.seat === view.you.seat && !p.left);
    const hand = me?.hand ?? [];
    if (easy(opts)) {
      if (ops.some((op) => op.type === "vote")) return { type: "vote", yes: chance(rand, 50) };
      const legal = ops.flatMap((op) => (op.type === "play" ? [op.card] : []));
      if (!legal.length) return null;
      const highest = hand.reduce((a, b) => (rankValue(b) > rankValue(a) ? b : a), hand[0]!);
      const spare = legal.length > 1 && hand.length > 1 ? legal.filter((c) => c !== highest) : legal;
      return { type: "play", card: spare[rand(spare.length)]! };
    }
    const odds = lastTrickOdds(view, hand);
    // Better cards: yes (or ask) with nothing much to keep for the end.
    const weak = hand.length > 0 && Math.max(...hand.map(odds)) < 0.6;
    if (ops.some((op) => op.type === "vote")) return { type: "vote", yes: weak };
    const legal = ops.flatMap((op) => (op.type === "play" ? [op.card] : []));
    if (ops.some((op) => op.type === "betterCards") && view.tricks.length === 0 && weak && rand(2) === 0) return { type: "betterCards" };
    if (!legal.length) return null;
    return { type: "play", card: choose(view, hand, legal, odds, rand) };
  },
};

/** The chance that `card`, led to the last trick, isn't beaten: nobody else holds a higher one of its suit. */
function lastTrickOdds(view: FemView, hand: Card[]): (card: Card, holding?: number) => number {
  const seen = new Set([...hand, ...view.trick.map((p) => p.card), ...view.tricks.flatMap((t) => t.plays.map((p) => p.card))]);
  const unseen = DECK.filter((c) => !seen.has(c));
  const others = view.players.filter((p) => !p.left && p.seat !== view.you.seat);
  const held = others.reduce((n, p) => n + p.cardCount, 0);
  return (card, holding = held) => {
    const higher = unseen.filter((c) => suitOf(c) === suitOf(card) && rankValue(c) > rankValue(card)).length;
    return unseen.length ? (1 - higher / unseen.length) ** holding : 1;
  };
}

function choose(view: FemView, hand: Card[], legal: Card[], odds: (card: Card, holding?: number) => number, rand: (n: number) => number): Card {
  if (legal.length === 1) return legal[0]!;
  const best = (cards: Card[], score: (c: Card) => number) => {
    const top = Math.max(...cards.map(score));
    const tied = cards.filter((c) => score(c) >= top - 1e-9);
    return tied[rand(tied.length)]!;
  };
  const led = view.led;
  const following = led !== null && legal.every((c) => suitOf(c) === led);

  if (hand.length === 2) {
    // The fourth trick: win it to lead the last, or let it go and keep the better card?
    const toPlay = view.players.filter((p) => !p.left).length - view.trick.length - 1;
    const winning = winningPlay(view.trick);
    const wins = (c: Card) => {
      if (!winning) return odds(c, toPlay * 2);
      if (suitOf(c) !== led || rankValue(c) < rankValue(winning.card)) return 0;
      return toPlay === 0 ? 1 : odds(c, toPlay * 2);
    };
    // Not leading the last trick, a card only takes it if the leader happens to lead its suit.
    return best(legal, (c) => {
      const kept = hand.find((k) => k !== c)!;
      return odds(kept) * (0.2 + 0.8 * wins(c));
    });
  }

  // Earlier tricks win nothing: keep the best card for the end and play the cheapest other.
  const anchor = best(hand, (c) => odds(c) + rankValue(c) / 1000);
  const options = legal.filter((c) => c !== anchor).length ? legal.filter((c) => c !== anchor) : legal;
  if (following) return best(options, (c) => -rankValue(c));
  return best(options, (c) => -odds(c) - rankValue(c) / 1000);
}
