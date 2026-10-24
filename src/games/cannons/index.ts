import { z } from "zod";
import { legalLobbyOps, lobbyOps } from "../kit/lobby";
import { seatedPlayers, seatOf } from "../kit/seating";
import type { GameDefinition } from "../types";
import { cannonsBot } from "./bot";
import {
  type CannonsConfig,
  type CannonsState,
  type CannonsView,
  canRematch,
  checkInvariants,
  createState,
  fire,
  leave,
  nextDeadline,
  onDeadline,
  rematch,
  sit,
  viewFor,
  WIND_LEVELS,
  waitingOn,
} from "./engine";
import { cannonsMeta } from "./meta";
import { MAX_POWER, MIN_POWER } from "./physics";
import { TERRAIN_STYLES } from "./terrain";

const configSchema = z.object({
  players: z.number().int().min(2).max(4).default(2),
  terrain: z.enum(TERRAIN_STYLES).default("hilly"),
  wind: z.enum(WIND_LEVELS).default("light"),
  turnSeconds: z.number().int().min(0).max(600).default(45),
});

export const cannonsOp = z.discriminatedUnion("type", [
  lobbyOps.sit(4),
  lobbyOps.leave,
  z.object({
    type: z.literal("fire"),
    angle: z.number().int().min(0).max(180).describe("Whole degrees: 0 points right along the ground, 90 straight up, 180 left."),
    power: z.number().int().min(MIN_POWER).max(MAX_POWER).describe(`From ${MIN_POWER} (a dribble) to ${MAX_POWER} (full charge). More goes further.`),
  }),
  z.object({ type: z.literal("rematch") }),
]);
export type CannonsOp = z.infer<typeof cannonsOp>;

/** Example aims offered as legal moves: any whole angle and power in range is just as legal. */
const SAMPLE_ANGLES = [35, 50, 65];
const SAMPLE_POWERS = [45, 65, 85];

export const cannons: GameDefinition<CannonsState, CannonsOp, CannonsView, CannonsConfig> = {
  meta: cannonsMeta,
  configSchema,
  opSchema: cannonsOp,
  create: (config) => createState(config),
  apply(state, actor, op, ctx) {
    switch (op.type) {
      case "sit":
        return sit(state, actor, op.seat, ctx);
      case "leave":
        return leave(state, actor, ctx);
      case "fire":
        return fire(state, actor, op.angle, op.power, ctx);
      case "rematch":
        return rematch(state, actor, ctx);
    }
  },
  view: viewFor,
  players: seatedPlayers,
  removePlayer: leave,
  waitingOn,
  legalOps(state, player) {
    const ops: CannonsOp[] = legalLobbyOps(state, player);
    if (seatOf(state, player) < 0) return ops;
    if (waitingOn(state)[0] === player) {
      // Angle and power are open-ended: a few aims towards the nearest cannon stand for all of them.
      const me = state.cannons[state.turn]!;
      const others = state.cannons.filter((c) => c.alive && c !== me);
      const target = others.reduce((a, b) => (Math.abs(b.x - me.x) < Math.abs(a.x - me.x) ? b : a));
      const right = target.x >= me.x;
      for (const a of SAMPLE_ANGLES) for (const power of SAMPLE_POWERS) ops.push({ type: "fire", angle: right ? a : 180 - a, power });
    }
    if (canRematch(state)) ops.push({ type: "rematch" });
    return ops;
  },
  nextDeadline,
  onDeadline,
  bot: cannonsBot,
  checkInvariants,
};
