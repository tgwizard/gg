/** Every game's meta (name, rules…), without the engines. Keep in sync with registry.ts. */
import { battleshipMeta } from "./battleship/meta";
import { finnsISjonMeta } from "./finnsisjon/meta";
import { pokerMeta } from "./poker/meta";
import { ticketMeta } from "./ticket/meta";
import { ticTacToeMeta } from "./tictactoe/meta";
import type { GameMeta } from "./types";

export const gameMetas: GameMeta[] = [ticketMeta, pokerMeta, battleshipMeta, finnsISjonMeta, ticTacToeMeta];
