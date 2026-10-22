/** Helpers for poker tests: deterministic contexts and rigged decks. */
import { seededRandomInt } from "../kit/testing";
import type { GameContext } from "../types";
import type { Card } from "../kit/cards";
import type { PokerState } from "./engine";

export function makeCtx(opts: { now?: number; seed?: number } = {}) {
  const announcements: string[] = [];
  const randomInt = seededRandomInt(opts.seed ?? 1);
  const ctx = (now = opts.now ?? 0): GameContext => ({
    now,
    randomInt,
    nameOf: (id) => id,
    announce: (t) => announcements.push(t),
  });
  return { ctx, announcements };
}

/** Replace hole cards and the remaining deck so the board comes out as given. */
export function rig(state: PokerState, holes: Record<number, Card[]>, board: Card[]) {
  const hand = state.hand!;
  for (const p of hand.players) if (holes[p.seat]) p.cards = holes[p.seat]!;
  const remaining = board.slice(hand.board.length);
  // Deck pops from the end: burn, flop x3, burn, turn, burn, river.
  const order: Card[] = [];
  let i = 0;
  if (hand.board.length < 3) order.push("Xb", remaining[i++]!, remaining[i++]!, remaining[i++]!);
  while (i < remaining.length) order.push("Xb", remaining[i++]!);
  hand.deck = order.reverse();
}

export function totalChips(state: PokerState): number {
  const stacks = state.seats.reduce((n, s) => n + (s?.stack ?? 0), 0);
  const inPot = state.hand && state.hand.status !== "complete" ? state.hand.players.reduce((n, p) => n + p.committed, 0) : 0;
  return stacks + inPot;
}
