/**
 * Dev-only logging: events from the browser (mostly bots) go to the dev server, which
 * writes them to logs/<date>/<room>.log and the terminal (see tools/dev-logs.ts). In
 * production builds this does nothing. Never pass secrets or API keys.
 */
const ENDPOINT = "/__dev/log";
const FLUSH_MS = 400;

interface Entry {
  ts: string;
  room: string;
  source: string;
  event: string;
  data?: unknown;
}

let queue: Entry[] = [];
let timer: ReturnType<typeof setTimeout> | undefined;

export function devLog(room: string, source: string, event: string, data?: unknown) {
  if (!import.meta.env.DEV) return;
  queue.push({ ts: new Date().toISOString(), room, source, event, ...(data === undefined ? {} : { data }) });
  timer ??= setTimeout(flush, FLUSH_MS);
}

// A reload or closing tab would otherwise drop the last batch.
if (import.meta.env.DEV && typeof window !== "undefined") window.addEventListener("pagehide", () => flush());

function flush() {
  clearTimeout(timer);
  timer = undefined;
  const batch = queue;
  queue = [];
  if (batch.length) void fetch(ENDPOINT, { method: "POST", body: JSON.stringify(batch), keepalive: true }).catch(() => {});
}
