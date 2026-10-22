import { turnTimerSetting } from "../../kit/ui/settings";
import type { GameUI } from "../../ui";
import type { BsView } from "../engine";
import { battleshipMeta } from "../meta";
import { BattleshipGame } from "./BattleshipGame";
import { BattleshipSetup } from "./BattleshipSetup";

const yesNo = (b: boolean) => (b ? "Yes" : "No");

export const battleshipUI: GameUI = {
  meta: battleshipMeta,
  icon: "/icons/battleship.jpg",
  Game: BattleshipGame,
  Setup: BattleshipSetup,
  settings: ({ config }: BsView) => [
    turnTimerSetting(config.turnSeconds, "Run out and a random shot is fired for you. Three in a row and you forfeit."),
    {
      label: "Placement timer",
      value: config.placeSeconds > 0 ? `${config.placeSeconds} seconds` : "Off",
      hint: "Run out and the rest of your fleet is placed at random.",
    },
    { label: "Ships may touch", value: yesNo(config.shipsMayTouch), hint: "They can never overlap." },
    { label: "A hit earns another shot", value: yesNo(config.hitShootsAgain), hint: config.hitShootsAgain ? undefined : "Shots strictly alternate." },
  ],
};
