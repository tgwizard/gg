/** Every game's scenarios for /try, by game id (see kit/scenario.ts). */
import { battleship } from "./battleship";
import { scenarios as battleshipScenarios } from "./battleship/scenarios";
import { chess } from "./chess";
import { scenarios as chessScenarios } from "./chess/scenarios";
import { finnsISjon } from "./finnsisjon";
import { scenarios as finnsISjonScenarios } from "./finnsisjon/scenarios";
import type { Scenario } from "./kit/scenario";
import { othello } from "./othello";
import { scenarios as othelloScenarios } from "./othello/scenarios";
import { poker } from "./poker";
import { scenarios as pokerScenarios } from "./poker/scenarios";
import { ticketToRide } from "./ticket";
import { scenarios as ticketScenarios } from "./ticket/scenarios";
import { ticTacToe } from "./tictactoe";
import { scenarios as ticTacToeScenarios } from "./tictactoe/scenarios";

export const scenarios: Record<string, Scenario[]> = {
  [ticketToRide.meta.id]: ticketScenarios,
  [poker.meta.id]: pokerScenarios,
  [chess.meta.id]: chessScenarios,
  [othello.meta.id]: othelloScenarios,
  [battleship.meta.id]: battleshipScenarios,
  [finnsISjon.meta.id]: finnsISjonScenarios,
  [ticTacToe.meta.id]: ticTacToeScenarios,
};
