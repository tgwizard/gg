import type { GameUI } from "../../ui";
import type { OthelloView } from "../engine";
import { othelloMeta } from "../meta";
import { OthelloGame } from "./OthelloGame";
import { OthelloSetup } from "./OthelloSetup";

export const othelloUI: GameUI = {
  meta: othelloMeta,
  icon: "/icons/othello.jpg",
  Game: OthelloGame,
  Setup: OthelloSetup,
  settings: ({ config }: OthelloView) => [
    config.minutes > 0
      ? { label: "Clock", value: `${config.minutes} min + ${config.increment} s`, hint: `${config.minutes} minutes each, plus ${config.increment} seconds for every move. Run out and you lose.` }
      : { label: "Clock", value: "Off" },
  ],
};
