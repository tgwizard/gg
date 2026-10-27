/** Every game's scenarios for /try, by game id (see kit/scenario.ts). */
import { battleship } from "./battleship";
import { scenarios as battleshipScenarios } from "./battleship/scenarios";
import { cannons } from "./cannons";
import { scenarios as cannonsScenarios } from "./cannons/scenarios";
import { chess } from "./chess";
import { scenarios as chessScenarios } from "./chess/scenarios";
import { femKort } from "./femkort";
import { scenarios as femKortScenarios } from "./femkort/scenarios";
import { finnsISjon } from "./finnsisjon";
import { scenarios as finnsISjonScenarios } from "./finnsisjon/scenarios";
import { fourInARow } from "./fourinarow";
import { scenarios as fourInARowScenarios } from "./fourinarow/scenarios";
import { go } from "./go";
import { scenarios as goScenarios } from "./go/scenarios";
import type { Scenario } from "./kit/scenario";
import { luffarschack } from "./luffarschack";
import { scenarios as luffarschackScenarios } from "./luffarschack/scenarios";
import { othello } from "./othello";
import { scenarios as othelloScenarios } from "./othello/scenarios";
import { poker } from "./poker";
import { scenarios as pokerScenarios } from "./poker/scenarios";
import { ticketToRide } from "./ticket";
import { scenarios as ticketScenarios } from "./ticket/scenarios";
import { ticTacToe } from "./tictactoe";
import { scenarios as ticTacToeScenarios } from "./tictactoe/scenarios";
import { unicorn } from "./unicorn";
import { scenarios as unicornScenarios } from "./unicorn/scenarios";

export const scenarios: Record<string, Scenario[]> = {
  [ticketToRide.meta.id]: ticketScenarios,
  [poker.meta.id]: pokerScenarios,
  [chess.meta.id]: chessScenarios,
  [othello.meta.id]: othelloScenarios,
  [go.meta.id]: goScenarios,
  [fourInARow.meta.id]: fourInARowScenarios,
  [luffarschack.meta.id]: luffarschackScenarios,
  [battleship.meta.id]: battleshipScenarios,
  [cannons.meta.id]: cannonsScenarios,
  [finnsISjon.meta.id]: finnsISjonScenarios,
  [femKort.meta.id]: femKortScenarios,
  [ticTacToe.meta.id]: ticTacToeScenarios,
  [unicorn.meta.id]: unicornScenarios,
};
