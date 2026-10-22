import { type Card, rankValue, suitOf } from "./cards";

/** [category, ...tiebreakers]; compare lexicographically. Higher is better. */
export type Score = number[];

export interface HandValue {
  score: Score;
  name: string;
  cards: Card[];
}

const NAMES: Record<number, [string, string]> = {
  2: ["Two", "Twos"],
  3: ["Three", "Threes"],
  4: ["Four", "Fours"],
  5: ["Five", "Fives"],
  6: ["Six", "Sixes"],
  7: ["Seven", "Sevens"],
  8: ["Eight", "Eights"],
  9: ["Nine", "Nines"],
  10: ["Ten", "Tens"],
  11: ["Jack", "Jacks"],
  12: ["Queen", "Queens"],
  13: ["King", "Kings"],
  14: ["Ace", "Aces"],
};
const one = (v: number | undefined) => NAMES[v ?? 2]![0];
const many = (v: number | undefined) => NAMES[v ?? 2]![1];

export function evaluate5(cards: Card[]): Score {
  const values = cards.map(rankValue).sort((a, b) => b - a);
  const flush = cards.every((c) => suitOf(c) === suitOf(cards[0]!));

  let straightHigh = 0;
  if (new Set(values).size === 5) {
    if (values[0]! - values[4]! === 4) straightHigh = values[0]!;
    else if (values[0] === 14 && values[1] === 5) straightHigh = 5; // wheel
  }
  if (straightHigh && flush) return [8, straightHigh];

  const counts = new Map<number, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const ordered = groups.map(([v]) => v);
  const [first, second] = groups.map(([, n]) => n);

  if (first === 4) return [7, ...ordered];
  if (first === 3 && second === 2) return [6, ...ordered];
  if (flush) return [5, ...values];
  if (straightHigh) return [4, straightHigh];
  if (first === 3) return [3, ...ordered];
  if (first === 2 && second === 2) return [2, ...ordered];
  if (first === 2) return [1, ...ordered];
  return [0, ...values];
}

export function compareScores(a: Score, b: Score): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

export function describeScore(score: Score): string {
  const [cat, a, b] = score;
  switch (cat) {
    case 8:
      return a === 14 ? "Royal Flush" : `Straight Flush, ${one(a)} high`;
    case 7:
      return `Four of a Kind, ${many(a)}`;
    case 6:
      return `Full House, ${many(a)} full of ${many(b)}`;
    case 5:
      return `Flush, ${one(a)} high`;
    case 4:
      return `Straight, ${one(a)} high`;
    case 3:
      return `Three of a Kind, ${many(a)}`;
    case 2:
      return `Two Pair, ${many(a)} and ${many(b)}`;
    case 1:
      return `Pair of ${many(a)}`;
    default:
      return `High Card, ${one(a)}`;
  }
}

/** Best 5-card hand out of 5–7 cards. */
export function bestHand(cards: Card[]): HandValue {
  let best: { score: Score; cards: Card[] } | null = null;
  const n = cards.length;
  for (let a = 0; a < n; a++)
    for (let b = a + 1; b < n; b++)
      for (let c = b + 1; c < n; c++)
        for (let d = c + 1; d < n; d++)
          for (let e = d + 1; e < n; e++) {
            const hand = [cards[a]!, cards[b]!, cards[c]!, cards[d]!, cards[e]!];
            const score = evaluate5(hand);
            if (!best || compareScores(score, best.score) > 0) best = { score, cards: hand };
          }
  if (!best) throw new Error("bestHand needs at least 5 cards");
  return { ...best, name: describeScore(best.score) };
}
