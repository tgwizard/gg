import { turnTimerSetting } from "../../kit/ui/settings";
import type { GameUI } from "../../ui";
import type { PokerView } from "../engine";
import { pokerMeta } from "../meta";
import { PokerGame } from "./PokerGame";
import { PokerSetup } from "./PokerSetup";
import "./poker.css";

export const pokerUI: GameUI = {
  meta: pokerMeta,
  icon: "/icons/poker.jpg",
  Game: PokerGame,
  Setup: PokerSetup,
  settings: ({ config }: PokerView) => [
    { label: "Starting chips", value: config.startingStack.toLocaleString("en-US") },
    { label: "Blinds", value: `${config.smallBlind} / ${config.bigBlind}` },
    turnTimerSetting(config.turnSeconds, "Run out and you check if you can, fold if not."),
  ],
};
