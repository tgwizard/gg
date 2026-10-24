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

/**
 * The local time zone's short name at `ts`: "CEST", "EDT", "BST". Each locale only knows
 * the abbreviations people use there (en-US says "GMT+2" for Stockholm), so it's asked
 * of both; places without a common one get "GMT+9".
 */
export function formatZone(ts: number, timeZone?: string): string {
  const names = ["en-US", "en-GB"].map(
    (locale) => new Intl.DateTimeFormat(locale, { timeZone, timeZoneName: "short" }).formatToParts(ts).find((p) => p.type === "timeZoneName")?.value ?? "",
  );
  return names.find((n) => n && !/^(GMT|UTC)[+-]/.test(n)) ?? names[0]!;
}

/** "2026-10-22 21:07:33 CEST": for tooltips, where there's room to say which clock. */
export function formatDateTimeZone(ts: number): string {
  return `${formatDateTime(ts)} ${formatZone(ts)}`;
}
