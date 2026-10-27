import { type Scenario, scenarioContext } from "../kit/scenario";
import type { GameContext } from "../types";
import { RIDERS, type Rider, type UnicornState } from "./engine";
import { unicorn as game } from "./index";

/** You (a kid) and the bots (grown-ups) in a race that's well on, with your turn next. */
function raceOn(players: string[], ctx: GameContext, mine: Rider[], at: number): UnicornState {
  const c = scenarioContext(ctx);
  const state = game.create(game.configSchema.parse({}), c);
  players.forEach((id, seat) => game.apply(state, id, { type: "sit", seat, kid: seat === 0 }, c));
  game.apply(state, players[0]!, { type: "start" }, c);
  const theirs: Rider[][] = [
    ["fox", "frog", "whale", "chick"],
    ["ladybug", "octopus", "chick"],
  ];
  state.racers.forEach((r, i) => {
    r.riders = i === 0 ? mine : theirs[(i - 1) % theirs.length]!;
    r.at = i === 0 ? at : (7 + i * 9) % 30;
  });
  state.turn = state.racers[0]!.seat;
  state.rolls = 24;
  return state;
}

/** Plays on from `state`, everyone taking the first friend offered, until `done`; the bots never get their sixth. */
function playOn(state: UnicornState, ctx: GameContext, done: (s: UnicornState) => boolean) {
  const c = scenarioContext(ctx);
  for (let i = 0; i < 400 && state.phase === "playing" && !done(state); i++) {
    const r = state.racers.find((x) => x.seat === state.turn)!;
    if (r !== state.racers[0] && state.stage === "pick" && r.riders.length === RIDERS.length - 1) {
      // Keep the bots off their sixth friend: pretend they didn't stop here.
      state.stage = "roll";
      state.choice = null;
      state.turn = state.racers[(state.racers.indexOf(r) + 1) % state.racers.length]!.seat;
      continue;
    }
    game.apply(state, r.playerId, state.stage === "pick" ? { type: "pick", rider: state.choice![0]! } : { type: "roll" }, c);
  }
  return state;
}

export const scenarios: Scenario<UnicornState>[] = [
  {
    id: "last-friend",
    name: "One friend to go",
    description: "You have five friends; the Octopus is the last. Its stops are 1 and 5 ahead.",
    bots: 2,
    build: (players, ctx) => raceOn(players, ctx, ["ladybug", "fox", "chick", "frog", "whale"], 24),
  },
  {
    id: "rainbow",
    name: "Rainbow nearly full",
    description: "You're a kid, and one more roll fills the rainbow: you get a rainbow roll straight after your move.",
    bots: 2,
    build(players, ctx) {
      const state = raceOn(players, ctx, ["fox", "frog"], 3);
      state.rainbow = state.config.rainbowAt - 1;
      return state;
    },
  },
  {
    id: "bridge",
    name: "Over the rainbow bridge",
    description: "You have all six friends and you're just before the start: the bridge to the castle is open.",
    bots: 2,
    build: (players, ctx) => raceOn(players, ctx, [...RIDERS], 28),
  },
  {
    id: "won",
    name: "You won",
    description: "Race over: you reached the castle with all six friends.",
    bots: 2,
    build: (players, ctx) => playOn(raceOn(players, ctx, [...RIDERS], 28), ctx, () => false),
  },
];
