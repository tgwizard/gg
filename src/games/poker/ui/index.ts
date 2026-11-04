import { turnTimerSetting } from "../../kit/ui/settings";
import type { GameUI } from "../../ui";
import type { PokerView } from "../engine";
import { pokerMeta } from "../meta";
import { PokerGame } from "./PokerGame";
import { PokerSetup } from "./PokerSetup";
import { HandRankings } from "./HandRankings";
import "./poker.css";

export const pokerUI: GameUI = {
  meta: pokerMeta,
  icon: "/icons/poker.jpg",
  Game: PokerGame,
  Setup: PokerSetup,
  help: HandRankings,
  settings: ({ config }: PokerView) => [
    { label: "Starting chips", value: config.startingStack.toLocaleString("en-US") },
    {
      label: "Blinds",
      value: `${config.smallBlind} / ${config.bigBlind}`,
      hint: config.blindsUpEvery ? `Up a level every ${config.blindsUpEvery} hands, doubling every two levels.` : "They stay the same all game.",
    },
    { label: "Rebuys", value: config.rebuys ? "Yes" : "No", hint: config.rebuys ? "Out of chips, buy back in for the starting chips." : "Once you're out, you're out." },
    turnTimerSetting(config.turnSeconds, "Run out and you check if you can, fold if not."),
  ],
};
