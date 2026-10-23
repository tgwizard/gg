/**
 * Dev only: a log sink for the browser. Bots run in the tab, so what they do (wake-ups,
 * prompts, answers, stand-ins) is only visible there; `devLog` in the client sends it
 * here, and this writes it to logs/<YYYY-MM-DD>/<room>.log and a line to the terminal.
 * Not part of builds. Set GG_DEV_LOGS=0 to turn it off (e2e runs do).
 */
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Plugin } from "vite";

export interface DevLogEntry {
  /** ISO 8601, from the browser. */
  ts: string;
  room: string;
  /** Who's talking, e.g. "bot Luna" or "room". */
  source: string;
  event: string;
  data?: unknown;
}

const ENDPOINT = "/__dev/log";
const TERMINAL_MAX = 240;

export function devLogs(dir = "logs"): Plugin {
  return {
    name: "gg-dev-logs",
    apply: "serve",
    configureServer(server) {
      if (process.env.GG_DEV_LOGS === "0") return;
      server.middlewares.use(ENDPOINT, (req, res) => {
        if (req.method !== "POST") {
          res.statusCode = 405;
          return res.end();
        }
        let body = "";
        req.on("data", (chunk: Buffer) => (body += chunk.toString()));
        req.on("end", () => {
          try {
            for (const e of JSON.parse(body) as DevLogEntry[]) write(dir, e);
            res.statusCode = 204;
          } catch {
            res.statusCode = 400;
          }
          res.end();
        });
      });
    },
  };
}

function write(dir: string, e: DevLogEntry) {
  const at = new Date(e.ts);
  const day = localDate(at);
  const time = at.toTimeString().slice(0, 8);
  const room = /^[0-9A-Z]{1,16}$/.test(e.room) ? e.room : "other";
  const data = e.data === undefined ? "" : typeof e.data === "string" ? e.data : JSON.stringify(e.data);
  const folder = join(dir, day);
  mkdirSync(folder, { recursive: true });
  appendFileSync(join(folder, `${room}.log`), `${day} ${time} [${e.source}] ${e.event}${data ? ` ${data}` : ""}\n`);
  const short = data.length > TERMINAL_MAX ? `${data.slice(0, TERMINAL_MAX)}…` : data;
  console.log(`\x1b[2m${time} ${room}\x1b[0m [${e.source}] ${e.event}${short ? ` \x1b[2m${short.replace(/\n/g, "⏎")}\x1b[0m` : ""}`);
}

/** YYYY-MM-DD in local time (not toISOString, which is UTC). */
function localDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
