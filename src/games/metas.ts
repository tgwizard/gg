/** Every game's meta (name, rules…), without the engines. Keep in sync with registry.ts. */
import { battleshipMeta } from "./battleship/meta";
import { cannonsMeta } from "./cannons/meta";
import { chessMeta } from "./chess/meta";
import { femKortMeta } from "./femkort/meta";
import { finnsISjonMeta } from "./finnsisjon/meta";
import { fourInARowMeta } from "./fourinarow/meta";
import { goMeta } from "./go/meta";
import { othelloMeta } from "./othello/meta";
import { pokerMeta } from "./poker/meta";
import { ticketMeta } from "./ticket/meta";
import { ticTacToeMeta } from "./tictactoe/meta";
import type { GameMeta } from "./types";

export const gameMetas: GameMeta[] = [ticketMeta, pokerMeta, chessMeta, othelloMeta, goMeta, fourInARowMeta, battleshipMeta, cannonsMeta, finnsISjonMeta, femKortMeta, ticTacToeMeta];
