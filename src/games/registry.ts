/** Server-side game registry. Add new games here (and in ui-registry.ts). */
import { battleship } from "./battleship";
import { cannons } from "./cannons";
import { chess } from "./chess";
import { femKort } from "./femkort";
import { finnsISjon } from "./finnsisjon";
import { fourInARow } from "./fourinarow";
import { go } from "./go";
import { othello } from "./othello";
import { poker } from "./poker";
import { ticketToRide } from "./ticket";
import { ticTacToe } from "./tictactoe";
import type { AnyGameDefinition } from "./types";

export const games: Record<string, AnyGameDefinition> = {
  [ticketToRide.meta.id]: ticketToRide,
  [poker.meta.id]: poker,
  [chess.meta.id]: chess,
  [othello.meta.id]: othello,
  [go.meta.id]: go,
  [fourInARow.meta.id]: fourInARow,
  [battleship.meta.id]: battleship,
  [cannons.meta.id]: cannons,
  [finnsISjon.meta.id]: finnsISjon,
  [femKort.meta.id]: femKort,
  [ticTacToe.meta.id]: ticTacToe,
};
