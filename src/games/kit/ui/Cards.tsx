import { type Card, rankLabel } from "../cards";
import "./cards.css";

/** xs is for cards inline in text; sm for other players' hands; md and lg for the table. */
export type CardSize = "xs" | "sm" | "md" | "lg";

// U+FE0E asks for the text (not emoji) presentation of the suit symbols.
const SUITS: Record<string, string> = { s: "♠︎", h: "♥︎", d: "♦︎", c: "♣︎" };
const SUIT_NAMES: Record<string, string> = { s: "spades", h: "hearts", d: "diamonds", c: "clubs" };

export function PlayingCard({
  card,
  size = "md",
  dim,
  highlight,
  picked,
}: {
  card: Card;
  size?: CardSize;
  /** Out of play (e.g. a folded hand). */
  dim?: boolean;
  /** Part of something good (a winning hand). */
  highlight?: boolean;
  /** Chosen by you. */
  picked?: boolean;
}) {
  const rank = rankLabel(card[0]!);
  const suit = card[1]!;
  const red = suit === "h" || suit === "d";
  const classes = ["pcard", size, red && "red", dim && "dim", highlight && "hl", picked && "picked"].filter(Boolean).join(" ");
  return (
    <div className={classes} aria-label={`${rank} of ${SUIT_NAMES[suit]}`} data-card={card}>
      <div className="pcard-face">
        <span className="pcard-rank">{rank}</span>
        {(size === "md" || size === "lg") && <span className="pcard-corner">{SUITS[suit]}</span>}
        <span className="pcard-pip">{SUITS[suit]}</span>
      </div>
    </div>
  );
}

export function CardBack({ size = "md" }: { size?: CardSize }) {
  return (
    <div className={`pcard ${size} back`} aria-label="Face-down card">
      <div className="pcard-face" />
    </div>
  );
}

/** Where a card will go (an empty board spot). */
export function CardSlot({ size = "md" }: { size?: CardSize }) {
  return (
    <div className={`pcard ${size} slot`}>
      <div className="pcard-face" />
    </div>
  );
}

/** A tight fan of face-down cards, for someone else's hand. */
export function CardFan({ count, max = 7, size = "sm" }: { count: number; max?: number; size?: CardSize }) {
  return (
    <div className={`card-fan ${size}`} aria-label={`${count} ${count === 1 ? "card" : "cards"}`}>
      {Array.from({ length: Math.min(count, max) }, (_, i) => (
        <CardBack key={i} size={size} />
      ))}
      {count > 0 && <span className="card-fan-count">{count}</span>}
    </div>
  );
}
