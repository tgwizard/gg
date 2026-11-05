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

type Size = "xs" | "sm" | "md";

/** A train card: a colored card with a little train on it (a rainbow one for a locomotive). */
export function TrainCard({ color, count, size = "md", dim }: { color: CardColor | null; count?: number; size?: Size; dim?: boolean }) {
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

/** Sleepers under the track on a card back, every 4 units. */
const TIES = Array.from({ length: 12 }, (_, i) => `M13 ${4.5 + i * 4.3}h14`).join("");

/**
 * The back of a train card: a night-blue card with a framed track running down it and a
 * gold medallion with a locomotive in the middle. Small ones keep just the frame and
 * the medallion, which still read at 17 pixels.
 */
export function CardBack({ size = "md", title }: { size?: Size; title?: string }) {
  return (
    <span className={`ttr-card back ${size}`} title={title} aria-label={title}>
      <svg className="ttr-back-art" viewBox="0 0 40 56" aria-hidden>
        <rect className="ttr-back-frame" x="3.5" y="3.5" width="33" height="49" rx="3" />
        <g className="ttr-back-track">
          <path className="ties" d={TIES} />
          <path className="rails" d="M16 4v48M24 4v48" />
        </g>
        <circle className="ttr-back-medal" cx="20" cy="28" r="10.5" />
        <circle className="ttr-back-medal-ring" cx="20" cy="28" r="8.2" />
        <g className="ttr-back-loco" transform="translate(13.4 23.6) scale(0.55)">
          <path d="M2 11V6h3V3h7v3h5l5 4v1z" />
          <circle cx="6" cy="13" r="2" />
          <circle cx="12" cy="13" r="2" />
          <circle cx="18" cy="13" r="2" />
        </g>
      </svg>
    </span>
  );
}

/** The back of the deck, with how many are left. */
export function DeckPile({ count, label }: { count: number; label: string }) {
  return (
    <span className="ttr-pile">
      <span className="ttr-deck-stack">
        <CardBack />
      </span>
      <span className="ttr-pile-label">
        {label}
        <span className="num">{count}</span>
      </span>
    </span>
  );
}
