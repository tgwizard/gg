import { describe, expect, it } from "vitest";
import { seededRandomInt } from "../kit/testing";
import type { GameContext } from "../types";
import {
  type BsConfig,
  type BsState,
  CELLS,
  FLEET,
  layoutError,
  MAX_TIMEOUTS,
  randomLayout,
  type ShipPlacement,
  shipCells,
  viewFor,
} from "./engine";
import { battleship as game } from "./index";

const DEFAULTS: BsConfig = { turnSeconds: 30, placeSeconds: 120, shipsMayTouch: true, hitShootsAgain: false };

/** A known layout: every ship along the left edge, on even rows. */
const LEFT: ShipPlacement[] = [
  { id: "carrier", row: 0, col: 0, vertical: false },
  { id: "battleship", row: 2, col: 0, vertical: false },
  { id: "cruiser", row: 4, col: 0, vertical: false },
  { id: "submarine", row: 6, col: 0, vertical: false },
  { id: "destroyer", row: 8, col: 0, vertical: false },
];
const LEFT_CELLS = LEFT.flatMap((s) => shipCells(s)!);
/** Cells LEFT never covers (the right half of the grid). */
const WATER = Array.from({ length: CELLS }, (_, i) => i).filter((c) => c % 10 >= 5);

function setup(config: Partial<BsConfig> = {}, seed = 1) {
  const announcements: string[] = [];
  const rand = seededRandomInt(seed);
  const ctx = (now = 0): GameContext => ({ now, randomInt: rand, nameOf: (id) => id, announce: (t) => announcements.push(t) });
  const state = game.create({ ...DEFAULTS, ...config }, ctx());
  game.apply(state, "a", { type: "sit", seat: 0 }, ctx());
  game.apply(state, "b", { type: "sit", seat: 1 }, ctx());
  return { state, ctx, announcements };
}

/** Both fleets placed (b's as LEFT, a's too unless given) and ready; a shoots first. */
function firing(config: Partial<BsConfig> = {}, aShips = LEFT) {
  const s = setup(config);
  game.apply(s.state, "a", { type: "arrange", ships: aShips }, s.ctx());
  game.apply(s.state, "b", { type: "arrange", ships: LEFT }, s.ctx());
  game.apply(s.state, "a", { type: "ready" }, s.ctx());
  game.apply(s.state, "b", { type: "ready" }, s.ctx());
  return s;
}

const fire = (state: BsState, ctx: () => GameContext, who: string, cell: number) => game.apply(state, who, { type: "fire", cell }, ctx());

describe("battleship: placing", () => {
  it("starts placing once both seats fill, and waits on whoever isn't ready", () => {
    const { state, ctx } = setup();
    expect(state.phase).toBe("placing");
    expect(state.game).toBe(1);
    expect(game.waitingOn(state)).toEqual(["a", "b"]);
    expect(state.timers.place).toBe(120_000);
    game.apply(state, "a", { type: "random" }, ctx());
    game.apply(state, "a", { type: "ready" }, ctx());
    expect(game.waitingOn(state)).toEqual(["b"]);
  });

  it("validates layouts on the server", () => {
    const { state, ctx } = setup();
    const arrange = (ships: ShipPlacement[], who = "a") => game.apply(state, who, { type: "arrange", ships }, ctx());
    expect(() => arrange([{ id: "carrier", row: 0, col: 6, vertical: false }])).toThrow(/doesn't fit/);
    expect(() => arrange([{ id: "destroyer", row: 9, col: 3, vertical: true }])).toThrow(/doesn't fit/);
    expect(() =>
      arrange([
        { id: "carrier", row: 0, col: 0, vertical: false },
        { id: "destroyer", row: 0, col: 4, vertical: true },
      ]),
    ).toThrow(/overlap/);
    expect(() =>
      arrange([
        { id: "cruiser", row: 0, col: 0, vertical: false },
        { id: "cruiser", row: 5, col: 0, vertical: false },
      ]),
    ).toThrow(/only one Cruiser/);
    // The op schema keeps out anything that isn't a fleet ship or is off the grid.
    expect(() => game.opSchema.parse({ type: "arrange", ships: [{ id: "rowboat", row: 0, col: 0, vertical: false }] })).toThrow();
    expect(() => game.opSchema.parse({ type: "arrange", ships: [{ id: "destroyer", row: 10, col: 0, vertical: false }] })).toThrow();
    expect(() => game.opSchema.parse({ type: "fire", cell: 100 })).toThrow();

    // Partial layouts are fine (you place one ship at a time), but you can't be ready with one.
    arrange(LEFT.slice(0, 2));
    expect(state.fleets[0]!.ships).toHaveLength(2);
    expect(() => game.apply(state, "a", { type: "ready" }, ctx())).toThrow(/all five/);
    arrange(LEFT);
    game.apply(state, "a", { type: "ready" }, ctx());
    expect(() => arrange(LEFT.slice(1))).toThrow(/ready/);
    game.apply(state, "a", { type: "unready" }, ctx());
    arrange(LEFT.slice(1));
    // Spectators can't place anything.
    expect(() => arrange(LEFT, "spectator")).toThrow(/not seated/);
  });

  it("only lets ships touch when the setting allows it", () => {
    const touching: ShipPlacement[] = [
      { id: "carrier", row: 0, col: 0, vertical: false },
      { id: "destroyer", row: 1, col: 5, vertical: false }, // diagonal to the carrier's stern
    ];
    expect(layoutError(touching, true)).toBeNull();
    expect(layoutError(touching, false)).toMatch(/can't touch/);
    expect(layoutError(LEFT, false)).toBeNull(); // a row of water between each
    const { state, ctx } = setup({ shipsMayTouch: false });
    expect(() => game.apply(state, "a", { type: "arrange", ships: touching }, ctx())).toThrow(/can't touch/);
  });

  it("deals random fleets that are always valid", () => {
    for (const mayTouch of [true, false]) {
      for (let seed = 1; seed <= 200; seed++) {
        const ships = randomLayout(seededRandomInt(seed), mayTouch);
        expect(ships.map((s) => s.id)).toEqual(FLEET.map((s) => s.id));
        expect(layoutError(ships, mayTouch)).toBeNull();
      }
    }
    // Finishing a fleet keeps the ships already placed.
    const kept = randomLayout(seededRandomInt(3), false, LEFT.slice(0, 2));
    expect(kept.slice(0, 2)).toEqual(LEFT.slice(0, 2));
    expect(layoutError(kept, false)).toBeNull();
  });

  it("starts firing when both are ready, with the opener alternating each game", () => {
    const { state } = firing();
    expect(state.phase).toBe("firing");
    expect(state.timers.place).toBeUndefined();
    expect(state.timers.turn).toBe(30_000);
    expect(game.waitingOn(state)).toEqual(["a"]);
    expect(state.opener).toBe(1);
  });

  it("finishes unfinished fleets at random when the placement clock runs out", () => {
    const { state, ctx } = setup();
    game.apply(state, "a", { type: "arrange", ships: LEFT.slice(0, 3) }, ctx());
    game.onDeadline!(state, ctx(120_000));
    expect(state.phase).toBe("firing");
    for (const f of state.fleets) {
      expect(f!.ready).toBe(true);
      expect(f!.ships).toHaveLength(5);
    }
    expect(state.fleets[0]!.ships.slice(0, 3)).toEqual(LEFT.slice(0, 3));
    expect(state.timers.turn).toBe(150_000);
  });

  it("calls the game off, unscored, if someone leaves while placing", () => {
    const { state, ctx } = setup();
    game.apply(state, "a", { type: "random" }, ctx());
    game.apply(state, "b", { type: "leave" }, ctx());
    expect(state.phase).toBe("waiting");
    expect(state.fleets).toEqual([null, null]);
    expect(game.nextDeadline!(state)).toBeNull();
    game.apply(state, "c", { type: "sit", seat: 1 }, ctx());
    expect(state.phase).toBe("placing");
    expect(state.fleets[1]!.playerId).toBe("c");
  });
});

describe("battleship: firing", () => {
  it("reports misses, hits and sinkings, with strict alternation by default", () => {
    const { state, ctx } = firing();
    expect(() => fire(state, ctx, "b", 0)).toThrow(/not your turn/);
    fire(state, ctx, "a", 9); // miss
    expect(state.log.at(-1)).toMatchObject({ type: "shot", by: "a", target: "b", cell: 9, result: "miss", ship: null, cells: null });
    fire(state, ctx, "b", 99);
    fire(state, ctx, "a", 80); // hit the destroyer
    expect(state.log.at(-1)).toMatchObject({ result: "hit", ship: null, cells: null });
    expect(game.waitingOn(state)).toEqual(["b"]); // a hit doesn't earn another shot
    fire(state, ctx, "b", 98);
    expect(() => fire(state, ctx, "a", 80)).toThrow(/already fired at A9/);
    fire(state, ctx, "a", 81); // sunk
    expect(state.log.at(-1)).toMatchObject({ result: "sunk", ship: "destroyer", cells: [80, 81] });
    // Off-grid shots are refused by the engine too, not just the op schema.
    fire(state, ctx, "b", 97);
    expect(() => fire(state, ctx, "a", 100)).toThrow(/off the grid/);
    expect(() => fire(state, ctx, "a", -1)).toThrow(/off the grid/);
    expect(() => fire(state, ctx, "spectator", 5)).toThrow(/not seated/);
  });

  it("gives another shot after a hit when the setting is on", () => {
    const { state, ctx } = firing({ hitShootsAgain: true });
    fire(state, ctx, "a", 0);
    expect(game.waitingOn(state)).toEqual(["a"]);
    fire(state, ctx, "a", 9); // miss: over to b
    expect(game.waitingOn(state)).toEqual(["b"]);
  });

  it("can't fire before the shooting starts", () => {
    const { state, ctx } = setup();
    expect(() => fire(state, ctx, "a", 0)).toThrow(/nothing to fire at/);
  });

  it("plays a whole game: sink the fleet, win, reveal both fleets, then a rematch", () => {
    const aShips = randomLayout(seededRandomInt(7), true);
    const aCells = new Set(aShips.flatMap((s) => shipCells(s)!));
    const { state, ctx, announcements } = firing({}, aShips);
    // a fires at every LEFT cell; b fires into water a doesn't use.
    const bTargets = Array.from({ length: CELLS }, (_, i) => i).filter((c) => !aCells.has(c));
    for (const [i, cell] of LEFT_CELLS.entries()) {
      fire(state, ctx, "a", cell);
      if (state.phase === "firing") fire(state, ctx, "b", bTargets[i]!);
    }
    expect(state.phase).toBe("over");
    expect(state.result).toEqual({ winner: "a", loser: "b", forfeit: null, shots: 17 });
    expect(state.seats[0]!.wins).toBe(1);
    expect(announcements.at(-1)).toBe("Battleship game 1: a sank b's whole fleet in 17 shots!");
    expect(game.nextDeadline!(state)).toBeNull();
    for (const viewer of ["a", "b", "spectator"]) {
      const v = viewFor(state, viewer);
      expect(v.boards[0]!.ships).toEqual(aShips);
      expect(v.boards[1]!.ships).toEqual(LEFT);
    }

    expect(game.legalOps(state, "b")).toContainEqual({ type: "rematch" });
    game.apply(state, "b", { type: "rematch" }, ctx(5000));
    expect(state.phase).toBe("placing");
    expect(state.game).toBe(2);
    expect(state.fleets.map((f) => f!.ships)).toEqual([[], []]);
    expect(state.log).toEqual([]);
    game.apply(state, "a", { type: "random" }, ctx());
    game.apply(state, "b", { type: "random" }, ctx());
    game.apply(state, "a", { type: "ready" }, ctx());
    game.apply(state, "b", { type: "ready" }, ctx());
    expect(game.waitingOn(state)).toEqual(["b"]); // b opens game 2
  });

  it("fires a random shot when the turn clock runs out, and forfeits after three in a row", () => {
    const { state, ctx, announcements } = firing({ turnSeconds: 10 });
    let now = 0;
    const timeout = () => {
      now = game.nextDeadline!(state)!;
      game.onDeadline!(state, ctx(now));
    };
    timeout(); // a times out: a random shot is fired for them
    expect(state.log.at(-1)).toMatchObject({ type: "shot", by: "a", auto: true });
    expect(state.fleets[0]!.timeouts).toBe(1);
    expect(game.waitingOn(state)).toEqual(["b"]);
    fire(state, () => ctx(now), "b", WATER[0]!);
    timeout(); // a again
    fire(state, () => ctx(now), "b", WATER[1]!);
    const open = game.legalOps(state, "a").find((o) => o.type === "fire")!;
    game.apply(state, "a", open, ctx(now)); // a's own shot clears the count
    expect(state.fleets[0]!.timeouts).toBe(0);
    for (let i = 0; i < MAX_TIMEOUTS; i++) {
      fire(state, () => ctx(now), "b", WATER[3 + i]!);
      timeout();
    }
    expect(state.phase).toBe("over");
    expect(state.result).toMatchObject({ winner: "b", loser: "a", forfeit: "timeouts" });
    expect(state.seats[1]!.wins).toBe(1);
    expect(announcements.at(-1)).toMatch(/b wins, a ran out of time 3 times/);
  });

  it("forfeits if you leave mid-game", () => {
    const { state, ctx } = firing();
    fire(state, ctx, "a", 0);
    game.apply(state, "a", { type: "leave" }, ctx());
    expect(state.phase).toBe("over");
    expect(state.result).toMatchObject({ winner: "b", loser: "a", forfeit: "left" });
    expect(state.seats[1]!.wins).toBe(1);
    expect(game.legalOps(state, "b")).not.toContainEqual({ type: "rematch" }); // needs an opponent
  });
});

describe("battleship: secrecy", () => {
  const otherLayout = randomLayout(seededRandomInt(42), true);

  /** The same state with b's ships somewhere else. */
  function withBShips(state: BsState, ships: ShipPlacement[]): BsState {
    const copy = structuredClone(state);
    copy.fleets[1]!.ships = structuredClone(ships);
    return copy;
  }

  it("never shows a fleet to the opponent or spectators while placing", () => {
    const { state, ctx } = setup();
    for (const step of ["arrange", "random", "ready"] as const) {
      if (step === "arrange") game.apply(state, "b", { type: "arrange", ships: LEFT.slice(0, 2) }, ctx());
      else game.apply(state, "b", { type: step }, ctx());
      for (const viewer of ["a", "spectator"]) {
        const v = viewFor(state, viewer);
        expect(v.boards[1]!.ships).toBeNull();
        // The view doesn't depend on where b's ships are at all.
        expect(viewFor(withBShips(state, otherLayout), viewer)).toEqual(v);
        expect(viewFor(withBShips(state, []), viewer)).toEqual(v);
      }
      // b sees their own.
      expect(viewFor(state, "b").boards[1]!.ships).toEqual(state.fleets[1]!.ships);
    }
    expect(viewFor(state, "a").boards[1]!.ready).toBe(true);
  });

  it("only reveals what the shots did while firing (sunk ships included, other ships never)", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const { state, ctx } = firing({}, randomLayout(seededRandomInt(seed + 100), true));
      state.fleets[1]!.ships = randomLayout(seededRandomInt(seed), true);
      const pick = seededRandomInt(seed + 1000);
      let checked = 0;
      while (state.phase === "firing") {
        const who = game.waitingOn(state)[0]!;
        const ops = game.legalOps(state, who).filter((o) => o.type === "fire");
        game.apply(state, who, ops[pick(ops.length)]!, ctx());
        if (state.phase !== "firing") break;

        const b = state.fleets[1]!;
        for (const viewer of ["a", "spectator"]) {
          const v = viewFor(state, viewer);
          expect(v.boards[1]!.ships).toBeNull();
          // Ship layouts are the only thing with rows in them.
          expect(JSON.stringify([v.boards[1], v.log, v.result])).not.toContain('"row"');
          // Every cell mentioned for b is one that's been fired at.
          const fired = new Set(b.shots);
          for (const s of v.boards[1]!.sunk) for (const c of s.cells) expect(fired.has(c)).toBe(true);
          for (const e of v.log) if (e.type === "shot" && e.target === "b") for (const c of [e.cell, ...(e.cells ?? [])]) expect(fired.has(c)).toBe(true);
        }
        // Move b's untouched ships somewhere else consistent with the shots so far: nothing a or a
        // spectator sees may change.
        const hitShips = b.ships.filter((s) => shipCells(s)!.some((c) => b.shots.includes(c)));
        for (let k = 0; k < 20; k++) {
          const moved = randomLayout(seededRandomInt(seed * 1000 + checked * 20 + k), true, hitShips);
          const newCells = moved.filter((s) => !hitShips.some((h) => h.id === s.id)).flatMap((s) => shipCells(s)!);
          if (newCells.some((c) => b.shots.includes(c))) continue;
          if (!hitShips.every((h) => moved.some((m) => JSON.stringify(m) === JSON.stringify(h)))) continue;
          for (const viewer of ["a", "spectator"]) expect(viewFor(withBShips(state, moved), viewer)).toEqual(viewFor(state, viewer));
          checked++;
          break;
        }
      }
      expect(checked).toBeGreaterThan(5);
      // At the end, everything's revealed.
      expect(viewFor(state, "a").boards[1]!.ships).toEqual(state.fleets[1]!.ships);
    }
  });
});
