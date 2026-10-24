/** Client-side game registry. Add new games here (and in registry.ts). */
import { battleshipUI } from "./battleship/ui";
import { cannonsUI } from "./cannons/ui";
import { chessUI } from "./chess/ui";
import { femKortUI } from "./femkort/ui";
import { finnsISjonUI } from "./finnsisjon/ui";
import { fourInARowUI } from "./fourinarow/ui";
import { goUI } from "./go/ui";
import { luffarschackUI } from "./luffarschack/ui";
import { othelloUI } from "./othello/ui";
import { pokerUI } from "./poker/ui";
import { ticketUI } from "./ticket/ui";
import { ticTacToeUI } from "./tictactoe/ui";
import type { GameUI } from "./ui";

export const gameUIs: Record<string, GameUI> = {
  [ticketUI.meta.id]: ticketUI,
  [pokerUI.meta.id]: pokerUI,
  [chessUI.meta.id]: chessUI,
  [othelloUI.meta.id]: othelloUI,
  [goUI.meta.id]: goUI,
  [fourInARowUI.meta.id]: fourInARowUI,
  [luffarschackUI.meta.id]: luffarschackUI,
  [battleshipUI.meta.id]: battleshipUI,
  [cannonsUI.meta.id]: cannonsUI,
  [finnsISjonUI.meta.id]: finnsISjonUI,
  [femKortUI.meta.id]: femKortUI,
  [ticTacToeUI.meta.id]: ticTacToeUI,
};
