import type { GameUI } from "../../ui";
import { ticTacToeMeta } from "../meta";
import { TicTacToeGame } from "./TicTacToeGame";
import { TicTacToeSetup } from "./TicTacToeSetup";

export const ticTacToeUI: GameUI = { meta: ticTacToeMeta, icon: "emblem-tictactoe", Game: TicTacToeGame, Setup: TicTacToeSetup };
