import { describe, expect, it } from "vitest";
import type { GameContext } from "../types";
import { BRIDGE, FINISH, LOOP, RIDERS, type Rider, TRACK, type UnicornState } from "./engine";
import { unicorn as game } from "./index";

/** A die that rolls what it's told (randomInt also picks who opens: 0 = the first candidate). */
function setup(players: [string, boolean][], rainbowAt = 20) {
  const announcements: string[] = [];
  const rolls: number[] = [];
  const ctx: GameContext = {
    now: 0,
    randomInt: (n) => (n === 6 ? (rolls.shift() ?? 1) - 1 : 0),
    nameOf: (id) => id,
    announce: (t) => announcements.push(t),
  };
  const state = game.create(game.configSchema.parse({ rainbowAt }), ctx);
  players.forEach(([id, kid], seat) => game.apply(state, id, { type: "sit", seat, kid }, ctx));
  game.apply(state, players[0]![0], { type: "start" }, ctx);
  const step = (who: string, op: Parameters<typeof game.apply>[2]) => {
    game.apply(state, who, op, ctx);
    game.checkInvariants!(state);
  };
  const roll = (who: string, value: number) => {
    rolls.push(value);
    step(who, { type: "roll" });
  };
  const pick = (who: string, rider: Rider) => step(who, { type: "pick", rider });
  return { state, ctx, announcements, roll, pick };
}

const racer = (state: UnicornState, id: string) => state.racers.find((r) => r.playerId === id)!;

describe("Unicorn race", () => {
  it("lets a kid go first, gallops forward, and has you pick up whoever's at a stop yourself", () => {
    const { state, ctx, roll, pick } = setup([
      ["mum", false],
      ["ada", true],
    ]);
    expect(game.waitingOn(state)).toEqual(["ada"]);
    roll("ada", 2); // the Ladybug's stop
    expect(racer(state, "ada")).toMatchObject({ at: 2, riders: [] });
    // Even one friend waits to be picked up.
    expect(game.view(state, "ada").you.pick).toEqual(["ladybug"]);
    expect(game.waitingOn(state)).toEqual(["ada"]);
    expect(() => game.apply(state, "ada", { type: "roll" }, ctx)).toThrow(/Pick up a friend first/);
    pick("ada", "ladybug");
    expect(racer(state, "ada").riders).toEqual(["ladybug"]);
    expect(game.waitingOn(state)).toEqual(["mum"]);
    roll("mum", 1); // meadow: nothing to pick, the turn passes
    expect(racer(state, "mum")).toMatchObject({ at: 1, riders: [] });
    expect(game.waitingOn(state)).toEqual(["ada"]);
    expect(game.legalOps(state, "ada")).toContainEqual({ type: "roll" });
    expect(game.legalOps(state, "mum")).not.toContainEqual({ type: "roll" });
  });

  it("offers only friends you don't have, and nothing where you have them all", () => {
    const { state, ctx, roll, pick } = setup([["ada", true]]);
    expect(() => game.apply(state, "ada", { type: "pick", rider: "fox" }, ctx)).toThrow(/Roll the die first/);
    roll("ada", 5); // the chick or the frog
    expect(game.view(state, "ada").you.pick).toEqual(["chick", "frog"]);
    expect(() => game.apply(state, "ada", { type: "pick", rider: "fox" }, ctx)).toThrow(/no Fox for you here/);
    pick("ada", "frog");
    roll("ada", 6); // the Frog's own stop: aboard already, so nothing
    expect(state.stage).toBe("roll");
    roll("ada", 6); // the Whale
    pick("ada", "whale");
    roll("ada", 1); // the frog, the chick or the octopus: not the frog again
    expect(game.view(state, "ada").you.pick).toEqual(["chick", "octopus"]);
  });

  it("fills the rainbow with every roll and gives the kids a rainbow roll", () => {
    const { state, announcements, roll, pick } = setup(
      [
        ["ada", true],
        ["mum", false],
        ["bo", true],
      ],
      10,
    );
    roll("ada", 4); // meadow at 4
    roll("mum", 4);
    expect(state.rainbow).toBe(8);
    // Bo's roll fills it: Bo rolls again straight after picking up the Fox, Ada after her next move.
    roll("bo", 3);
    expect(state.rainbow).toBe(0);
    expect(announcements.at(-1)).toBe("Rainbow power! ada & bo get a rainbow roll.");
    expect(racer(state, "mum").rainbowRolls).toBe(0);
    pick("bo", "fox");
    expect(game.waitingOn(state)).toEqual(["bo"]);
    expect(state.rainbowRoll).toBe(true);
    roll("bo", 1);
    expect(game.waitingOn(state)).toEqual(["ada"]);
    expect(state.rainbowRoll).toBe(false);
    roll("ada", 3);
    expect(game.waitingOn(state)).toEqual(["ada"]);
    roll("ada", 3);
    expect(game.waitingOn(state)).toEqual(["mum"]);
  });

  it("opens the rainbow bridge for whoever has all six: round to the start, over it, and the castle wins", () => {
    const { state, ctx, announcements, roll, pick } = setup([
      ["ada", true],
      ["mum", false],
    ]);
    racer(state, "ada").riders = ["fox", "chick", "frog", "whale", "octopus"];
    roll("ada", 2);
    pick("ada", "ladybug");
    expect(state.phase).toBe("playing");
    expect(announcements.at(-1)).toMatch(/ada has all six friends! The rainbow bridge is open/);
    // Mum, without six, goes round past the start as usual.
    racer(state, "mum").at = 27;
    roll("mum", 5);
    expect(racer(state, "mum").at).toBe(2);
    pick("mum", "ladybug");
    // Ada, with six, turns onto the bridge at the start (6 from stop 26: 4 to the start, 2 on).
    racer(state, "ada").at = 26;
    roll("ada", 6);
    expect(racer(state, "ada").at).toBe(LOOP + 1);
    roll("mum", 2); // meadow
    // Nobody to pick up on the bridge; galloping past the castle is getting there.
    roll("ada", 6);
    expect(racer(state, "ada").at).toBe(FINISH);
    expect(FINISH - LOOP).toBe(BRIDGE - 1);
    expect(state.phase).toBe("over");
    expect(state.result).toEqual({ winners: ["ada"] });
    expect(state.seats[0]!.wins).toBe(1);
    expect(announcements.at(-1)).toBe("ada reaches the castle with all six friends and wins the race!");
    expect(game.waitingOn(state)).toEqual([]);
    expect(() => game.apply(state, "mum", { type: "roll" }, ctx)).toThrow(/no race on/);
    // The next race opens with the next racer, everyone back at the start with nobody aboard.
    game.apply(state, "mum", { type: "start" }, ctx);
    expect(game.waitingOn(state)).toEqual(["mum"]);
    expect(state.racers.every((r) => r.at === 0 && r.riders.length === 0)).toBe(true);
  });

  it("passes the turn on when someone leaves mid-race, and stops when nobody's left", () => {
    const { state, ctx } = setup([
      ["ada", true],
      ["mum", false],
    ]);
    game.apply(state, "ada", { type: "leave" }, ctx);
    expect(game.waitingOn(state)).toEqual(["mum"]);
    expect(game.players(state)).toEqual(["mum"]);
    game.removePlayer(state, "mum", ctx);
    expect(state.phase).toBe("lobby");
    expect(game.waitingOn(state)).toEqual([]);
    game.checkInvariants!(state);
  });

  it("lets you switch between kid and grown-up only between races", () => {
    const { state, ctx } = setup([["ada", false]]);
    expect(() => game.apply(state, "ada", { type: "kid", kid: true }, ctx)).toThrow(/race to end/);
    expect(game.legalOps(state, "ada")).not.toContainEqual({ type: "kid", kid: true });
    game.apply(state, "bo", { type: "sit", seat: 2 }, ctx);
    expect(state.seats[2]!.kid).toBe(false);
    // Bo isn't in this race, so can change already.
    game.apply(state, "bo", { type: "kid", kid: true }, ctx);
    expect(() => game.apply(state, "bo", { type: "kid", kid: true }, ctx)).toThrow(/already a kid/);
  });

  it("keeps the track fair: every friend has two stops of their own and three stations", () => {
    expect(TRACK).toHaveLength(30);
    for (const r of RIDERS) {
      expect(TRACK.filter((s) => s.kind === "stop" && s.riders[0] === r)).toHaveLength(2);
      expect(TRACK.filter((s) => s.kind === "station" && s.riders.includes(r))).toHaveLength(3);
    }
  });

  it("has a bot that picks the friend hardest to find ahead (easy: anyone)", () => {
    const { state, ctx, roll } = setup([["bot", false]]);
    roll("bot", 5); // the chick or the frog
    // In the twelve stops ahead each has one (the Frog's at 11, the Chick's at 12): a tie, so either.
    const op = game.bot.play(game.view(state, "bot"), game.legalOps(state, "bot"), () => 0);
    expect(op).toMatchObject({ type: "pick" });
    game.apply(state, "bot", op!, ctx);
    expect(game.bot.play(game.view(state, "bot"), game.legalOps(state, "bot"), () => 0)).toEqual({ type: "roll" });
  });
});
