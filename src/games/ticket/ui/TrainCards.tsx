import type { CardColor } from "../map";

const NAMES: Record<CardColor, string> = {
  red: "Red",
  orange: "Orange",
  yellow: "Yellow",
  green: "Green",
  blue: "Blue",
  pink: "Pink",
  white: "White",
  black: "Black",
  loco: "Locomotive",
};

export const cardName = (c: CardColor, n = 1) => (c === "loco" ? (n === 1 ? "locomotive" : "locomotives") : NAMES[c].toLowerCase());

/** A train card: a colored card with a little train on it (a rainbow one for a locomotive). */
export function TrainCard({ color, count, size = "md", dim }: { color: CardColor | null; count?: number; size?: "xs" | "sm" | "md"; dim?: boolean }) {
  if (!color) return <span className={`ttr-card empty ${size}`} aria-label="No card" />;
  return (
    <span className={`ttr-card c-${color} ${size}${dim ? " dim" : ""}`} data-color={color} title={NAMES[color]} aria-label={count === undefined ? NAMES[color] : `${count} × ${NAMES[color]}`}>
      <TrainGlyph />
      {count !== undefined && <span className="ttr-card-count num">{count}</span>}
    </span>
  );
}

function TrainGlyph() {
  return (
    <svg className="ttr-card-glyph" viewBox="0 0 24 16" aria-hidden>
      <path d="M2 11V6h3V3h7v3h5l5 4v1z" />
      <circle cx="6" cy="13" r="2" />
      <circle cx="12" cy="13" r="2" />
      <circle cx="18" cy="13" r="2" />
    </svg>
  );
}

/** The back of the deck, with how many are left. */
export function DeckPile({ count, label }: { count: number; label: string }) {
  return (
    <span className="ttr-pile">
      <span className="ttr-card back md" />
      <span className="ttr-pile-label">
        {label}
        <span className="num">{count}</span>
      </span>
    </span>
  );
}
