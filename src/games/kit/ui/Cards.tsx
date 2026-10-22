import { type Card, rankLabel } from "../cards";
import "./cards.css";

const SUITS: Record<string, string> = { s: "♠", h: "♥", d: "♦", c: "♣" };
const SUIT_NAMES: Record<string, string> = { s: "spades", h: "hearts", d: "diamonds", c: "clubs" };

export function PlayingCard({ card, dim, highlight }: { card: Card; dim?: boolean; highlight?: boolean }) {
  const rank = rankLabel(card[0]!);
  const suit = card[1]!;
  const red = suit === "h" || suit === "d";
  return (
    <div
      className={`pcard ${red ? "red" : ""} ${dim ? "dim" : ""} ${highlight ? "hl" : ""}`}
      aria-label={`${rank} of ${SUIT_NAMES[suit]}`}
      data-card={card}
    >
      <span className="pcard-rank">{rank}</span>
      <span className="pcard-suit">{SUITS[suit]}</span>
    </div>
  );
}

export function CardBack() {
  return <div className="pcard back" aria-label="Face-down card" />;
}

export function CardSlot() {
  return <div className="pcard slot" />;
}
