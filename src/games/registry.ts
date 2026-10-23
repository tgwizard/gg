/** Server-side game registry. Add new games here (and in ui-registry.ts). */
import { battleship } from "./battleship";
import { chess } from "./chess";
import { finnsISjon } from "./finnsisjon";
import { poker } from "./poker";
import { ticketToRide } from "./ticket";
import { ticTacToe } from "./tictactoe";
import type { AnyGameDefinition } from "./types";

export const games: Record<string, AnyGameDefinition> = {
  [ticketToRide.meta.id]: ticketToRide,
  [poker.meta.id]: poker,
  [chess.meta.id]: chess,
  [battleship.meta.id]: battleship,
  [finnsISjon.meta.id]: finnsISjon,
  [ticTacToe.meta.id]: ticTacToe,
};
