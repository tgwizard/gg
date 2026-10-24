/** When a running-out timer starts to say so (a heartbeat, the bar pulsing), and when it hurries. */
export const URGENT_MS = 10_000;
export const RACING_MS = 4_000;

/** How pressing `leftMs` is: nothing yet, urgent, or racing (the last few seconds). */
export function urgency(leftMs: number): "urgent" | "racing" | null {
  if (leftMs <= 0 || leftMs > URGENT_MS) return null;
  return leftMs <= RACING_MS ? "racing" : "urgent";
}
