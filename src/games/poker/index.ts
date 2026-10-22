import { z } from "zod";
import { seatedPlayers } from "../kit/seating";
import type { GameDefinition } from "../types";
import {
  act,
  canStart,
  createState,
  handInProgress,
  inCurrentHand,
  legalActions,
  leave,
  nextDeadline,
  onDeadline,
  type PokerConfig,
  type PokerState,
  type PokerView,
  rebuy,
  SEAT_COUNT,
  seatOf,
  setSittingOut,
  sit,
  start,
  viewFor,
} from "./engine";
import { pokerMeta } from "./meta";

const configSchema = z
  .object({
    startingStack: z.number().int().min(20).max(1_000_000).default(1000),
    smallBlind: z.number().int().min(1).max(100_000).default(5),
    bigBlind: z.number().int().min(2).max(200_000).default(10),
    turnSeconds: z.number().int().min(0).max(600).default(60),
  })
  .refine((c) => c.bigBlind >= c.smallBlind, "Big blind must be at least the small blind.")
  .refine((c) => c.startingStack >= c.bigBlind * 2, "Starting stack must cover at least two big blinds.");

export const pokerOp = z.discriminatedUnion("type", [
  z.object({ type: z.literal("sit"), seat: z.number().int().min(0).max(SEAT_COUNT - 1) }),
  z.object({ type: z.literal("leave") }),
  z.object({ type: z.literal("sitOut") }),
  z.object({ type: z.literal("sitIn") }),
  z.object({ type: z.literal("rebuy") }),
  z.object({ type: z.literal("start") }),
  z.object({ type: z.literal("fold") }),
  z.object({ type: z.literal("check") }),
  z.object({ type: z.literal("call") }),
  z.object({ type: z.literal("raise"), to: z.number().int().positive() }),
]);
export type PokerOp = z.infer<typeof pokerOp>;

export const poker: GameDefinition<PokerState, PokerOp, PokerView, PokerConfig> = {
  meta: pokerMeta,
  configSchema,
  opSchema: pokerOp,
  create: (config) => createState(config),
  apply(state, actor, op, ctx) {
    switch (op.type) {
      case "sit":
        return sit(state, actor, op.seat, ctx);
      case "leave":
        return leave(state, actor, ctx);
      case "sitOut":
        return setSittingOut(state, actor, true, ctx);
      case "sitIn":
        return setSittingOut(state, actor, false, ctx);
      case "rebuy":
        return rebuy(state, actor, ctx);
      case "start":
        return start(state, ctx);
      default:
        return act(state, actor, op, ctx);
    }
  },
  view: viewFor,
  players: seatedPlayers,
  waitingOn(state) {
    const hand = state.hand;
    if (hand?.status !== "betting" || hand.toAct === null) return [];
    const seat = state.seats[hand.toAct];
    return seat ? [seat.playerId] : [];
  },
  legalOps(state, player) {
    const seat = seatOf(state, player);
    if (seat < 0) return state.seats.flatMap((s, i) => (s ? [] : [{ type: "sit" as const, seat: i }]));
    const me = state.seats[seat]!;
    const ops: PokerOp[] = [{ type: "leave" }, me.sittingOut ? { type: "sitIn" } : { type: "sitOut" }];
    if (me.stack === 0 && !inCurrentHand(state, seat)) ops.push({ type: "rebuy" });
    if (canStart(state)) ops.push({ type: "start" });
    const legal = legalActions(state, seat);
    if (legal) {
      ops.push({ type: "fold" }, legal.canCheck ? { type: "check" } : { type: "call" });
      if (legal.canRaise) {
        const { minRaiseTo: min, maxRaiseTo: max } = legal;
        for (const to of new Set([min, Math.floor((min + max) / 2), max])) ops.push({ type: "raise", to });
      }
    }
    return ops;
  },
  nextDeadline,
  onDeadline,
  checkInvariants(state) {
    const stacks = state.seats.reduce((n, s) => n + (s?.stack ?? 0), 0);
    const away = Object.values(state.away).reduce((n, a) => n + a.stack, 0);
    const pot = handInProgress(state) ? state.hand!.players.reduce((n, p) => n + p.committed, 0) : 0;
    if (stacks + away + pot !== state.chipsIssued) {
      throw new Error(`chips don't add up: ${stacks} seated + ${away} away + ${pot} in the pot != ${state.chipsIssued} issued`);
    }
    for (const s of state.seats) if (s && (s.stack < 0 || !Number.isInteger(s.stack))) throw new Error(`bad stack ${s.stack}`);
    const hand = state.hand;
    if (hand?.status === "betting" && hand.toAct !== null) {
      const p = hand.players.find((x) => x.seat === hand.toAct);
      if (!p || p.folded || p.allIn || state.seats[hand.toAct]?.playerId !== p.playerId) throw new Error(`seat ${hand.toAct} can't act`);
    }
  },
};
