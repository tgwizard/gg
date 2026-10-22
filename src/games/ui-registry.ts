/** Client-side game registry. Add new games here (and in registry.ts). */
import { pokerUI } from "./poker/ui";
import type { GameUI } from "./ui";

export const gameUIs: Record<string, GameUI> = {
  [pokerUI.meta.id]: pokerUI,
};
