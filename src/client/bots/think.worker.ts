/** The bots' worker (see ./thinker): decides built-in bots' moves, one question at a time. */
import { games } from "../../games/registry";
import type { Question } from "./thinker";

const scope = self as unknown as { onmessage: ((e: MessageEvent<Question & { id: number }>) => void) | null; postMessage(msg: unknown): void };
const random = (maxExclusive: number) => Math.floor(Math.random() * maxExclusive);

scope.onmessage = (e) => {
  const { id, gameId, view, ops, strength } = e.data;
  let op: unknown = null;
  try {
    op = games[gameId]?.bot.play(view, ops, random, { strength }) ?? null;
  } catch (err) {
    console.error("bot failed to decide", err);
  }
  scope.postMessage({ id, op });
};
