import type { GameUI } from "../../ui";
import type { FourView } from "../engine";
import { fourInARowMeta } from "../meta";
import { FourGame } from "./FourGame";
import { FourSetup } from "./FourSetup";

export const fourInARowUI: GameUI = {
  meta: fourInARowMeta,
  icon: "/icons/fourinarow.jpg",
  Game: FourGame,
  Setup: FourSetup,
  settings: ({ config, size }: FourView) => [
    { label: "Board", value: `${size.columns}×${size.rows}`, hint: `${size.columns} columns, ${size.rows} rows.` },
    config.opener === "loser" ? { label: "Who starts", value: "The loser", hint: "The loser of each game starts the next; after a draw, the other player does." } : { label: "Who starts", value: "Take turns" },
    config.minutes > 0
      ? { label: "Clock", value: `${config.minutes} min + ${config.increment} s`, hint: `${config.minutes} minutes each, plus ${config.increment} seconds for every move. Run out and you lose.` }
      : { label: "Clock", value: "Off" },
  ],
};
