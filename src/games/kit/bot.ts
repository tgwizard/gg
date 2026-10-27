/**
 * One decision for a bot, the same for every game: it takes a free seat, comes back
 * in after being sat out, and stands up when it's leaving. Everything else (the
 * game's own moves) is up to the game's bot. Starting games is left to people.
 */
import type { AnyGameDefinition, BotOptions } from "../types";

/** The built-in bot plays easy (see `GameBot`). */
export const easy = (opts?: BotOptions) => opts?.strength === "easy";
/** True `percent` of the time. */
export const chance = (rand: (maxExclusive: number) => number, percent: number) => rand(100) < percent;
import { isLobbyOp, type LobbyOp } from "./lobby";

export type BotIntent = "play" | "leave";

/**
 * A bot never moves sooner than this after the game last changed, however quick its
 * decision, so people see each move (a trick being taken, a disc landing) before the next.
 */
export const BOT_MIN_MOVE_MS = 1_000;

/** How long a bot waits at least after `def` last changed (see `GameMeta.botPaceMs`). */
export const botPace = (def: AnyGameDefinition | null | undefined) => Math.max(BOT_MIN_MOVE_MS, def?.meta.botPaceMs ?? 0);

/** The op to send next, or null to wait for something to change. */
export function botMove(
  def: AnyGameDefinition,
  view: unknown,
  legalOps: unknown[],
  rand: (maxExclusive: number) => number,
  intent: BotIntent = "play",
  opts?: BotOptions,
): unknown {
  return (
    tableMove(legalOps, rand, intent) ??
    (intent === "leave"
      ? null
      : def.bot.play(
          view,
          legalOps.filter((op) => !isLobbyOp(op)),
          rand,
          opts,
        ))
  );
}

/** The table move a bot makes now, if any: a free seat, sitting back in, or leaving. */
export function tableMove(legalOps: unknown[], rand: (maxExclusive: number) => number, intent: BotIntent = "play"): LobbyOp | null {
  const lobby = legalOps.filter(isLobbyOp);
  if (intent === "leave") return lobby.find((op) => op.type === "leave") ?? null;
  const seats = lobby.filter((op) => op.type === "sit");
  if (seats.length) return seats[rand(seats.length)]!;
  return lobby.find((op) => op.type === "sitIn") ?? null;
}
