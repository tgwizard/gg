/** Client-side game registry. Add new games here (and in registry.ts). */
import { battleshipUI } from "./battleship/ui";
import { finnsISjonUI } from "./finnsisjon/ui";
import { pokerUI } from "./poker/ui";
import { ticTacToeUI } from "./tictactoe/ui";
import type { GameUI } from "./ui";

export const gameUIs: Record<string, GameUI> = {
  [pokerUI.meta.id]: pokerUI,
  [ticTacToeUI.meta.id]: ticTacToeUI,
  [finnsISjonUI.meta.id]: finnsISjonUI,
  [battleshipUI.meta.id]: battleshipUI,
};
