/**
 * Dates and times: ISO 8601 and 24-hour clock everywhere, regardless of the
 * browser's locale (toLocaleTimeString would give "09:07 PM" in en-US).
 */
const pad = (n: number) => String(n).padStart(2, "0");

/** "21:07" in local time. */
export function formatTime(ts: number): string {
  const d = new Date(ts);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** "2026-10-22 21:07:33" in local time. */
export function formatDateTime(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${formatTime(ts)}:${pad(d.getSeconds())}`;
}
