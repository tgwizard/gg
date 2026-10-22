/** Seat geometry for card tables. */

/** How round the table is: 2 is an ellipse, higher is boxier (closer to the racetrack drawn). */
const TABLE_EXPONENT = 2.6;

/**
 * A point on the table's outline (k = 1) or inside it (k < 1), for a seat at angle θ.
 * Returns percentages of the table's box.
 */
export function onTable(theta: number, k: number): { x: number; y: number } {
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  const e = 2 / TABLE_EXPONENT;
  return { x: 50 + 50 * k * Math.sign(c) * Math.abs(c) ** e, y: 50 + 50 * k * Math.sign(s) * Math.abs(s) ** e };
}
