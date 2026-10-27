import { type Scenario, scenarioContext } from "../kit/scenario";
import type { GameContext } from "../types";
import type { ChessState } from "./engine";
import { chess as game } from "./index";

/** A first game with you as White (seat 0), after `moves` (UCI, alternating from White). */
function played(players: string[], ctx: GameContext, moves: string[]): ChessState {
  const c = scenarioContext(ctx);
  const [you, bot] = players as [string, string];
  const state = game.create(game.configSchema.parse({}), c);
  game.apply(state, you, { type: "sit", seat: 0 }, c);
  game.apply(state, bot, { type: "sit", seat: 1 }, c);
  moves.forEach((move, i) => game.apply(state, i % 2 ? bot : you, { type: "move", move }, c));
  return state;
}

/** 1. e4 e5 2. Bc4 Nc6 3. Qh5 Nf6??, and Qxf7 is mate. */
const SCHOLARS = ["e2e4", "e7e5", "f1c4", "b8c6", "d1h5", "g8f6"];

export const scenarios: Scenario<ChessState>[] = [
  {
    id: "mate-in-one",
    name: "Mate in one",
    description: "Scholar's mate is on: your move as White, and Qxf7 wins.",
    bots: 1,
    build: (players, ctx) => played(players, ctx, SCHOLARS),
  },
  {
    id: "checkmate",
    name: "You won by checkmate",
    description: "Game over: you just mated with Qxf7. Play again is offered.",
    bots: 1,
    build: (players, ctx) => played(players, ctx, [...SCHOLARS, "h5f7"]),
  },
  {
    id: "castling",
    name: "Castling",
    description: "Your move as White, and your king can castle either way: pick it up.",
    bots: 1,
    // 1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 4. d3 d6 5. Be3 Be6 6. Nc3 Nf6 7. Qd2 Qd7
    build: (players, ctx) => played(players, ctx, ["e2e4", "e7e5", "g1f3", "b8c6", "f1c4", "f8c5", "d2d3", "d7d6", "c1e3", "c8e6", "b1c3", "g8f6", "d1d2", "d8d7"]),
  },
  {
    id: "promotion",
    name: "Promotion",
    description: "Your pawn on b7 can promote on a8, b8 or c8: pick the piece.",
    bots: 1,
    // 1. e4 d5 2. exd5 c6 3. dxc6 Nf6 4. cxb7 Nbd7
    build: (players, ctx) => played(players, ctx, ["e2e4", "d7d5", "e4d5", "c7c6", "d5c6", "g8f6", "c6b7", "b8d7"]),
  },
];
