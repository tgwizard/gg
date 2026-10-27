import type { CSSProperties } from "react";
import { RIDER_NAMES, RIDERS, type Rider } from "../engine";

/** Each friend's look: an animal on a disc of its rainbow color. */
export const RIDER_LOOK: Record<Rider, { emoji: string; color: string; colorName: string }> = {
  ladybug: { emoji: "🐞", color: "var(--uni-red)", colorName: "red" },
  fox: { emoji: "🦊", color: "var(--uni-orange)", colorName: "orange" },
  chick: { emoji: "🐥", color: "var(--uni-yellow)", colorName: "yellow" },
  frog: { emoji: "🐸", color: "var(--uni-green)", colorName: "green" },
  whale: { emoji: "🐳", color: "var(--uni-blue)", colorName: "blue" },
  octopus: { emoji: "🐙", color: "var(--uni-purple)", colorName: "purple" },
};

export const riderStyle = (r: Rider) => ({ "--rc": RIDER_LOOK[r].color }) as CSSProperties;

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
      {!missing && <span aria-hidden>{RIDER_LOOK[rider].emoji}</span>}
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
              <text x={at.x} y={at.y + 0.5} textAnchor="middle" dominantBaseline="central" className="uni-ring-face">
                {RIDER_LOOK[x].emoji}
              </text>
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
