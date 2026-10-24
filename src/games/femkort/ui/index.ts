import { turnTimerSetting } from "../../kit/ui/settings";
import type { GameUI } from "../../ui";
import type { FemView } from "../engine";
import { femKortMeta } from "../meta";
import { FemKortGame } from "./FemKortGame";
import { FemKortSetup } from "./FemKortSetup";

const onOff = (on: boolean) => (on ? "On" : "Off");

export const femKortUI: GameUI = {
  meta: femKortMeta,
  icon: "/icons/femkort.jpg",
  Game: FemKortGame,
  Setup: FemKortSetup,
  settings: ({ config }: FemView) => [
    { label: "Deals to win", value: String(config.dealsToWin), hint: "The first to win this many deals wins the game." },
    { label: "Överstick", value: onOff(config.mustBeat), hint: config.mustBeat ? "You must beat the best card of the suit led if you can." : "The older rule: just follow suit." },
    { label: "Two in a row wins", value: onOff(config.twoInARow) },
    { label: "Bättre kort", value: onOff(config.betterCards), hint: "Once a deal, the player on lead may ask for new cards; if everyone agrees, they're dealt again." },
    turnTimerSetting(config.turnSeconds, "Run out and a card is played for you, and you're marked away."),
  ],
};
