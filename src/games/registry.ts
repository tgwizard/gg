/** Server-side game registry. Add new games here (and in ui-registry.ts). */
import { poker } from "./poker";
import { ticTacToe } from "./tictactoe";
import type { AnyGameDefinition } from "./types";

export const games: Record<string, AnyGameDefinition> = {
  [poker.meta.id]: poker,
  [ticTacToe.meta.id]: ticTacToe,
};
