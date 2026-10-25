import { z } from "zod";
import { legalLobbyOps, lobbyOps } from "../kit/lobby";
import { seatedPlayers, seatOf } from "../kit/seating";
import type { GameDefinition } from "../types";
import { luffarschackBot } from "./bot";
import { canRematch, colorOfSeat } from "../kit/duel";
import {
  checkInvariants,
  createState,
  boardSize,
  type LuffaConfig,
  type LuffaState,
  type LuffaView,
  leave,
  mark,
  nextDeadline,
  onDeadline,
  rematch,
  resign,
  SPEC,
  sit,
  viewFor,
  waitingOn,
} from "./engine";
import { luffarschackMeta } from "./meta";
import { SIZES, squareName } from "./rules";

const configSchema = z.object({
  size: z.enum(SIZES).default("19"),
  turnSeconds: z.number().int().min(0).max(600).default(60),
});

export const luffarschackOp = z.discriminatedUnion("type", [
  lobbyOps.sit(2),
  lobbyOps.leave,
  z.object({
    type: z.literal("mark"),
    square: z
      .string()
      .regex(/^[A-Ya-y]\d{1,2}$/)
      .describe('The empty square to mark: a column letter (A is the left) and a row number (1 is the top), like "J10".'),
  }),
  z.object({ type: z.literal("resign") }),
  z.object({ type: z.literal("rematch") }),
]);
export type LuffaOp = z.infer<typeof luffarschackOp>;

export const luffarschack: GameDefinition<LuffaState, LuffaOp, LuffaView, LuffaConfig> = {
  meta: luffarschackMeta,
  configSchema,
  opSchema: luffarschackOp,
  create: (config) => createState(config),
  apply(state, actor, op, ctx) {
    switch (op.type) {
      case "sit":
        return sit(state, actor, op.seat, ctx);
      case "leave":
        return leave(state, actor, ctx);
      case "mark":
        return mark(state, actor, op.square, ctx);
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
    const ops: LuffaOp[] = legalLobbyOps(state, player);
    if (seat < 0) return ops;
    if (state.phase === "playing") {
      if (state.turn === colorOfSeat(state, SPEC, seat)) {
        const n = boardSize(state);
        for (let cell = 0; cell < state.board.length; cell++) if (state.board[cell] === ".") ops.push({ type: "mark", square: squareName(n, cell) });
      }
      ops.push({ type: "resign" });
    }
    if (canRematch(state)) ops.push({ type: "rematch" });
    return ops;
  },
  nextDeadline,
  onDeadline,
  bot: luffarschackBot,
  checkInvariants,
};
