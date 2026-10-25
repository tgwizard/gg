import { z } from "zod";
import { legalLobbyOps, lobbyOps } from "../kit/lobby";
import { seatedPlayers, seatOf } from "../kit/seating";
import type { GameDefinition } from "../types";
import { goBot } from "./bot";
import { canRematch, colorOfSeat } from "../kit/duel";
import {
  accept,
  chainPoints,
  checkInvariants,
  createState,
  type GoConfig,
  type GoState,
  type GoView,
  leave,
  mark,
  nextDeadline,
  onDeadline,
  pass,
  play,
  rematch,
  resign,
  resume,
  SPEC,
  sit,
  viewFor,
  waitingOn,
} from "./engine";
import { goMeta } from "./meta";
import { legalPoints, pointName } from "./rules";

const configSchema = z.object({
  size: z.union([z.literal(9), z.literal(13), z.literal(19)]).default(9),
  minutes: z.number().int().min(0).max(180).default(5),
  periods: z.number().int().min(0).max(10).default(3),
  seconds: z.number().int().min(0).max(120).default(20),
});

const point = z
  .string()
  .regex(/^[A-HJ-T]\d{1,2}$/)
  .describe("A point: column letter (A to T, no I) and row number from the bottom, as in D4.");

export const goOp = z.discriminatedUnion("type", [
  lobbyOps.sit(2),
  lobbyOps.leave,
  z.object({ type: z.literal("play"), point }),
  z.object({ type: z.literal("pass") }),
  z.object({ type: z.literal("resign") }),
  z.object({ type: z.literal("mark"), point: point.describe("While counting: a stone of the group to mark dead, or alive again.") }),
  z.object({ type: z.literal("accept") }),
  z.object({ type: z.literal("resume") }),
  z.object({ type: z.literal("rematch") }),
]);
export type GoOp = z.infer<typeof goOp>;

export const go: GameDefinition<GoState, GoOp, GoView, GoConfig> = {
  meta: goMeta,
  configSchema,
  opSchema: goOp,
  create: (config) => createState(config),
  apply(state, actor, op, ctx) {
    switch (op.type) {
      case "sit":
        return sit(state, actor, op.seat, ctx);
      case "leave":
        return leave(state, actor, ctx);
      case "play":
        return play(state, actor, op.point, ctx);
      case "pass":
        return pass(state, actor, ctx);
      case "resign":
        return resign(state, actor, ctx);
      case "mark":
        return mark(state, actor, op.point, ctx);
      case "accept":
        return accept(state, actor, ctx);
      case "resume":
        return resume(state, actor, ctx);
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
    const ops: GoOp[] = legalLobbyOps(state, player);
    if (seat < 0) return ops;
    const c = colorOfSeat(state, SPEC, seat);
    const name = (p: number) => pointName(p, state.config.size);
    if (state.phase === "playing") {
      if (state.turn === c) {
        for (const p of legalPoints(state.board, c, new Set(state.history))) ops.push({ type: "play", point: name(p) });
        ops.push({ type: "pass" });
      }
      ops.push({ type: "resign" });
    }
    if (state.phase === "scoring") {
      for (const p of chainPoints(state.board)) ops.push({ type: "mark", point: name(p) });
      if (!state.scoring!.accepted[c]) ops.push({ type: "accept" });
      ops.push({ type: "resume" }, { type: "resign" });
    }
    if (canRematch(state)) ops.push({ type: "rematch" });
    return ops;
  },
  nextDeadline,
  onDeadline,
  bot: goBot,
  checkInvariants,
};
