/**
 * Every registered game must pass this. It plays random legal moves (mostly from
 * whoever the game is waiting on, so games actually progress) and lets timers fire,
 * checking the contract the room relies on after every step:
 *
 *   - every op from `legalOps` is accepted by `apply`, and table moves it doesn't
 *     offer (a spectator dealing, sitting in twice) are refused;
 *   - `removePlayer` takes a player out of `players`;
 *   - state and every player's view are plain JSON;
 *   - `waitingOn` only names `players`;
 *   - timers make progress (no alarm hot-loops);
 *   - the game's own `checkInvariants` hold.
 *
 * It also seats a table of built-in bots, easy and hard, which must keep the game going:
 * whenever the game waits on a bot, the bot has a move, and every move is legal.
 *
 * It's CPU-bound and vitest runs files in parallel, not the tests in a file, so the games
 * are split between `conformance.<n>.test.ts` files, each running its share.
 */
import { describe, expect, it } from "vitest";
import { botMove } from "./kit/bot";
import { isLobbyOp } from "./kit/lobby";
import { seededRandomInt } from "./kit/testing";
import { games } from "./registry";
import { type AnyGameDefinition, type GameContext, GameError } from "./types";

const SEEDS = 30;
const STEPS = 1500;

export const SHARDS = 5;

const CHECKS = ["random", "bots", "json"] as const;
type Check = (typeof CHECKS)[number];

/**
 * Defines this shard's part (1 to SHARDS) of the checks: every game's random play is
 * dealt round the shards, then every game's bots, so the slow checks spread out evenly.
 */
export function conformanceTests(shard: number) {
  const ids = Object.keys(games).sort();
  const mine = CHECKS.flatMap((check) => ids.map((id) => ({ id, check }))).filter((_, i) => i % SHARDS === shard - 1);
  for (const id of ids) {
    const checks = new Set(mine.filter((unit) => unit.id === id).map((unit) => unit.check));
    if (checks.size) suite(games[id]!, checks);
  }
}

function suite(def: AnyGameDefinition, checks: Set<Check>) {
  // Only this shard's checks are defined (not skipped), so each runs, and shows, once.
  const check = (c: Check, name: string, fn: () => void, timeout?: number) => checks.has(c) && it(name, fn, timeout);
  describe(`${def.meta.name} conforms to the game contract`, () => {
    check("json", "creates a plain-JSON state from the default config", () => {
      const state = def.create(def.configSchema.parse({}), ctxAt(0, seededRandomInt(1)));
      assertPlainJson(state);
      expect(JSON.parse(JSON.stringify(state))).toEqual(state);
      expect(def.players(state)).toEqual([]);
    });

    check("random", "survives random play by random people", () => {
      for (let seed = 1; seed <= SEEDS; seed++) {
        try {
          play(def, seed);
        } catch (e) {
          throw new Error(`seed ${seed}: ${(e as Error).message}`, { cause: e });
        }
      }
    }, 30_000);

    check("bots", "can be played by a table of built-in bots", () => {
      for (let seed = 1; seed <= 10; seed++) {
        try {
          playBots(def, seed);
        } catch (e) {
          throw new Error(`seed ${seed}: ${(e as Error).message}`, { cause: e });
        }
      }
    });
  });
}

/** Bots play from their views and legal ops, as in the browser; "people" only press start. */
function playBots(def: AnyGameDefinition, seed: number) {
  const rand = seededRandomInt(seed);
  const bots = Array.from({ length: Math.min(def.meta.maxPlayers, 3) }, (_, i) => `bot${i}`);
  let now = 1_000_000;
  let announced = 0;
  let state = def.create(def.configSchema.parse({}), ctxAt(now, rand));
  const step = (fn: (next: unknown) => void) => {
    const next = structuredClone(state);
    fn(next);
    state = next;
    def.checkInvariants?.(state);
  };

  for (let i = 0; i < 2000 && announced < 20; i++) {
    const moves = bots.map((bot, b) => ({ bot, op: botMove(def, def.view(state, bot), def.legalOps(state, bot), rand, "play", { quick: true, strength: b % 2 ? "easy" : "hard" }) }));
    for (const id of def.waitingOn(state)) {
      if (moves.find((m) => m.bot === id)?.op == null) throw new Error(`the game waits on ${id}, which has no move`);
    }
    const ready = moves.filter((m) => m.op != null);
    const ctx = ctxAt(now, rand, () => announced++);
    if (ready.length) {
      const { bot, op } = ready[rand(ready.length)]!;
      try {
        step((next) => def.apply(next, bot, def.opSchema.parse(op), ctx));
      } catch (e) {
        throw new Error(`${bot}'s move ${JSON.stringify(op)} was rejected: ${(e as Error).message}`);
      }
      continue;
    }
    const start = bots.flatMap((bot) => def.legalOps(state, bot).filter((op) => isLobbyOp(op) && op.type === "start").map((op) => ({ bot, op })))[0];
    const deadline = def.nextDeadline?.(state) ?? null;
    if (start) step((next) => def.apply(next, start.bot, start.op, ctx));
    else if (deadline !== null) {
      now = Math.max(now, deadline);
      step((next) => def.onDeadline!(next, ctxAt(now, rand, () => announced++)));
    } else break;
  }
  if (announced === 0) throw new Error("the bots never got anywhere");
}

const TABLE_MOVES = [{ type: "leave" }, { type: "sitOut" }, { type: "sitIn" }, { type: "start" }];

/** Ops are checked by `apply`, not by whether `legalOps` offered them: a custom client can send anything. */
function checkRefusesUnofferedTableMoves(def: AnyGameDefinition, state: unknown, actor: string, ctx: GameContext) {
  const offered = new Set(def.legalOps(state, actor).map((op) => JSON.stringify(op)));
  for (const op of TABLE_MOVES) {
    if (offered.has(JSON.stringify(op)) || !def.opSchema.safeParse(op).success) continue;
    try {
      def.apply(structuredClone(state), actor, op, ctx);
    } catch (e) {
      if (e instanceof GameError) continue;
      throw e;
    }
    throw new Error(`${actor} could ${op.type} without being offered it`);
  }
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

    if (rand(4) === 0) checkRefusesUnofferedTableMoves(def, state, actor, ctxAt(now, rand));

    const playing = def.players(state);
    if (playing.length && rand(40) === 0) {
      // Someone (a bot) removed for good.
      const gone = playing[rand(playing.length)]!;
      const next = structuredClone(state);
      def.removePlayer(next, gone, ctxAt(now, rand));
      if (def.players(next).includes(gone)) throw new Error(`${gone} is still playing after being removed`);
      state = next;
    } else if (ops.length && (deadline === null || rand(20) > 0)) {
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

    assertPlainJson(state);
    def.checkInvariants?.(state);
    const players = new Set(def.players(state));
    for (const id of def.waitingOn(state)) if (!players.has(id)) throw new Error(`waiting on non-player ${id}`);
    for (const viewer of [...people, "spectator"]) JSON.stringify(def.view(state, viewer));
  }
}

/**
 * Throws unless the value survives JSON unchanged: plain objects and arrays of strings,
 * booleans, null and finite numbers (an object's undefined fields are dropped, which is
 * fine). Much quicker than a deep comparison of a round trip, which ran on every step.
 */
function assertPlainJson(value: unknown, path = "state"): void {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`${path} is ${value}, which JSON can't hold`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, i) => {
      if (item === undefined) throw new Error(`${path}[${i}] is undefined`);
      assertPlainJson(item, `${path}[${i}]`);
    });
    return;
  }
  if (typeof value === "object") {
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) throw new Error(`${path} is a ${proto?.constructor?.name ?? "non-plain object"}`);
    for (const [key, item] of Object.entries(value)) if (item !== undefined) assertPlainJson(item, `${path}.${key}`);
    return;
  }
  throw new Error(`${path} is a ${typeof value}`);
}
