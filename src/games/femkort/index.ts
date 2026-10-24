import { z } from "zod";
import { RANKS, SUITS } from "../kit/cards";
import { legalLobbyOps, lobbyOps } from "../kit/lobby";
import { seatedPlayers } from "../kit/seating";
import type { GameDefinition } from "../types";
import { femBot } from "./bot";
import {
  askBetter,
  canAsk,
  canStart,
  checkInvariants,
  createState,
  type FemConfig,
  type FemState,
  type FemView,
  leave,
  nextDeadline,
  onDeadline,
  playableFor,
  playCard,
  SEAT_COUNT,
  setSittingOut,
  sit,
  start,
  viewFor,
  vote,
  voters,
  waitingOn,
} from "./engine";
import { femKortMeta } from "./meta";

const configSchema = z.object({
  turnSeconds: z.number().int().min(0).max(600).default(30),
  dealsToWin: z.number().int().min(1).max(9).default(3),
  mustBeat: z.boolean().default(true),
  twoInARow: z.boolean().default(false),
  betterCards: z.boolean().default(false),
});

const CARDS = [...SUITS].flatMap((s) => [...RANKS].map((r) => r + s)) as [string, ...string[]];

export const femOp = z.discriminatedUnion("type", [
  lobbyOps.sit(SEAT_COUNT),
  lobbyOps.leave,
  lobbyOps.sitOut,
  lobbyOps.sitIn,
  lobbyOps.start,
  z.object({ type: z.literal("play"), card: z.enum(CARDS).describe('The card to play from your hand, e.g. "Ks" (rank then suit).') }),
  z.object({ type: z.literal("betterCards") }).describe("Ask for better cards: if everyone else agrees, the cards are dealt again."),
  z.object({ type: z.literal("vote"), yes: z.boolean() }).describe("Answer a call for better cards: yes deals again (if everyone agrees), no plays on."),
]);
export type FemOp = z.infer<typeof femOp>;

export const femKort: GameDefinition<FemState, FemOp, FemView, FemConfig> = {
  meta: femKortMeta,
  configSchema,
  opSchema: femOp,
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
      case "play":
        return playCard(state, actor, op.card, ctx);
      case "betterCards":
        return askBetter(state, actor, ctx);
      case "vote":
        return vote(state, actor, op.yes, ctx);
    }
  },
  view: viewFor,
  players: seatedPlayers,
  removePlayer: (state, player, ctx) => leave(state, player, ctx),
  // Answering a call for better cards is your own business: everyone answers at once.
  concurrentOp: (op) => op.type === "vote",
  waitingOn,
  legalOps(state, player) {
    const ops: FemOp[] = legalLobbyOps(state, player, { sitOut: true, canStart: canStart(state) });
    for (const card of playableFor(state, player) ?? []) ops.push({ type: "play", card });
    if (canAsk(state, player) && !state.vote) ops.push({ type: "betterCards" });
    if (voters(state).includes(player)) ops.push({ type: "vote", yes: true }, { type: "vote", yes: false });
    return ops;
  },
  nextDeadline,
  onDeadline,
  bot: femBot,
  checkInvariants,
};
