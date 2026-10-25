/**
 * Where built-in bots decide their moves: in a worker, off the page's thread, so a bot
 * searching for its move (Four in a Row, Go) never holds up the page. One worker serves
 * every bot on the page, a move at a time. Where there are no workers (unit tests), and
 * if the worker fails, they decide on the page instead.
 */
import type { BotStrength } from "../../games/types";

export interface Question {
  gameId: string;
  view: unknown;
  /** The game's own legal moves (no table moves). */
  ops: unknown[];
  strength: BotStrength;
}

let worker: Worker | null | undefined;
let asked = 0;
const waiting = new Map<number, { question: Question; answer(op: unknown): void }>();

/** The built-in bot's move (or null to wait). */
export function decide(question: Question): Promise<unknown> {
  worker ??= start();
  if (!worker) return onThePage(question);
  const id = ++asked;
  return new Promise((answer) => {
    waiting.set(id, { question, answer });
    worker!.postMessage({ id, ...question });
  });
}

function start(): Worker | null {
  if (typeof Worker === "undefined") return null;
  try {
    const w = new Worker(new URL("./think.worker.ts", import.meta.url), { type: "module", name: "bots" });
    w.onmessage = (e: MessageEvent<{ id: number; op: unknown }>) => {
      waiting.get(e.data.id)?.answer(e.data.op);
      waiting.delete(e.data.id);
    };
    w.onerror = (e) => {
      console.warn("The bots' worker failed; they think on the page from now on.", e.message);
      worker = null;
      w.terminate();
      for (const { question, answer } of waiting.values()) void onThePage(question).then(answer);
      waiting.clear();
    };
    return w;
  } catch {
    return null;
  }
}

async function onThePage({ gameId, view, ops, strength }: Question): Promise<unknown> {
  const { games } = await import("../../games/registry");
  return games[gameId]?.bot.play(view, ops, (n) => Math.floor(Math.random() * n), { strength }) ?? null;
}
