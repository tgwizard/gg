import type { GameUI } from "../../ui";
import type { ChessView } from "../engine";
import { chessMeta } from "../meta";
import { ChessGame } from "./ChessGame";
import { ChessSetup } from "./ChessSetup";

export const chessUI: GameUI = {
  meta: chessMeta,
  icon: "/icons/chess.jpg",
  Game: ChessGame,
  Setup: ChessSetup,
  settings: ({ config }: ChessView) => [
    config.minutes > 0
      ? { label: "Clock", value: `${config.minutes} min + ${config.increment} s`, hint: `${config.minutes} minutes each, plus ${config.increment} seconds for every move. Run out and you lose.` }
      : { label: "Clock", value: "Off" },
  ],
};
