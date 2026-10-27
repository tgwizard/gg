import { z } from "zod";
import { legalLobbyOps, lobbyOps } from "../kit/lobby";
import { seatOf, seatedPlayers } from "../kit/seating";
import type { GameDefinition } from "../types";
import { unicornBot } from "./bot";
import {
  canStart,
  createState,
  currentRacer,
  leave,
  MAX_RAINBOW_ROLLS,
  pick,
  raceOptions,
  RIDERS,
  roll,
  SEAT_COUNT,
  setKid,
  sit,
  start,
  FINISH,
  LOOP,
  type UnicornConfig,
  type UnicornState,
  type UnicornView,
  viewFor,
  wanted,
} from "./engine";
import { unicornMeta } from "./meta";

const configSchema = z.object({ rainbowAt: z.number().int().min(6).max(60).default(20) });

export const unicornOp = z.discriminatedUnion("type", [
  // Sitting down, you say whether you're a kid (a grown-up if you don't).
  lobbyOps.sit(SEAT_COUNT).extend({ kid: z.boolean().optional() }),
  lobbyOps.leave,
  lobbyOps.start,
  z.object({ type: z.literal("kid"), kid: z.boolean() }),
  z.object({ type: z.literal("roll") }),
  z.object({ type: z.literal("pick"), rider: z.enum(RIDERS) }),
]);
export type UnicornOp = z.infer<typeof unicornOp>;

export const unicorn: GameDefinition<UnicornState, UnicornOp, UnicornView, UnicornConfig> = {
  meta: unicornMeta,
  configSchema,
  opSchema: unicornOp,
  create: (config) => createState(config),
  apply(state, actor, op, ctx) {
    switch (op.type) {
      case "sit":
        return sit(state, actor, op.seat, op.kid);
      case "leave":
        return leave(state, actor, ctx);
      case "start":
        return start(state, actor, ctx);
      case "kid":
        return setKid(state, actor, op.kid);
      case "roll":
        return roll(state, actor, ctx);
      case "pick":
        return pick(state, actor, op.rider, ctx);
    }
  },
  view: viewFor,
  players: seatedPlayers,
  removePlayer: (state, player, ctx) => leave(state, player, ctx),
  waitingOn: (state) => {
    const r = currentRacer(state);
    return r ? [r.playerId] : [];
  },
  legalOps(state, player) {
    // No sitting out: a race only waits on whoever is to roll.
    const ops = legalLobbyOps(state, player, { canStart: canStart(state) }) as UnicornOp[];
    const seat = seatOf(state, player);
    if (seat >= 0 && !(state.phase === "playing" && state.racers.some((r) => r.playerId === player && !r.left))) ops.push({ type: "kid", kid: !state.seats[seat]!.kid });
    const options = raceOptions(state, player);
    if (options.roll) ops.push({ type: "roll" });
    for (const rider of options.pick) ops.push({ type: "pick", rider });
    return ops;
  },
  bot: unicornBot,
  checkInvariants(state) {
    for (const r of state.racers) {
      if (r.at < 0 || r.at > FINISH) throw new Error(`racer off the track at ${r.at}`);
      if (r.at >= LOOP && r.riders.length < RIDERS.length) throw new Error("on the bridge without all six friends");
      if (r.at === FINISH && state.result?.winners[0] !== r.playerId) throw new Error("at the castle but not the winner");
      if (new Set(r.riders).size !== r.riders.length) throw new Error("a friend picked up twice");
      if (r.riders.length > RIDERS.length) throw new Error("too many friends");
      if (r.rainbowRolls < 0 || r.rainbowRolls > MAX_RAINBOW_ROLLS) throw new Error("bad rainbow rolls");
      if (r.rainbowRolls && !r.kid) throw new Error("a grown-up with rainbow rolls");
    }
    if (state.rainbow < 0 || state.rainbow >= state.config.rainbowAt) throw new Error(`rainbow at ${state.rainbow}`);
    if (state.phase === "playing") {
      const r = currentRacer(state);
      if (!r) throw new Error("nobody's turn");
      if (state.stage === "pick") {
        if (!state.choice?.length) throw new Error("nobody to pick");
        if (state.choice.join() !== wanted(r, r.at).join()) throw new Error("the choice isn't what's at the stop");
      } else if (state.choice) throw new Error("a choice while rolling");
    } else if (state.choice || state.turn !== null) throw new Error("a turn outside a race");
    if (state.phase === "over" && !state.result) throw new Error("over without a result");
  },
};
