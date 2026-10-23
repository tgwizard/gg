import { z } from "zod";
import { legalLobbyOps, lobbyOps } from "../kit/lobby";
import { seatedPlayers } from "../kit/seating";
import type { GameDefinition } from "../types";
import { ticketBot } from "./bot";
import {
  canDrawTickets,
  canStart,
  checkInvariants,
  claim,
  claimOptions,
  createState,
  drawCard,
  drawOptions,
  drawTickets,
  FACE_UP,
  keep,
  keepOptions,
  leave,
  nextDeadline,
  onDeadline,
  SEAT_COUNT,
  setSittingOut,
  sit,
  start,
  type TtrConfig,
  type TtrState,
  type TtrView,
  viewFor,
  waitingOn,
} from "./engine";
import { CARD_COLORS, ROUTE_IDS, TICKETS } from "./map";
import { ticketMeta } from "./meta";

const configSchema = z.object({ turnSeconds: z.number().int().min(0).max(600).default(60) });

export const ttrOp = z.discriminatedUnion("type", [
  lobbyOps.sit(SEAT_COUNT),
  lobbyOps.leave,
  lobbyOps.sitOut,
  lobbyOps.sitIn,
  lobbyOps.start,
  /** A train card, blind from the deck or from face-up slot 0–4. */
  z.object({ type: z.literal("draw"), from: z.union([z.literal("deck"), z.number().int().min(0).max(FACE_UP - 1)]) }),
  /** Claim a route, paying (length − locos) cards of `color` and `locos` locomotives ("loco": all locomotives). */
  z.object({
    type: z.literal("claim"),
    route: z.enum(ROUTE_IDS),
    color: z.enum(CARD_COLORS),
    locos: z.number().int().min(0).max(6),
  }),
  /** Draw three destination tickets. */
  z.object({ type: z.literal("tickets") }),
  /** Keep some of the tickets drawn. */
  z.object({ type: z.literal("keep"), tickets: z.array(z.number().int().min(0).max(TICKETS.length - 1)).min(1).max(3) }),
]);
export type TtrOp = z.infer<typeof ttrOp>;

export const ticketToRide: GameDefinition<TtrState, TtrOp, TtrView, TtrConfig> = {
  meta: ticketMeta,
  configSchema,
  opSchema: ttrOp,
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
        return start(state, actor, ctx);
      case "draw":
        return drawCard(state, actor, op.from, ctx);
      case "claim":
        return claim(state, actor, op.route, { color: op.color, locos: op.locos }, ctx);
      case "tickets":
        return drawTickets(state, actor);
      case "keep":
        return keep(state, actor, op.tickets, ctx);
    }
  },
  view: viewFor,
  players: seatedPlayers,
  removePlayer: (state, player, ctx) => leave(state, player, ctx),
  // Everyone chooses their first tickets at once.
  concurrentOp: (op) => op.type === "keep",
  waitingOn,
  legalOps(state, player) {
    const ops: TtrOp[] = legalLobbyOps(state, player, { sitOut: true, canStart: canStart(state) });
    for (const from of drawOptions(state, player)) ops.push({ type: "draw", from });
    for (const { route, pay } of claimOptions(state, player)) for (const p of pay) ops.push({ type: "claim", route, color: p.color, locos: p.locos });
    if (canDrawTickets(state, player)) ops.push({ type: "tickets" });
    for (const tickets of keepOptions(state, player)) ops.push({ type: "keep", tickets });
    return ops;
  },
  nextDeadline,
  onDeadline,
  bot: ticketBot,
  checkInvariants,
};
