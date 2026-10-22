import type { GameUI } from "../../ui";
import { pokerMeta } from "../meta";
import { PokerGame } from "./PokerGame";
import { PokerSetup } from "./PokerSetup";
import "./poker.css";

export const pokerUI: GameUI = { meta: pokerMeta, icon: "/icons/poker.jpg", Game: PokerGame, Setup: PokerSetup };
