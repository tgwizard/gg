/**
 * The built-in bots' two strengths: in the games where it's quick to tell, hard beats easy
 * by a clear margin, sides swapping every game.
 */
import { describe, expect, it } from "vitest";
import { isLobbyOp } from "./kit/lobby";
import { seededRandomInt } from "./kit/testing";
import { games } from "./registry";
import type { BotStrength, GameContext } from "./types";

const GAMES = 12;

function match(gameId: string, seed: number) {
  const def = games[gameId]!;
  const rand = seededRandomInt(seed);
  let now = 0;
  const ctx = (): GameContext => ({ now, randomInt: rand, nameOf: (id) => id, announce: () => {} });
  const strength: Record<string, BotStrength> = { hard: "hard", easy: "easy" };
  const state = def.create(def.configSchema.parse({ turnSeconds: 0, minutes: 0 }), ctx());
  def.apply(state, "hard", { type: "sit", seat: 0 }, ctx());
  def.apply(state, "easy", { type: "sit", seat: 1 }, ctx());
  for (let played = 0, steps = 0; played < GAMES && steps < 20_000; steps++) {
    const [who] = def.waitingOn(state);
    if (who) {
      const ops = def.legalOps(state, who).filter((op) => !isLobbyOp(op) && (op as { type: string }).type !== "resign" && (op as { type: string }).type !== "offerDraw");
      def.apply(state, who, def.bot.play(def.view(state, who), ops, rand, { strength: strength[who] }), ctx());
    } else {
      // A game over: play again, by the button or on the game's own timer.
      played++;
      const rematch = def.legalOps(state, "hard").some((op) => (op as { type: string }).type === "rematch");
      if (rematch) def.apply(state, "hard", { type: "rematch" }, ctx());
      else if (def.nextDeadline?.(state) != null) {
        now = def.nextDeadline(state)!;
        def.onDeadline!(state, ctx());
      } else break;
    }
  }
  const seats = (state as { seats: { playerId: string; wins: number }[] }).seats;
  return Object.fromEntries(seats.map((s) => [s.playerId, s.wins]));
}

describe("built-in bots, easy and hard", () => {
  for (const gameId of ["tictactoe", "chess", "othello", "luffarschack"]) {
    it(`${gameId}: hard beats easy`, () => {
      const wins = match(gameId, 1);
      expect(wins.hard!).toBeGreaterThan(wins.easy! * 2 + 1);
    }, 60_000);
  }
});
