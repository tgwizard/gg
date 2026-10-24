import { describe, expect, it } from "vitest";
import { seededRandomInt } from "../kit/testing";
import type { GameContext } from "../types";
import { type CannonsConfig, type CannonsState, onDeadline, SETTLE_MS } from "./engine";
import { cannons as game } from "./index";
import { COLUMNS, CRATER_RADIUS, crater, dir, flight, groundAt, HIT_RADIUS, root, STEP, TICK_MS, WIDTH } from "./physics";
import { makeField } from "./terrain";

const flat = (h = 100) => Array.from({ length: COLUMNS }, () => h);

function setup(config: Partial<CannonsConfig> = {}, players = ["alice", "bob"]) {
  const announcements: string[] = [];
  let now = 0;
  const rand = seededRandomInt(7);
  const ctx = (): GameContext => ({ now, randomInt: rand, nameOf: (id) => id, announce: (t) => announcements.push(t) });
  const state = game.create(game.configSchema.parse({ players: players.length, ...config }), ctx());
  players.forEach((id, seat) => game.apply(state, id, { type: "sit", seat }, ctx()));
  return {
    state,
    ctx,
    announcements,
    setNow: (t: number) => (now = t),
    /** Let the ball in the air land. */
    land: () => {
      now = state.timers.land!;
      onDeadline(state, ctx());
    },
  };
}

/** A flat field with the cannons where we want them, by seat (and no wind), mid-game. */
function onFlat(state: CannonsState, xs: number[]) {
  state.terrain = flat();
  for (const c of state.cannons) c.x = xs[c.seat]!;
  state.wind = 0;
}

const cannonOf = (state: CannonsState, id: string) => state.cannons.findIndex((c) => c.playerId === id);

/** The first power at `angle` that hits `target` (an index), from whoever's turn it is. */
function hittingPower(state: CannonsState, angle: number, target: number) {
  for (let power = 5; power <= 100; power++) {
    if (flight({ terrain: state.terrain, cannons: state.cannons, shooter: state.turn, angle, power, wind: state.wind }).hit === target) return power;
  }
  throw new Error("nothing hits");
}

describe("cannons physics", () => {
  it("has exact, engine-independent angles and roots", () => {
    for (let a = 0; a <= 180; a++) {
      expect(dir(a).sin).toBeCloseTo(Math.sin((a * Math.PI) / 180), 9);
      expect(dir(a).cos).toBeCloseTo(Math.cos((a * Math.PI) / 180), 9);
    }
    expect(dir(90)).toEqual({ cos: 0, sin: 1 });
    for (const x of [0.05, 0.5, 2, 1234.5]) expect(root(x)).toBeCloseTo(Math.sqrt(x), 12);
  });

  it("flies the same way every time, and lands where the numbers say", () => {
    const input = { terrain: flat(), cannons: [{ x: 100, alive: true }, { x: 700, alive: true }], shooter: 0, angle: 45, power: 40, wind: 0 };
    const a = flight(input);
    expect(flight(structuredClone(input))).toEqual(a);
    expect(a.end).toBe("ground");
    expect(a.y).toBe(100);
    // Distance goes with power: 40% of 1200 m on the flat at 45°, give or take the barrel and the time step.
    expect(a.x - 100).toBeGreaterThan(470);
    expect(a.x - 100).toBeLessThan(510);
    expect(a.path.slice(0, 2)).toEqual([110, 119]);
    expect(a.path.slice(-2)).toEqual([a.x, a.y]);
    expect(a.path.every(Number.isInteger)).toBe(true);
    // Mirrored, it mirrors.
    const b = flight({ ...input, cannons: [{ x: 700, alive: true }, { x: 100, alive: true }], angle: 135 });
    expect(b.x).toBe(800 - a.x);
  });

  it("hits a cannon the ball passes close to, never its own on the way out, but its own when it comes back down", () => {
    const cannons = [{ x: 100, alive: true }, { x: 500, alive: true }];
    const hits = Array.from({ length: 96 }, (_, i) => flight({ terrain: flat(), cannons, shooter: 0, angle: 45, power: i + 5, wind: 0 }));
    const hit = hits.find((f) => f.hit === 1)!;
    expect(hit.end).toBe("cannon");
    expect(Math.abs(hit.x - 500)).toBeLessThanOrEqual(HIT_RADIUS);
    // A wreck doesn't stop a ball.
    expect(flight({ terrain: flat(), cannons: [cannons[0]!, { x: 500, alive: false }], shooter: 0, angle: 45, power: hit.ticks && hits.indexOf(hit) + 5, wind: 0 }).hit).toBeNull();
    // Point blank along the ground doesn't count as hitting yourself; straight up does, when it lands on you.
    expect(flight({ terrain: flat(), cannons, shooter: 0, angle: 0, power: 5, wind: 0 }).hit).toBeNull();
    expect(flight({ terrain: flat(), cannons, shooter: 0, angle: 90, power: 30, wind: 0 }).hit).toBe(0);
  });

  it("is pushed by the wind, more the longer it flies", () => {
    const base = { terrain: flat(), cannons: [{ x: 100, alive: true }, { x: 700, alive: true }], shooter: 0, angle: 60, power: 40 };
    const calm = flight({ ...base, wind: 0 });
    const right = flight({ ...base, wind: 5 });
    const left = flight({ ...base, wind: -5 });
    expect(right.x).toBeGreaterThan(calm.x + 20);
    expect(left.x).toBeLessThan(calm.x - 20);
    const lob = flight({ ...base, angle: 75, wind: 5 }).x - flight({ ...base, angle: 75, wind: 0 }).x;
    const flat30 = flight({ ...base, angle: 30, wind: 5 }).x - flight({ ...base, angle: 30, wind: 0 }).x;
    expect(lob).toBeGreaterThan(flat30);
  });

  it("can leave over the top and come back, or fly off the side for good", () => {
    const cannons = [{ x: 60, alive: true }, { x: 700, alive: true }];
    const high = flight({ terrain: flat(), cannons, shooter: 0, angle: 80, power: 100, wind: 0 });
    expect(Math.max(...high.path.filter((_, i) => i % 2 === 1))).toBeGreaterThan(500);
    expect(high.end).not.toBe("off");
    const gone = flight({ terrain: flat(), cannons, shooter: 0, angle: 40, power: 100, wind: 10 });
    expect(gone.end).toBe("off");
    expect(gone.x).toBeGreaterThan(WIDTH);
  });

  it("digs craters: a bowl in the flat, a bite out of a cliff, nothing below bedrock", () => {
    const t = crater(flat(), 400, 100);
    expect(t[100]).toBe(100 - CRATER_RADIUS);
    expect(t[100 - CRATER_RADIUS / STEP]).toBe(100);
    expect(t.filter((h, i) => h !== 100 && Math.abs(i * STEP - 400) >= CRATER_RADIUS)).toEqual([]);
    expect(groundAt(t, 400)).toBe(100 - CRATER_RADIUS);
    // A cliff hit half way up loses the part inside the circle; what's above settles down.
    const cliff = flat(300);
    const bitten = crater(cliff, 400, 150);
    expect(bitten[100]).toBe(300 - 2 * CRATER_RADIUS);
    expect(crater(flat(5), 400, 5).every((h) => h >= 0)).toBe(true);
  });

  it("makes fields of each kind, cannons on flat patches, the same from the same seed", () => {
    for (const style of ["gentle", "hilly", "mountains"] as const) {
      for (const n of [2, 3, 4]) {
        const f = makeField(style, 42, n);
        expect(makeField(style, 42, n)).toEqual(f);
        expect(f.terrain).toHaveLength(COLUMNS);
        expect(f.xs).toHaveLength(n);
        expect([...f.xs].sort((a, b) => a - b)).toEqual(f.xs);
        for (const x of f.xs) expect(groundAt(f.terrain, x - 6)).toBe(groundAt(f.terrain, x + 6));
      }
    }
    const peak = (style: "gentle" | "mountains") => Math.max(...makeField(style, 3, 2).terrain);
    expect(peak("mountains")).toBeGreaterThan(peak("gentle") + 80);
  });
});

describe("cannons", () => {
  it("starts when every seat is taken; a shot flies, then lands, then it's the next turn", () => {
    const { state, ctx, announcements, land, setNow } = setup({ turnSeconds: 30 });
    expect(state.phase).toBe("aiming");
    expect(game.waitingOn(state)).toEqual(["alice"]);
    expect(game.nextDeadline!(state)).toBe(30_000);
    expect(() => game.apply(state, "bob", { type: "fire", angle: 135, power: 50 }, ctx())).toThrow(/not your turn/);
    onFlat(state, [100, 700]);
    setNow(1000);
    game.apply(state, "alice", { type: "fire", angle: 45, power: 20 }, ctx());
    const shot = state.shots[0]!;
    expect(shot).toMatchObject({ n: 1, by: "alice", angle: 45, power: 20, wind: 0, end: "ground", hit: null, near: { playerId: "bob", side: 1 } });
    expect(shot.near!.dx).toBeLessThan(-300);
    // Flying: nobody's turn, no new shots, and the crater is already there.
    expect(state.phase).toBe("flying");
    expect(game.waitingOn(state)).toEqual([]);
    expect(game.legalOps(state, "bob")).toEqual([{ type: "leave" }]);
    expect(game.nextDeadline!(state)).toBe(1000 + shot.ticks * TICK_MS + SETTLE_MS);
    expect(groundAt(state.terrain, shot.x)).toBeLessThan(100);
    expect(game.view(state, "bob").landsAt).toBe(game.nextDeadline!(state));
    land();
    expect(state.phase).toBe("aiming");
    expect(game.waitingOn(state)).toEqual(["bob"]);
    expect(announcements).toEqual([]);
    expect(game.view(state, "alice").situation.join("\n")).toMatch(/#1 by you: angle 45 \(45° up, to the right\), power 20, no wind: landed \d+ m short of player bob \(to the left\)/);
  });

  it("knocks out the cannon it hits, and the last one standing wins", () => {
    const { state, ctx, announcements, land } = setup();
    onFlat(state, [100, 600]);
    game.apply(state, "alice", { type: "fire", angle: 45, power: hittingPower(state, 45, cannonOf(state, "bob")) }, ctx());
    expect(state.shots[0]!.hit).toBe("bob");
    expect(state.cannons[cannonOf(state, "bob")]!.alive).toBe(false);
    // Nothing's said until the ball has landed on screen.
    expect(announcements).toEqual([]);
    expect(state.phase).toBe("flying");
    land();
    expect(announcements).toEqual(["alice hit bob's cannon!", "Cannons game 1: alice wins, the last cannon standing after 1 shot."]);
    expect(state.result).toEqual({ winner: "alice", reason: "hit", shots: 1 });
    expect(state.seats[0]!.wins).toBe(1);
    expect(game.view(state, "bob").result).toEqual(state.result);
    // Play again: a new field, and bob fires first.
    game.apply(state, "bob", { type: "rematch" }, ctx());
    expect(state.game).toBe(2);
    expect(state.cannons.every((c) => c.alive)).toBe(true);
    expect(game.waitingOn(state)).toEqual(["bob"]);
  });

  it("plays on in a free for all until one cannon is left", () => {
    const { state, ctx, land } = setup({}, ["a", "b", "c"]);
    onFlat(state, [100, 400, 700]);
    const order = game.waitingOn(state);
    const shooter = state.turn;
    const target = (shooter + 1) % 3;
    const angle = state.cannons[target]!.x > state.cannons[shooter]!.x ? 45 : 135;
    game.apply(state, order[0]!, { type: "fire", angle, power: hittingPower(state, angle, target) }, ctx());
    land();
    expect(state.phase).toBe("aiming");
    expect(state.cannons.filter((c) => c.alive)).toHaveLength(2);
    // The knocked-out cannon's turn is skipped.
    expect(state.cannons[state.turn]!.alive).toBe(true);
    expect(state.turn).not.toBe(target);
  });

  it("skips your shot when your clock runs out, and three in a row puts you out", () => {
    const { state, ctx, land, setNow, announcements } = setup({ turnSeconds: 10 });
    onFlat(state, [100, 700]);
    game.apply(state, "alice", { type: "fire", angle: 50, power: 12 }, ctx());
    land();
    // Bob times out three times (alice fires in between).
    for (let i = 1; i <= 3; i++) {
      setNow(game.nextDeadline!(state)!);
      onDeadline(state, ctx());
      if (i < 3) {
        // No shot: the turn just passes back to alice.
        expect(state.shots.filter((s) => s.by === "bob")).toHaveLength(0);
        expect(state.phase).toBe("aiming");
        expect(game.waitingOn(state)).toEqual(["alice"]);
        expect(game.view(state, "alice").passed).toBe("bob");
        expect(announcements.at(-1)).toMatch(new RegExp(`ran out of time: no shot this turn \\(${i} of 3\\)`));
        game.apply(state, "alice", { type: "fire", angle: 50, power: 12 }, ctx());
        land();
      }
    }
    expect(state.cannons[cannonOf(state, "bob")]).toMatchObject({ alive: false, out: "timeouts" });
    expect(state.result).toMatchObject({ winner: "alice", reason: "timeouts" });
    expect(announcements.some((a) => a.includes("ran out of time 3 times"))).toBe(true);
  });

  it("calls the game off if someone leaves before any shot, and puts them out after", () => {
    const { state, ctx, announcements } = setup();
    game.apply(state, "bob", { type: "leave" }, ctx());
    expect(state.phase).toBe("waiting");
    expect(state.game).toBe(0);
    expect(announcements.at(-1)).toMatch(/called off/);
    game.apply(state, "carol", { type: "sit", seat: 1 }, ctx());
    expect(state.phase).toBe("aiming");
    onFlat(state, [100, 700]);
    const first = game.waitingOn(state)[0]!;
    game.apply(state, first, { type: "fire", angle: first === "alice" ? 45 : 135, power: 10 }, ctx());
    // Leaving with a ball in the air: it lands first, then the leaver is out.
    game.apply(state, "alice", { type: "leave" }, ctx());
    expect(state.result).toMatchObject({ winner: "carol", reason: "left" });
    expect(game.players(state)).toEqual(["carol"]);
    expect(state.timers).toEqual({});
  });

  it("offers a few example aims, and takes any whole angle and power in range", () => {
    const { state, ctx } = setup();
    const ops = game.legalOps(state, "alice").filter((op) => op.type === "fire");
    expect(ops).toHaveLength(9);
    expect(game.legalOps(state, "bob").filter((op) => op.type === "fire")).toEqual([]);
    expect(game.opSchema.safeParse({ type: "fire", angle: 45.5, power: 50 }).success).toBe(false);
    expect(game.opSchema.safeParse({ type: "fire", angle: 181, power: 50 }).success).toBe(false);
    expect(game.opSchema.safeParse({ type: "fire", angle: 0, power: 4 }).success).toBe(false);
    game.apply(state, "alice", { type: "fire", angle: 177, power: 99 }, ctx());
    expect(state.shots).toHaveLength(1);
  });

  it("keeps the wind in range, changing it between turns", () => {
    const { state, ctx, land } = setup({ wind: "strong" });
    const winds = new Set<number>();
    for (let i = 0; i < 30 && state.phase !== "over"; i++) {
      winds.add(state.wind);
      expect(Math.abs(state.wind)).toBeLessThanOrEqual(10);
      game.apply(state, game.waitingOn(state)[0]!, { type: "fire", angle: 0, power: 5 }, ctx());
      land();
    }
    expect(winds.size).toBeGreaterThan(4);
    expect(setup({ wind: "none" }).state.wind).toBe(0);
  });

  it("only keeps the latest path of each player, for the traces", () => {
    const { state, ctx, land } = setup();
    for (let i = 0; i < 6; i++) {
      game.apply(state, game.waitingOn(state)[0]!, { type: "fire", angle: 0, power: 5 }, ctx());
      land();
    }
    expect(state.shots.filter((s) => s.path).map((s) => s.n)).toEqual([5, 6]);
    game.checkInvariants!(state);
  });
});

describe("the built-in bot", () => {
  /** Shots the bot needs to hit a target that doesn't shoot back. */
  function shotsToHit(terrain: CannonsConfig["terrain"], wind: CannonsConfig["wind"], seed: number) {
    const rand = seededRandomInt(seed);
    let now = 0;
    const ctx = (): GameContext => ({ now, randomInt: rand, nameOf: (id) => id, announce: () => {} });
    const state = game.create({ players: 2, terrain, wind, turnSeconds: 0 }, ctx());
    game.apply(state, "bot", { type: "sit", seat: 0 }, ctx());
    game.apply(state, "dummy", { type: "sit", seat: 1 }, ctx());
    let shots = 0;
    for (let i = 0; i < 80 && state.phase !== "over"; i++) {
      if (state.phase === "flying") {
        now = state.timers.land!;
        onDeadline(state, ctx());
        continue;
      }
      const who = game.waitingOn(state)[0]!;
      if (who === "bot") {
        game.apply(state, who, game.bot.easy(game.view(state, who), game.legalOps(state, who).filter((op) => op.type === "fire"), rand)!, ctx());
        shots++;
      } else {
        // The dummy fires away from the bot, harmlessly.
        const me = state.cannons[state.turn]!;
        game.apply(state, who, { type: "fire", angle: me.x > 400 ? 0 : 180, power: 5 }, ctx());
      }
    }
    return state.result?.winner === "bot" ? shots : Infinity;
  }

  it("homes in like a person: rarely with the first shot, usually within a few", () => {
    const counts: number[] = [];
    for (const terrain of ["gentle", "hilly", "mountains"] as const) {
      for (const wind of ["none", "light", "strong"] as const) for (let seed = 1; seed <= 15; seed++) counts.push(shotsToHit(terrain, wind, seed));
    }
    counts.sort((a, b) => a - b);
    const median = counts[Math.floor(counts.length / 2)]!;
    expect(median).toBeGreaterThanOrEqual(2);
    expect(median).toBeLessThanOrEqual(4);
    expect(counts.filter((n) => n === 1).length / counts.length).toBeLessThan(0.2);
    expect(counts.filter((n) => n <= 8).length / counts.length).toBeGreaterThan(0.9);
  });

  it("waits when it's not its turn", () => {
    const { state } = setup();
    expect(game.bot.easy(game.view(state, "bob"), [], seededRandomInt(1))).toBeNull();
    expect(game.bot.easy(game.view(state, "alice"), game.legalOps(state, "alice").filter((op) => op.type === "fire"), seededRandomInt(1))).toMatchObject({ type: "fire" });
  });
});
