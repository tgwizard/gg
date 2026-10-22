import { PixelIcon } from "../../../ui";
import { type Card, rankLabel } from "../cards";
import "./cards.css";

export type CardSize = "sm" | "md" | "lg";

const SUITS = { s: "spade", h: "heart", d: "diamond", c: "club" } as const;
const SUIT_NAMES: Record<string, string> = { s: "spades", h: "hearts", d: "diamonds", c: "clubs" };
const PIP_SCALE: Record<CardSize, number> = { sm: 2, md: 3, lg: 4 };

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
  const suit = card[1] as keyof typeof SUITS;
  const red = suit === "h" || suit === "d";
  const classes = ["pcard", size, red && "red", dim && "dim", highlight && "hl", picked && "picked"].filter(Boolean).join(" ");
  return (
    <div className={classes} aria-label={`${rank} of ${SUIT_NAMES[suit]}`} data-card={card}>
      <div className="pcard-face">
        <span className="pcard-rank">{rank}</span>
        {size !== "sm" && <PixelIcon name={SUITS[suit]} scale={1} className="pcard-corner" />}
        <PixelIcon name={SUITS[suit]} scale={PIP_SCALE[size]} className="pcard-pip" />
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
      {count > 0 && <span className="card-fan-count num">{count}</span>}
    </div>
  );
}
