import type { GameUI } from "../../ui";
import type { GoView } from "../engine";
import { goMeta } from "../meta";
import { GoGame } from "./GoGame";
import { GoSetup } from "./GoSetup";

export const goUI: GameUI = {
  meta: goMeta,
  icon: "/icons/go.jpg",
  Game: GoGame,
  Setup: GoSetup,
  settings: ({ config, komi }: GoView) => [
    { label: "Board", value: `${config.size}×${config.size}` },
    config.minutes > 0 || config.periods > 0
      ? {
          label: "Clock",
          value: `${config.minutes} min + ${config.periods}×${config.seconds} s`,
          hint: `${config.minutes} minutes each, then ${config.periods} byo-yomi periods of ${config.seconds} seconds: move within a period to keep it. Run out of the last and you lose.`,
        }
      : { label: "Clock", value: "Off" },
    { label: "Komi", value: String(komi), hint: "Points White gets for moving second." },
  ],
};
