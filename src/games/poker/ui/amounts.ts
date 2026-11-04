/**
 * Bet sizes to pick from between the smallest raise and all-in: those two, and every
 * multiple of `step` (the small blind) in between, so a slider or +/− lands on round
 * amounts. Any whole amount in the range is still legal; these are just the stops.
 */
export interface Stops {
  count: number;
  at(index: number): number;
  indexOf(amount: number): number;
  up(amount: number): number;
  down(amount: number): number;
}

export function betStops(min: number, max: number, step: number): Stops {
  step = Math.max(1, Math.floor(step));
  if (max <= min) {
    return { count: 1, at: () => min, indexOf: () => 0, up: () => min, down: () => min };
  }
  // Multiples of step strictly between min and max: step * lo … step * hi.
  const lo = Math.floor(min / step) + 1;
  const hi = Math.ceil(max / step) - 1;
  const inner = Math.max(0, hi - lo + 1);
  const count = inner + 2;
  const at = (i: number) => (i <= 0 ? min : i >= count - 1 ? max : (lo + i - 1) * step);
  const indexOf = (v: number) => {
    if (v <= min) return 0;
    if (v >= max) return count - 1;
    // The stop at or just under v.
    return Math.min(count - 2, Math.max(0, Math.floor(v / step) - lo + 1));
  };
  return {
    count,
    at,
    indexOf,
    up: (v) => at(v < min ? 0 : at(indexOf(v)) > v ? indexOf(v) : indexOf(v) + 1),
    down: (v) => at(v > max ? count - 1 : at(indexOf(v)) < v ? indexOf(v) : indexOf(v) - 1),
  };
}
