/**
 * Every /try scenario builds, with any player ids, into a state the game (and so the
 * room) accepts: plain JSON, its invariants hold, everyone in it is playing, and each
 * has a view. And it comes out the same whoever plays it.
 */
import { describe, expect, it } from "vitest";
import { MAX_OWNED_PER_PLAYER } from "../shared/protocol";
import { games } from "./registry";
import { scenarios } from "./scenarios";
import type { GameContext } from "./types";

const ctx: GameContext = { now: 1_800_000_000_000, randomInt: (n) => Math.floor(Math.random() * n), nameOf: (id) => id, announce: () => {} };
/** Short names, and ids shaped like real ones. */
const ID_SETS = [
  ["you", "bot1", "bot2", "bot3", "bot4"],
  ["3f9a0c1d2b4e5f60", "a1b2c3d4e5f60718", "0011223344556677", "8899aabbccddeeff", "fedcba9876543210"],
];

describe("scenarios", () => {
  it("cover every game, with unique ids that fit in a URL", () => {
    expect(Object.keys(scenarios).sort()).toEqual(Object.keys(games).sort());
    for (const list of Object.values(scenarios)) {
      expect(new Set(list.map((s) => s.id)).size).toBe(list.length);
      for (const s of list) expect(s.id).toMatch(/^[a-z0-9-]+$/);
    }
  });

  for (const [gameId, list] of Object.entries(scenarios)) {
    const def = games[gameId]!;
    for (const scenario of list) {
      it(`${gameId}/${scenario.id} builds a valid state`, () => {
        expect(scenario.bots).toBeGreaterThanOrEqual(1);
        expect(scenario.bots).toBeLessThanOrEqual(MAX_OWNED_PER_PLAYER);
        const built = ID_SETS.map((ids) => {
          const players = ids.slice(0, scenario.bots + 1);
          const state = scenario.build(players, ctx);
          def.checkInvariants?.(state);
          expect(JSON.parse(JSON.stringify(state))).toEqual(state);
          expect([...def.players(state)].sort()).toEqual([...players].sort());
          for (const id of [...players, "someone else"]) expect(JSON.parse(JSON.stringify(def.view(state, id)))).toBeTruthy();
          return { players, json: JSON.stringify(state) };
        });
        const [a, b] = built as [(typeof built)[0], (typeof built)[0]];
        const renamed = b.players.reduce((json, id, i) => json.replaceAll(id, a.players[i]!), b.json);
        expect(renamed).toBe(a.json);
      });
    }
  }
});
