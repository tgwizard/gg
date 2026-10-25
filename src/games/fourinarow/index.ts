import { z } from "zod";
import { legalLobbyOps, lobbyOps } from "../kit/lobby";
import { seatedPlayers, seatOf } from "../kit/seating";
import type { GameDefinition } from "../types";
import { fourInARowBot } from "./bot";
import { canRematch, colorOfSeat } from "../kit/duel";
import {
  checkInvariants,
  createState,
  type FourConfig,
  type FourState,
  type FourView,
  leave,
  move,
  nextDeadline,
  onDeadline,
  rematch,
  resign,
  SPEC,
  sit,
  sizeOf,
  viewFor,
  waitingOn,
} from "./engine";
import { fourInARowMeta } from "./meta";
import { openColumns, SIZES } from "./rules";

const configSchema = z.object({
  board: z.enum(SIZES).default("7x6"),
  opener: z.enum(["alternate", "loser"]).default("alternate"),
  minutes: z.number().int().min(0).max(180).default(3),
  increment: z.number().int().min(0).max(60).default(3),
});

export const fourInARowOp = z.discriminatedUnion("type", [
  lobbyOps.sit(2),
  lobbyOps.leave,
  z.object({
    type: z.literal("drop"),
    column: z.number().int().min(1).max(9).describe("The column to drop your disc into: 1 is the leftmost."),
  }),
  z.object({ type: z.literal("resign") }),
  z.object({ type: z.literal("rematch") }),
]);
export type FourOp = z.infer<typeof fourInARowOp>;

export const fourInARow: GameDefinition<FourState, FourOp, FourView, FourConfig> = {
  meta: fourInARowMeta,
  configSchema,
  opSchema: fourInARowOp,
  create: (config) => createState(config),
  apply(state, actor, op, ctx) {
    switch (op.type) {
      case "sit":
        return sit(state, actor, op.seat, ctx);
      case "leave":
        return leave(state, actor, ctx);
      case "drop":
        return move(state, actor, op.column, ctx);
      case "resign":
        return resign(state, actor, ctx);
      case "rematch":
        return rematch(state, actor, ctx);
    }
  },
  view: viewFor,
  players: seatedPlayers,
  removePlayer: leave,
  waitingOn,
  legalOps(state, player) {
    const seat = seatOf(state, player);
    const ops: FourOp[] = legalLobbyOps(state, player);
    if (seat < 0) return ops;
    if (state.phase === "playing") {
      if (state.turn === colorOfSeat(state, SPEC, seat)) for (const c of openColumns(state.board, sizeOf(state))) ops.push({ type: "drop", column: c + 1 });
      ops.push({ type: "resign" });
    }
    if (canRematch(state)) ops.push({ type: "rematch" });
    return ops;
  },
  nextDeadline,
  onDeadline,
  bot: fourInARowBot,
  checkInvariants,
};
