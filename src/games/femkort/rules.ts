/**
 * Fem kort's card rules as pure functions, shared by the engine, the bot and the board
 * (which uses them to mark the cards you may play without asking the server).
 */
import { type Card, rankValue, suitOf } from "../kit/cards";

export const HAND_SIZE = 5;

export interface Play {
  seat: number;
  playerId: string;
  card: Card;
}

/** The suit led, or null for an empty trick. */
export function ledSuit(trick: Play[]): string | null {
  return trick[0] ? suitOf(trick[0].card) : null;
}

/** The play winning the trick so far: the highest card of the suit led (there are no trumps). */
export function winningPlay(trick: Play[]): Play | null {
  const led = ledSuit(trick);
  let best: Play | null = null;
  for (const p of trick) if (suitOf(p.card) === led && (!best || rankValue(p.card) > rankValue(best.card))) best = p;
  return best;
}

/**
 * The cards in `hand` that may be played to `trick`: anything to lead; otherwise the
 * suit led if you have it, and (with `mustBeat`, överstick) only the ones that beat the
 * best card so far if you have any. With none of the suit led, anything goes.
 */
export function playable(hand: Card[], trick: Play[], mustBeat: boolean): Card[] {
  const led = ledSuit(trick);
  if (!led) return [...hand];
  const follow = hand.filter((c) => suitOf(c) === led);
  if (!follow.length) return [...hand];
  if (!mustBeat) return follow;
  const high = rankValue(winningPlay(trick)!.card);
  const beat = follow.filter((c) => rankValue(c) > high);
  return beat.length ? beat : follow;
}

const SUIT_ORDER = "shcd";

/** A hand in order: by suit (alternating colors), low to high. */
export function sortHand(hand: Card[]): Card[] {
  return [...hand].sort((a, b) => SUIT_ORDER.indexOf(suitOf(a)) - SUIT_ORDER.indexOf(suitOf(b)) || rankValue(a) - rankValue(b));
}

const SUIT_SYMBOLS: Record<string, string> = { s: "♠", h: "♥", d: "♦", c: "♣" };
const SUIT_NAMES: Record<string, [string, string]> = { s: ["spade", "spades"], h: ["heart", "hearts"], d: ["diamond", "diamonds"], c: ["club", "clubs"] };

export const suitSymbol = (suit: string) => SUIT_SYMBOLS[suit] ?? suit;
export const suitName = (suit: string, plural = true) => SUIT_NAMES[suit]?.[plural ? 1 : 0] ?? suit;

/** "K♠", "10♥": a card in running text. */
export function cardText(card: Card): string {
  return `${card[0] === "T" ? "10" : card[0]}${suitSymbol(card[1]!)}`;
}
