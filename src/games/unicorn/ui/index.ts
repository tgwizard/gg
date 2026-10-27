import type { GameUI } from "../../ui";
import type { UnicornView } from "../engine";
import { unicornMeta } from "../meta";
import { UnicornGame } from "./UnicornGame";
import { UnicornSetup } from "./UnicornSetup";

export const unicornUI: GameUI = {
  meta: unicornMeta,
  icon: "/icons/unicorn.svg",
  Game: UnicornGame,
  Setup: UnicornSetup,
  settings: ({ config }: UnicornView) => [{ label: "Rainbow power", value: `fills at ${config.rainbowAt}`, hint: "Every roll adds its number; full, every kid gets a rainbow roll." }],
};
