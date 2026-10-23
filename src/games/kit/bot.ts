/**
 * One decision for a bot, the same for every game: it takes a free seat, comes back
 * in after being sat out, and stands up when it's leaving. Everything else (the
 * game's own moves) is up to the game's bot. Starting games is left to people.
 */
import type { AnyGameDefinition, BotOptions } from "../types";
import { isLobbyOp, type LobbyOp } from "./lobby";

export type BotIntent = "play" | "leave";

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
      : def.bot.easy(
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
