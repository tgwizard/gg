import type { GameUI } from "../../ui";
import { pokerMeta } from "../meta";
import { PokerGame } from "./PokerGame";
import { PokerSetup } from "./PokerSetup";
import "./poker.css";

export const pokerUI: GameUI = { meta: pokerMeta, Game: PokerGame, Setup: PokerSetup };
