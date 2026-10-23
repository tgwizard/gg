/** Client-side game registry. Add new games here (and in registry.ts). */
import { battleshipUI } from "./battleship/ui";
import { chessUI } from "./chess/ui";
import { finnsISjonUI } from "./finnsisjon/ui";
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
  [battleshipUI.meta.id]: battleshipUI,
  [finnsISjonUI.meta.id]: finnsISjonUI,
  [ticTacToeUI.meta.id]: ticTacToeUI,
};
