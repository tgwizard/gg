import type { Card } from "../../kit/cards";
import { PlayingCard } from "../../kit/ui/Cards";

/** Each kind of hand, best first: an example, with the cards that don't count greyed. */
const HANDS: { name: string; what: string; cards: Card[]; counts?: number }[] = [
  { name: "Royal flush", what: "Ace-high straight flush: the best there is.", cards: ["As", "Ks", "Qs", "Js", "Ts"] },
  { name: "Straight flush", what: "Five in a row, all one suit.", cards: ["9h", "8h", "7h", "6h", "5h"] },
  { name: "Four of a kind", what: "Four cards of one rank.", cards: ["Qc", "Qd", "Qh", "Qs", "7d"], counts: 4 },
  { name: "Full house", what: "Three of a kind and a pair.", cards: ["Kh", "Kc", "Kd", "9s", "9h"] },
  { name: "Flush", what: "Five of one suit, in any order.", cards: ["Ad", "Jd", "8d", "6d", "2d"] },
  { name: "Straight", what: "Five in a row, any suits. The Ace can be low: 5-4-3-2-A.", cards: ["Tc", "9d", "8s", "7h", "6c"] },
  { name: "Three of a kind", what: "Three cards of one rank.", cards: ["8s", "8h", "8c", "Kd", "4s"], counts: 3 },
  { name: "Two pair", what: "Two pairs of different ranks.", cards: ["Jh", "Jc", "5s", "5d", "Ac"], counts: 4 },
  { name: "One pair", what: "Two cards of one rank.", cards: ["Ah", "Ad", "9c", "6s", "3h"], counts: 2 },
  { name: "High card", what: "None of the above: your highest card plays.", cards: ["As", "Jd", "8c", "5h", "2s"], counts: 1 },
];

/** For the rules: the hands, best to worst, with cards. */
export function HandRankings() {
  return (
    <section className="hand-rankings" aria-label="Poker hands, best first">
      <h4 className="label">Hands, best to worst</h4>
      <ol>
        {HANDS.map((h) => (
          <li key={h.name}>
            <span className="hand-cards">
              {h.cards.map((c, i) => (
                <PlayingCard key={c} card={c} size="sm" dim={h.counts !== undefined && i >= h.counts} />
              ))}
            </span>
            <span className="hand-text">
              <strong>{h.name}</strong>
              <span className="muted">{h.what}</span>
            </span>
          </li>
        ))}
      </ol>
      <p className="muted small">
        You make the best five cards you can from your two and the five on the table. Hands of the same kind go by their cards: a pair of Aces beats a pair of Kings, and when that's equal
        too, the highest other cards (kickers) decide. Suits never rank; hands that are just as good split the pot.
      </p>
    </section>
  );
}
