import { turnTimerSetting } from "../../kit/ui/settings";
import type { GameUI } from "../../ui";
import { type CannonsView, MAX_TIMEOUTS, WIND_MAX } from "../engine";
import { cannonsMeta } from "../meta";
import { CannonsGame } from "./CannonsGame";
import { CannonsSetup } from "./CannonsSetup";

const LANDSCAPE = { gentle: "Gentle", hilly: "Hilly", mountains: "Mountains" } as const;
const WIND = { none: "No wind", light: "Light", strong: "Strong" } as const;

export const cannonsUI: GameUI = {
  meta: cannonsMeta,
  icon: "/icons/cannons.jpg",
  Game: CannonsGame,
  Setup: CannonsSetup,
  settings: ({ config }: CannonsView) => [
    { label: "Players", value: String(config.players), hint: config.players > 2 ? "Free for all: the last cannon standing wins." : undefined },
    { label: "Landscape", value: LANDSCAPE[config.terrain], hint: "A new field every game." },
    { label: "Wind", value: WIND[config.wind], hint: config.wind === "none" ? undefined : `Up to ${WIND_MAX[config.wind]} either way, changing every turn.` },
    turnTimerSetting(config.turnSeconds, `Run out and your last aim is fired for you. ${MAX_TIMEOUTS} in a row and your cannon is out.`),
  ],
};
