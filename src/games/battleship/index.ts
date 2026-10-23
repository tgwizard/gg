import { z } from "zod";
import { legalLobbyOps, lobbyOps } from "../kit/lobby";
import { seatedPlayers, seatOf } from "../kit/seating";
import type { GameDefinition } from "../types";
import {
  arrange,
  type BsConfig,
  type BsState,
  type BsView,
  CELLS,
  canRematch,
  checkInvariants,
  createState,
  FLEET,
  fire,
  leave,
  nextDeadline,
  onDeadline,
  openCells,
  randomize,
  ready,
  rematch,
  SHIP_IDS,
  SIZE,
  sit,
  unready,
  viewFor,
  waitingOn,
} from "./engine";
import { battleshipBot } from "./bot";
import { battleshipMeta } from "./meta";

const configSchema = z.object({
  turnSeconds: z.number().int().min(0).max(600).default(30),
  placeSeconds: z.number().int().min(0).max(900).default(120),
  shipsMayTouch: z.boolean().default(true),
  hitShootsAgain: z.boolean().default(false),
});

const shipSchema = z.object({
  id: z.enum(SHIP_IDS),
  row: z.number().int().min(0).max(SIZE - 1),
  col: z.number().int().min(0).max(SIZE - 1),
  vertical: z.boolean(),
});

export const bsOp = z.discriminatedUnion("type", [
  lobbyOps.sit(2),
  lobbyOps.leave,
  /** Your layout so far (placing a ship, picking one up, clearing). */
  z.object({ type: z.literal("arrange"), ships: z.array(shipSchema).max(FLEET.length) }),
  /** A random full layout, chosen by the server. */
  z.object({ type: z.literal("random") }),
  z.object({ type: z.literal("ready") }),
  /** Back to placing (while the other player is still at it). */
  z.object({ type: z.literal("unready") }),
  z.object({ type: z.literal("fire"), cell: z.number().int().min(0).max(CELLS - 1) }),
  z.object({ type: z.literal("rematch") }),
]);
export type BsOp = z.infer<typeof bsOp>;

export const battleship: GameDefinition<BsState, BsOp, BsView, BsConfig> = {
  meta: battleshipMeta,
  configSchema,
  opSchema: bsOp,
  create: (config) => createState(config),
  apply(state, actor, op, ctx) {
    switch (op.type) {
      case "sit":
        return sit(state, actor, op.seat, ctx);
      case "leave":
        return leave(state, actor, ctx);
      case "arrange":
        return arrange(state, actor, op.ships);
      case "random":
        return randomize(state, actor, ctx);
      case "ready":
        return ready(state, actor, ctx);
      case "unready":
        return unready(state, actor);
      case "fire":
        return fire(state, actor, op.cell, ctx);
      case "rematch":
        return rematch(state, actor, ctx);
    }
  },
  view: viewFor,
  players: seatedPlayers,
  removePlayer: (state, player, ctx) => leave(state, player, ctx),
  // Both players place their fleets at once; neither's placing should make the other's stale.
  concurrentOp: (op) => op.type === "arrange" || op.type === "random" || op.type === "ready" || op.type === "unready",
  waitingOn,
  legalOps(state, player) {
    const seat = seatOf(state, player);
    const ops: BsOp[] = legalLobbyOps(state, player);
    if (seat < 0) return ops;
    const fleet = state.fleets[seat];
    if (state.phase === "placing" && fleet) {
      if (fleet.ready) ops.push({ type: "unready" });
      else {
        ops.push({ type: "random" }, { type: "arrange", ships: [] }, { type: "arrange", ships: fleet.ships.slice(1) });
        if (fleet.ships.length === FLEET.length) ops.push({ type: "ready" });
      }
    }
    if (state.phase === "firing" && state.turn === seat) {
      for (const cell of openCells(state.fleets[1 - seat]!)) ops.push({ type: "fire", cell });
    }
    if (canRematch(state)) ops.push({ type: "rematch" });
    return ops;
  },
  nextDeadline,
  onDeadline,
  bot: battleshipBot,
  checkInvariants,
};
