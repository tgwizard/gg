/** Cards are two-char strings: rank (23456789TJQKA) + suit (shdc), e.g. "As", "Td". */
export type Card = string;

export const RANKS = "23456789TJQKA";
export const SUITS = "shdc";

export function newDeck(): Card[] {
  const deck: Card[] = [];
  for (const s of SUITS) for (const r of RANKS) deck.push(r + s);
  return deck;
}

/** Fisher–Yates using the provided (secure) random source. */
export function shuffle<T>(items: T[], randomInt: (maxExclusive: number) => number): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [items[i], items[j]] = [items[j]!, items[i]!];
  }
  return items;
}

/** 2..14 (ace high). */
export function rankValue(card: Card): number {
  return RANKS.indexOf(card[0]!) + 2;
}

export function suitOf(card: Card): string {
  return card[1]!;
}
