import type { CSSProperties } from "react";
import { RIDER_NAMES, RIDERS, type Rider } from "../engine";
import chick from "./art/chick.webp";
import fox from "./art/fox.webp";
import frog from "./art/frog.webp";
import ladybug from "./art/ladybug.webp";
import octopus from "./art/octopus.webp";
import unicorn from "./art/unicorn.webp";
import whale from "./art/whale.webp";

/** Each friend's look: a toy figurine, its rainbow color, and an emoji for them in text. */
export const RIDER_LOOK: Record<Rider, { emoji: string; art: string; color: string; colorName: string }> = {
  ladybug: { emoji: "🐞", art: ladybug, color: "var(--uni-red)", colorName: "red" },
  fox: { emoji: "🦊", art: fox, color: "var(--uni-orange)", colorName: "orange" },
  chick: { emoji: "🐥", art: chick, color: "var(--uni-yellow)", colorName: "yellow" },
  frog: { emoji: "🐸", art: frog, color: "var(--uni-green)", colorName: "green" },
  whale: { emoji: "🐳", art: whale, color: "var(--uni-blue)", colorName: "blue" },
  octopus: { emoji: "🐙", art: octopus, color: "var(--uni-purple)", colorName: "purple" },
};

export type Who = Rider | "unicorn";
const artOf = (who: Who) => (who === "unicorn" ? unicorn : RIDER_LOOK[who].art);

export const riderStyle = (r: Rider) => ({ "--rc": RIDER_LOOK[r].color }) as CSSProperties;

/**
 * A figurine standing on the board: its feet at (0, 0), `h` tall, facing right (left with
 * `flip`). The art is cut out round the figure, so it stands on whatever is under it.
 */
export function Figure({ who, h, flip }: { who: Who; h: number; flip?: boolean }) {
  return (
    <g className={`uni-figure ${flip ? "flip" : ""}`}>
      <image href={artOf(who)} x={-0.65 * h} y={-h} width={1.3 * h} height={h} preserveAspectRatio="xMidYMax meet" />
    </g>
  );
}

/** The same figurine in a line of text or on a button. */
export function FigureImg({ who, className }: { who: Who; className?: string }) {
  return <img className={`uni-figure-img ${className ?? ""}`} src={artOf(who)} alt="" draggable={false} />;
}

/** A friend as a round token; `missing` shows the empty place they'll take. */
export function RiderToken({ rider, missing, size = "md" }: { rider: Rider; missing?: boolean; size?: "sm" | "md" | "lg" }) {
  return (
    <span
      className={`uni-rider ${size} ${missing ? "missing" : ""}`}
      style={riderStyle(rider)}
      title={missing ? `No ${RIDER_NAMES[rider]} yet` : RIDER_NAMES[rider]}
      data-rider={rider}
      data-missing={missing || undefined}
    >
      {!missing && <FigureImg who={rider} />}
    </span>
  );
}

/**
 * How far along someone is: a ring of six segments, one per friend in its color, filled
 * as they come aboard (with the friend on it), and how many so far in the middle; with
 * all six, the castle.
 */
export function FriendRing({ riders, size = 74 }: { riders: Rider[]; size?: number }) {
  const arc = (from: number, to: number, r: number) => {
    const p = (deg: number) => `${(32 + r * Math.cos((deg * Math.PI) / 180)).toFixed(2)} ${(32 + r * Math.sin((deg * Math.PI) / 180)).toFixed(2)}`;
    return `M ${p(from)} A ${r} ${r} 0 0 1 ${p(to)}`;
  };
  const all = riders.length === RIDERS.length;
  return (
    <svg className={`uni-ring ${all ? "all" : ""}`} viewBox="0 0 64 64" width={size} height={size} role="img" aria-label={`${riders.length} of ${RIDERS.length} friends`} data-testid="uni-ring" data-count={riders.length}>
      {RIDERS.map((x, i) => {
        const mid = -90 + i * 60;
        const on = riders.includes(x);
        const at = { x: 32 + 25 * Math.cos((mid * Math.PI) / 180), y: 32 + 25 * Math.sin((mid * Math.PI) / 180) };
        return (
          <g key={x} className={on ? "on" : "off"} style={riderStyle(x)}>
            <path className="uni-ring-seg" d={arc(mid - 26, mid + 26, 25)} />
            {on && (
              <g className="uni-ring-face" transform={`translate(${at.x.toFixed(2)} ${(at.y + 6).toFixed(2)})`}>
                <Figure who={x} h={12} />
              </g>
            )}
          </g>
        );
      })}
      <text x={32} y={33} textAnchor="middle" dominantBaseline="central" className="uni-ring-count">
        {all ? "🏰" : riders.length}
      </text>
    </svg>
  );
}
