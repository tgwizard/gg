import { z } from "zod";
import { legalLobbyOps, lobbyOps } from "../kit/lobby";
import { seatedPlayers, seatOf } from "../kit/seating";
import type { GameDefinition } from "../types";
import { chessBot } from "./bot";
import {
  answerDraw,
  canOfferDraw,
  canRematch,
  type ChessConfig,
  type ChessState,
  type ChessView,
  checkInvariants,
  createState,
  leave,
  move,
  nextDeadline,
  offerDraw,
  onDeadline,
  rematch,
  resign,
  seatColor,
  sit,
  viewFor,
  waitingOn,
} from "./engine";
import { chessMeta } from "./meta";
import { legalMoves, other, parseFen, toUci } from "./rules";

const configSchema = z.object({
  minutes: z.number().int().min(0).max(180).default(10),
  increment: z.number().int().min(0).max(60).default(5),
});

export const chessOp = z.discriminatedUnion("type", [
  lobbyOps.sit(2),
  lobbyOps.leave,
  z.object({
    type: z.literal("move"),
    move: z
      .string()
      .regex(/^[a-h][1-8][a-h][1-8][qrbn]?$/)
      .describe("In UCI: the from and to squares, plus the piece a pawn promotes to (e2e4, e1g1 to castle, e7e8q)."),
  }),
  z.object({ type: z.literal("resign") }),
  z.object({ type: z.literal("offerDraw") }),
  z.object({ type: z.literal("acceptDraw") }),
  z.object({ type: z.literal("declineDraw") }),
  z.object({ type: z.literal("rematch") }),
]);
export type ChessOp = z.infer<typeof chessOp>;

export const chess: GameDefinition<ChessState, ChessOp, ChessView, ChessConfig> = {
  meta: chessMeta,
  configSchema,
  opSchema: chessOp,
  create: (config) => createState(config),
  apply(state, actor, op, ctx) {
    switch (op.type) {
      case "sit":
        return sit(state, actor, op.seat, ctx);
      case "leave":
        return leave(state, actor, ctx);
      case "move":
        return move(state, actor, op.move, ctx);
      case "resign":
        return resign(state, actor, ctx);
      case "offerDraw":
        return offerDraw(state, actor, ctx);
      case "acceptDraw":
        return answerDraw(state, actor, true, ctx);
      case "declineDraw":
        return answerDraw(state, actor, false, ctx);
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
    const ops: ChessOp[] = legalLobbyOps(state, player);
    if (seat < 0) return ops;
    if (state.phase === "playing") {
      const c = seatColor(state, seat);
      const pos = parseFen(state.fen);
      if (pos.turn === c) for (const m of legalMoves(pos)) ops.push({ type: "move", move: toUci(m) });
      if (state.drawOffer === other(c)) ops.push({ type: "acceptDraw" }, { type: "declineDraw" });
      else if (canOfferDraw(state, c)) ops.push({ type: "offerDraw" });
      ops.push({ type: "resign" });
    }
    if (canRematch(state)) ops.push({ type: "rematch" });
    return ops;
  },
  nextDeadline,
  onDeadline,
  bot: chessBot,
  checkInvariants,
};
