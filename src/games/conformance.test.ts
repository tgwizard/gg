/**
 * Every registered game must pass this. It plays random legal moves (mostly from
 * whoever the game is waiting on, so games actually progress) and lets timers fire,
 * checking the contract the room relies on after every step:
 *
 *   - every op from `legalOps` is accepted by `apply`;
 *   - state and every player's view are plain JSON;
 *   - `waitingOn` only names `players`;
 *   - timers make progress (no alarm hot-loops);
 *   - the game's own `checkInvariants` hold.
 */
import { describe, expect, it } from "vitest";
import { seededRandomInt } from "./kit/testing";
import { games } from "./registry";
import type { AnyGameDefinition, GameContext } from "./types";

const SEEDS = 30;
const STEPS = 1500;

for (const def of Object.values(games)) {
  describe(`${def.meta.name} conforms to the game contract`, () => {
    it("creates a plain-JSON state from the default config", () => {
      const state = def.create(def.configSchema.parse({}), ctxAt(0, seededRandomInt(1)));
      expect(JSON.parse(JSON.stringify(state))).toEqual(state);
      expect(def.players(state)).toEqual([]);
    });

    it("survives random play by random people", () => {
      for (let seed = 1; seed <= SEEDS; seed++) {
        try {
          play(def, seed);
        } catch (e) {
          throw new Error(`seed ${seed}: ${(e as Error).message}`, { cause: e });
        }
      }
    });
  });
}

function ctxAt(now: number, randomInt: (n: number) => number, announce: (t: string) => void = () => {}): GameContext {
  return { now, randomInt, nameOf: (id) => id, announce };
}

function play(def: AnyGameDefinition, seed: number) {
  const rand = seededRandomInt(seed);
  const people = Array.from({ length: def.meta.maxPlayers + 2 }, (_, i) => `p${i}`);
  let now = 1_000_000;
  let state = def.create(def.configSchema.parse({}), ctxAt(now, rand));

  for (let step = 0; step < STEPS; step++) {
    const waiting = def.waitingOn(state);
    // Usually the player whose turn it is; sometimes anyone (joining, leaving, ...).
    const pool = waiting.length && rand(10) < 7 ? waiting : people;
    const actor = pool[rand(pool.length)]!;
    const ops = def.legalOps(state, actor);
    const deadline = def.nextDeadline?.(state) ?? null;

    if (ops.length && (deadline === null || rand(20) > 0)) {
      const op = ops[rand(ops.length)];
      const next = structuredClone(state);
      try {
        def.apply(next, actor, def.opSchema.parse(op), ctxAt(now, rand));
      } catch (e) {
        throw new Error(`legal op ${JSON.stringify(op)} by ${actor} was rejected: ${(e as Error).message}`);
      }
      state = next;
    } else if (deadline !== null) {
      now = Math.max(now, deadline);
      const next = structuredClone(state);
      def.onDeadline!(next, ctxAt(now, rand));
      const after = def.nextDeadline?.(next) ?? null;
      if (after !== null && after <= now) throw new Error(`deadline didn't move on (${after} <= ${now})`);
      state = next;
    } else if (people.every((p) => def.legalOps(state, p).length === 0)) {
      break; // nothing anyone can do and nothing pending
    } else {
      continue;
    }

    expect(JSON.parse(JSON.stringify(state))).toEqual(state);
    def.checkInvariants?.(state);
    const players = new Set(def.players(state));
    for (const id of def.waitingOn(state)) if (!players.has(id)) throw new Error(`waiting on non-player ${id}`);
    for (const viewer of [...people, "spectator"]) JSON.stringify(def.view(state, viewer));
  }
}
