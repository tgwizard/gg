import type { Policy, Scenario } from "../kit/scenario";
import { scenarioContext } from "../kit/scenario";
import { setTimer } from "../kit/timers";
import type { GameContext } from "../types";
import { type CannonsConfig, type CannonsState, type CannonsView, onDeadline } from "./engine";
import { cannons as game } from "./index";
import type { CannonsOp } from "./index";
import { flight } from "./physics";

type Fire = Extract<CannonsOp, { type: "fire" }>;

/** A game with you in seat 0 and the bots after, as set up by `config`. */
function seated(players: string[], ctx: GameContext, config: Partial<CannonsConfig>): CannonsState {
  const state = game.create(game.configSchema.parse({ players: players.length, ...config }), ctx);
  players.forEach((id, seat) => game.apply(state, id, { type: "sit", seat }, ctx));
  return state;
}

/**
 * Shots until `done`: whoever's turn it is fires by their policy (or the built-in bot's
 * aim), and each ball lands before the next. The clock moves on with the flights, and the
 * turn clock is wound back to full at the end.
 */
function play(state: CannonsState, ctx: GameContext, done: (s: CannonsState) => boolean, policies: Record<string, Policy<CannonsView, CannonsOp>> = {}, seed = 1) {
  const rand = scenarioContext(ctx, seed + 100).randomInt;
  let now = ctx.now;
  const at = (): GameContext => ({ ...ctx, now });
  for (let step = 0; step < 200 && !done(state); step++) {
    if (state.phase === "flying") {
      now = state.timers.land!;
      onDeadline(state, at());
      continue;
    }
    const actor = game.waitingOn(state)[0];
    if (!actor) throw new Error("the game isn't waiting on anyone");
    const ops = game.legalOps(state, actor).filter((op) => op.type === "fire");
    const op = (policies[actor] ?? game.bot.easy)(game.view(state, actor), ops, rand, { quick: true });
    if (!op) throw new Error(`${actor} has no move`);
    game.apply(state, actor, op, at());
  }
  if (!done(state)) throw new Error("didn't get there");
  if (state.phase === "aiming" && state.config.turnSeconds > 0) setTimer(state.timers, "turn", ctx.now + state.config.turnSeconds * 1000);
}

/** What a shot from the cannon whose turn it is would do, without firing it. */
function tryShot(state: CannonsState, angle: number, power: number) {
  return flight({ terrain: state.terrain, cannons: state.cannons, shooter: state.turn, angle, power, wind: state.wind });
}

/** Aims like the built-in bot, but shifted so it lands `by` points of power off, and never hits anyone. */
function missing(by: number): Policy<CannonsView, CannonsOp> {
  return (view, ops, rand) => {
    const aim = game.bot.easy(view, ops, rand) as Fire;
    for (let k = 0; k < 20; k++) {
      const power = Math.max(5, Math.min(100, aim.power + by + (by > 0 ? k : -k)));
      const me = view.cannons.findIndex((c) => c.playerId === view.turn);
      const f = flight({ terrain: view.terrain, cannons: view.cannons, shooter: me, angle: aim.angle, power, wind: view.wind });
      if (f.hit === null) return { ...aim, power };
    }
    return aim;
  };
}

const yourTurn = (you: string) => (s: CannonsState) => s.phase === "aiming" && game.waitingOn(s)[0] === you;
const shotsBy = (s: CannonsState, id: string) => s.shots.filter((x) => x.by === id).length;

/** The first seed whose game `build` makes; scenarios want a nice position, not just any. */
function firstThat(ctx: GameContext, build: (c: GameContext, seed: number) => CannonsState | null): CannonsState {
  for (let seed = 1; seed <= 60; seed++) {
    const state = build(scenarioContext(ctx, seed), seed);
    if (state) return state;
  }
  throw new Error("no seed gets there");
}

export const scenarios: Scenario<CannonsState>[] = [
  {
    id: "first-shot",
    name: "Your first shot",
    description: "A new game on a hilly field, with a light wind. You fire first.",
    bots: 1,
    build: (players, ctx) => seated(players, scenarioContext(ctx), {}),
  },
  {
    id: "mid-game",
    name: "Craters and trails",
    description: "A few shots in: craters in the hills, everyone's last shot still faintly in the air, and it's your turn.",
    bots: 1,
    build(players, ctx) {
      const [you, bot] = players as [string, string];
      return firstThat(ctx, (c, seed) => {
        const state = seated(players, c, {});
        play(state, c, (s) => yourTurn(you)(s) && shotsBy(s, you) >= 3, { [you]: missing(seed % 2 ? -6 : 7), [bot]: missing(seed % 2 ? 8 : -9) }, seed);
        return state.shots.every((s) => s.end === "ground") ? state : null;
      });
    },
  },
  {
    id: "mountains",
    name: "Over the mountain",
    description: "A mountain between you and a strong wind: lob it over, and mind which way it's blowing.",
    bots: 1,
    build: (players, ctx) =>
      firstThat(ctx, (c) => {
        const state = seated(players, c, { terrain: "mountains", wind: "strong" });
        return Math.abs(state.wind) >= 5 ? state : null;
      }),
  },
  {
    id: "one-more",
    name: "One more nudge",
    description: "Your last shot landed just short, and the wind's the same as then. A touch more power should do it.",
    bots: 1,
    build(players, ctx) {
      const [you, bot] = players as [string, string];
      return firstThat(ctx, (c) => {
        const state = seated(players, c, {});
        // Your shot: the first power at the bot's angle that lands 15–40 m short.
        const aim = game.bot.easy(game.view(state, you), game.legalOps(state, you), c.randomInt) as Fire;
        const target = state.cannons.find((x) => x.playerId === bot)!;
        const me = state.cannons.find((x) => x.playerId === you)!;
        const side = target.x > me.x ? 1 : -1;
        let power = 0;
        for (let p = 100; p >= 20 && !power; p--) {
          const f = tryShot(state, aim.angle, p);
          const short = (target.x - f.x) * side;
          if (f.end === "ground" && short >= 15 && short <= 40) power = p;
        }
        if (!power) return null;
        play(state, c, (s) => yourTurn(you)(s) && shotsBy(s, you) >= 1, { [you]: () => ({ type: "fire", angle: aim.angle, power }), [bot]: missing(-12) });
        state.wind = state.shots.findLast((s) => s.by === you)!.wind;
        // A few points more must hit.
        const theirs = state.cannons.findIndex((x) => x.playerId === bot);
        const hits = [1, 2, 3, 4].some((d) => tryShot(state, aim.angle, power + d).hit === theirs);
        return hits ? state : null;
      });
    },
  },
  {
    id: "free-for-all",
    name: "Four cannons",
    description: "Free for all with three bots: last cannon standing wins. A round's been fired and it's your turn.",
    bots: 3,
    build(players, ctx) {
      const you = players[0]!;
      return firstThat(ctx, (c, seed) => {
        const state = seated(players, c, {});
        const policies = Object.fromEntries(players.map((id, i) => [id, missing(i % 2 ? 7 : -8)]));
        play(state, c, (s) => yourTurn(you)(s) && s.fired >= 3, policies, seed);
        return state.cannons.every((x) => x.alive) ? state : null;
      });
    },
  },
  {
    id: "game-over",
    name: "You won",
    description: "Game over: your ball knocked out the other cannon. Play again is offered.",
    bots: 1,
    build(players, ctx) {
      const [you, bot] = players as [string, string];
      return firstThat(ctx, (c) => {
        const state = seated(players, c, {});
        play(state, c, (s) => yourTurn(you)(s) && shotsBy(s, you) >= 2, { [you]: missing(-9), [bot]: missing(10) });
        for (let up = 40; up <= 70; up++) {
          for (let power = 20; power <= 100; power++) {
            const angle = state.cannons.find((x) => x.playerId === bot)!.x > state.cannons[state.turn]!.x ? up : 180 - up;
            if (tryShot(state, angle, power).hit === state.cannons.findIndex((x) => x.playerId === bot)) {
              play(state, c, (s) => s.phase === "over", { [you]: () => ({ type: "fire", angle, power }) });
              return state;
            }
          }
        }
        return null;
      });
    },
  },
];
