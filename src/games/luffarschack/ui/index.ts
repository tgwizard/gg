import { turnTimerSetting } from "../../kit/ui/settings";
import type { GameUI } from "../../ui";
import type { LuffaView } from "../engine";
import { luffarschackMeta } from "../meta";
import { LuffaGame } from "./LuffaGame";
import { LuffaSetup } from "./LuffaSetup";

export const luffarschackUI: GameUI = {
  meta: luffarschackMeta,
  icon: "/icons/luffarschack.jpg",
  Game: LuffaGame,
  Setup: LuffaSetup,
  settings: ({ config, size }: LuffaView) => [
    { label: "Sheet", value: `${size}×${size}`, hint: `${size} squares across and down.` },
    turnTimerSetting(config.turnSeconds, config.turnSeconds > 0 ? "For each mark. Run out and you lose." : undefined),
  ],
};
