import { z } from "zod";
import { legalLobbyOps, lobbyOps } from "../kit/lobby";
import { seatedPlayers, seatOf } from "../kit/seating";
import type { GameDefinition } from "../types";
import { othelloBot } from "./bot";
import {
  canRematch,
  checkInvariants,
  createState,
  leave,
  move,
  nextDeadline,
  type OthelloConfig,
  type OthelloState,
  type OthelloView,
  onDeadline,
  rematch,
  resign,
  seatColor,
  sit,
  viewFor,
  waitingOn,
} from "./engine";
import { othelloMeta } from "./meta";
import { legalMoves, squareName } from "./rules";

const configSchema = z.object({
  minutes: z.number().int().min(0).max(180).default(5),
  increment: z.number().int().min(0).max(60).default(5),
});

export const othelloOp = z.discriminatedUnion("type", [
  lobbyOps.sit(2),
  lobbyOps.leave,
  z.object({
    type: z.literal("move"),
    square: z
      .string()
      .regex(/^[a-h][1-8]$/)
      .describe("Where to put your disc: column a to h, then row 1 (top) to 8 (bottom), as in f5."),
  }),
  z.object({ type: z.literal("resign") }),
  z.object({ type: z.literal("rematch") }),
]);
export type OthelloOp = z.infer<typeof othelloOp>;

export const othello: GameDefinition<OthelloState, OthelloOp, OthelloView, OthelloConfig> = {
  meta: othelloMeta,
  configSchema,
  opSchema: othelloOp,
  create: (config) => createState(config),
  apply(state, actor, op, ctx) {
    switch (op.type) {
      case "sit":
        return sit(state, actor, op.seat, ctx);
      case "leave":
        return leave(state, actor, ctx);
      case "move":
        return move(state, actor, op.square, ctx);
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
    const ops: OthelloOp[] = legalLobbyOps(state, player);
    if (seat < 0) return ops;
    if (state.phase === "playing") {
      const c = seatColor(state, seat);
      if (state.turn === c) for (const sq of legalMoves(state.board, c)) ops.push({ type: "move", square: squareName(sq) });
      ops.push({ type: "resign" });
    }
    if (canRematch(state)) ops.push({ type: "rematch" });
    return ops;
  },
  nextDeadline,
  onDeadline,
  bot: othelloBot,
  checkInvariants,
};
