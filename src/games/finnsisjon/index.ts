import { z } from "zod";
import { RANKS } from "../kit/cards";
import { seatedPlayers, seatOf } from "../kit/seating";
import type { GameDefinition } from "../types";
import {
  ask,
  askOptions,
  canStart,
  createState,
  currentPlayer,
  type FishConfig,
  type FishState,
  type FishView,
  leave,
  nextDeadline,
  onDeadline,
  SEAT_COUNT,
  setSittingOut,
  sit,
  start,
  TOTAL_BOOKS,
  viewFor,
} from "./engine";
import { finnsISjonMeta } from "./meta";

const configSchema = z.object({ turnSeconds: z.number().int().min(0).max(600).default(45) });

export const fishOp = z.discriminatedUnion("type", [
  z.object({ type: z.literal("sit"), seat: z.number().int().min(0).max(SEAT_COUNT - 1) }),
  z.object({ type: z.literal("leave") }),
  z.object({ type: z.literal("sitOut") }),
  z.object({ type: z.literal("sitIn") }),
  z.object({ type: z.literal("start") }),
  z.object({ type: z.literal("ask"), target: z.string().min(1).max(64), rank: z.enum(RANKS.split("") as [string, ...string[]]) }),
]);
export type FishOp = z.infer<typeof fishOp>;

export const finnsISjon: GameDefinition<FishState, FishOp, FishView, FishConfig> = {
  meta: finnsISjonMeta,
  configSchema,
  opSchema: fishOp,
  create: (config) => createState(config),
  apply(state, actor, op, ctx) {
    switch (op.type) {
      case "sit":
        return sit(state, actor, op.seat);
      case "leave":
        return leave(state, actor, ctx);
      case "sitOut":
        return setSittingOut(state, actor, true, ctx);
      case "sitIn":
        return setSittingOut(state, actor, false, ctx);
      case "start":
        return start(state, ctx);
      case "ask":
        return ask(state, actor, op.target, op.rank, ctx);
    }
  },
  view: viewFor,
  players: seatedPlayers,
  waitingOn: (state) => {
    const p = currentPlayer(state);
    return p ? [p.playerId] : [];
  },
  legalOps(state, player) {
    const seat = seatOf(state, player);
    if (seat < 0) return state.seats.flatMap((s, i) => (s ? [] : [{ type: "sit" as const, seat: i }]));
    const ops: FishOp[] = [{ type: "leave" }, state.seats[seat]!.sittingOut ? { type: "sitIn" } : { type: "sitOut" }];
    if (canStart(state)) ops.push({ type: "start" });
    const options = askOptions(state, player);
    for (const target of options?.targets ?? []) for (const rank of options!.ranks) ops.push({ type: "ask", target, rank });
    return ops;
  },
  nextDeadline,
  onDeadline,
  checkInvariants(state) {
    if (state.players.length === 0) return;
    const cards = [...state.lake, ...state.players.flatMap((p) => p.hand)];
    const books = state.players.flatMap((p) => p.books);
    if (cards.length + books.length * 4 !== 52) throw new Error(`${cards.length} cards + ${books.length} books != 52`);
    if (new Set(cards).size !== cards.length) throw new Error("duplicate card");
    if (new Set(books).size !== books.length) throw new Error("duplicate book");
    if (books.length > TOTAL_BOOKS) throw new Error("too many books");
    for (const p of state.players) if (p.left && p.hand.length) throw new Error("a player who left still holds cards");
    if (state.phase === "playing") {
      const p = currentPlayer(state);
      if (!p || p.hand.length === 0) throw new Error("the player to move has no cards");
      if (!askOptions(state, p.playerId)!.targets.length) throw new Error("the player to move has nobody to ask");
    }
  },
};
