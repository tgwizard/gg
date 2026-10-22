import type { GameUI } from "../../ui";
import { finnsISjonMeta } from "../meta";
import { FinnsISjonGame } from "./FinnsISjonGame";
import { FinnsISjonSetup } from "./FinnsISjonSetup";

export const finnsISjonUI: GameUI = { meta: finnsISjonMeta, icon: "/icons/fish.jpg", Game: FinnsISjonGame, Setup: FinnsISjonSetup };
