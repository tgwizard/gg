/**
 * A standard 52-card deck, shared by card games.
 * Cards are two-char strings: rank (23456789TJQKA) + suit (shdc), e.g. "As", "Td".
 */
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

export function rankOf(card: Card): string {
  return card[0]!;
}

const NAMES: Record<string, [string, string]> = {
  "2": ["Two", "Twos"],
  "3": ["Three", "Threes"],
  "4": ["Four", "Fours"],
  "5": ["Five", "Fives"],
  "6": ["Six", "Sixes"],
  "7": ["Seven", "Sevens"],
  "8": ["Eight", "Eights"],
  "9": ["Nine", "Nines"],
  T: ["Ten", "Tens"],
  J: ["Jack", "Jacks"],
  Q: ["Queen", "Queens"],
  K: ["King", "Kings"],
  A: ["Ace", "Aces"],
};

/** "King" / "Kings" for a rank character. */
export function rankName(rank: string, plural = false): string {
  const names = NAMES[rank] ?? [rank, `${rank}s`];
  return plural ? names[1] : names[0];
}

/** Short label for display: "10" for T, otherwise the rank character. */
export function rankLabel(rank: string): string {
  return rank === "T" ? "10" : rank;
}
