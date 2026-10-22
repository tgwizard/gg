import { z } from "zod";
import type { GameDefinition } from "../types";
import {
  act,
  createState,
  leave,
  nextDeadline,
  onDeadline,
  type PokerConfig,
  type PokerState,
  type PokerView,
  rebuy,
  SEAT_COUNT,
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
  waitingOn(state) {
    const hand = state.hand;
    if (hand?.status !== "betting" || hand.toAct === null) return [];
    const seat = state.seats[hand.toAct];
    return seat ? [seat.playerId] : [];
  },
  nextDeadline,
  onDeadline,
};
