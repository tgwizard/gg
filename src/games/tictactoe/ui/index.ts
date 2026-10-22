import { turnTimerSetting } from "../../kit/ui/settings";
import type { GameUI } from "../../ui";
import type { TttView } from "../index";
import { ticTacToeMeta } from "../meta";
import { TicTacToeGame } from "./TicTacToeGame";
import { TicTacToeSetup } from "./TicTacToeSetup";

export const ticTacToeUI: GameUI = {
  meta: ticTacToeMeta,
  icon: "/icons/tictactoe.jpg",
  Game: TicTacToeGame,
  Setup: TicTacToeSetup,
  settings: ({ config }: TttView) => [turnTimerSetting(config.turnSeconds, "Run out and you lose the round.")],
};
