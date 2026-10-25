/**
 * Dev only: a log sink for the browser. Bots run in the tab, so what they do (wake-ups,
 * prompts, answers, stand-ins) is only visible there; `devLog` in the client sends it
 * here, and this writes it to logs/<YYYY-MM-DD>/<room>.log and a line to the terminal.
 * Not part of builds. Set GG_DEV_LOGS=0 to turn it off (e2e runs do). It takes posts of
 * a bounded size, of entries shaped as below: the dev server is local, but mustn't fill the
 * disk if something else can reach it.
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
/** A post's body (a bot's prompt with a big game view can be tens of KB), and its entries. */
const MAX_BODY = 2 * 1024 * 1024;
const MAX_ENTRIES = 500;

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
        req.on("data", (chunk: Buffer) => {
          body += chunk.toString();
          if (body.length <= MAX_BODY) return;
          res.statusCode = 413;
          res.end();
          req.destroy();
        });
        req.on("end", () => {
          try {
            const entries: unknown = JSON.parse(body);
            if (!Array.isArray(entries) || entries.length > MAX_ENTRIES || !entries.every(isEntry)) throw new Error("not log entries");
            for (const e of entries) write(dir, e);
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

function isEntry(e: unknown): e is DevLogEntry {
  const x = e as Record<string, unknown> | null;
  return !!x && [x.ts, x.room, x.source, x.event].every((v) => typeof v === "string" && v.length < 200);
}

function write(dir: string, e: DevLogEntry) {
  const sent = new Date(e.ts);
  const at = Number.isNaN(sent.getTime()) ? new Date() : sent;
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
