/**
 * Scenarios: a game already in a set-up position (the move before the end, the end
 * screen), to drop into from /try instead of playing a whole game to get there. See
 * "Practice rooms" in docs/ARCHITECTURE.md.
 *
 * A scenario builds its state through the game's own `create` and `apply` (seating
 * everyone with real ops) and then plays or edits it into shape. It's built in the
 * browser, so the result must pass the game's `checkInvariants` for the room to take
 * it (scenarios.test.ts checks every one).
 */
import { isLobbyOp } from "./lobby";
import type { BotOptions, GameContext, GameDefinition } from "../types";
import { seededRandomInt } from "./testing";

export interface Scenario<State = unknown> {
  id: string;
  name: string;
  description: string;
  /** Built-in bots to add; they take players[1..]. */
  bots: number;
  /** `players[0]` is you, the rest are the bots' member ids, in the order added. */
  build(players: string[], ctx: GameContext): State;
}

/** A policy for one player: an op from their view and legal game moves, or null if stuck. */
export type Policy<View, Op> = (view: View, ops: Op[], rand: (maxExclusive: number) => number, opts?: BotOptions) => Op | null;

/**
 * Play moves until `done(state)`: whoever the game waits on moves, by their `policies`
 * entry or else the game's built-in bot. Seeded, so a scenario comes out the same every
 * time. Throws if the game stalls or takes more than `maxSteps`.
 */
export function playUntil<State, Op, View>(
  def: GameDefinition<State, Op, View, any>,
  state: State,
  ctx: GameContext,
  done: (state: State) => boolean,
  opts: { policies?: Record<string, Policy<View, Op>>; seed?: number; maxSteps?: number } = {},
) {
  const rand = seededRandomInt(opts.seed ?? 1);
  for (let step = 0; step < (opts.maxSteps ?? 2000); step++) {
    if (done(state)) return;
    const actor = def.waitingOn(state)[0];
    if (!actor) throw new Error("the game isn't waiting on anyone");
    const ops = def.legalOps(state, actor).filter((op) => !isLobbyOp(op));
    const policy = opts.policies?.[actor] ?? def.bot.play;
    // Quick: a scenario is built while you wait.
    const op = policy(def.view(state, actor), ops, rand, { quick: true });
    if (op == null) throw new Error(`${actor} has no move`);
    def.apply(state, actor, op, ctx);
  }
  throw new Error("didn't get there in time");
}

/** A context for building: the caller's clock and names, with seeded randomness and no announcements. */
export function scenarioContext(ctx: GameContext, seed = 1): GameContext {
  return { now: ctx.now, randomInt: seededRandomInt(seed), nameOf: ctx.nameOf, announce: () => {} };
}
