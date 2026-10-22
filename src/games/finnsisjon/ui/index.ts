import { turnTimerSetting } from "../../kit/ui/settings";
import type { GameUI } from "../../ui";
import type { FishView } from "../engine";
import { finnsISjonMeta } from "../meta";
import { FinnsISjonGame } from "./FinnsISjonGame";
import { FinnsISjonSetup } from "./FinnsISjonSetup";

export const finnsISjonUI: GameUI = {
  meta: finnsISjonMeta,
  icon: "/icons/fish.jpg",
  Game: FinnsISjonGame,
  Setup: FinnsISjonSetup,
  settings: ({ config }: FishView) => [turnTimerSetting(config.turnSeconds, "Run out and your turn is played for you, and you're marked away.")],
};
