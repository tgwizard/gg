/** Client-side contract for a game's UI. Kept separate from the server definition. */
import type { ComponentType } from "react";
import type { GameSnapshot, Member } from "../shared/protocol";
import type { GameMeta } from "./types";

export interface GameUIProps<View = unknown, Op = unknown> {
  view: View;
  snapshot: GameSnapshot<View>;
  me: string;
  members: Map<string, Member>;
  connected: boolean;
  /** Resolves true when the server accepted the op; failures are surfaced to the player for you. */
  sendOp(op: Op): Promise<boolean>;
  /** Server clock, for deadlines. */
  serverNow: number;
}

export interface GameSetupProps<Config = unknown> {
  busy: boolean;
  disabled: boolean;
  onStart(config: Config): void;
}

/** One line of a game's settings, as shown under the settings icon. */
export interface GameSetting {
  label: string;
  value: string;
  hint?: string;
}

export interface GameUI {
  meta: GameMeta;
  /** Square artwork for pickers and headers (a path under /public). */
  icon: string;
  Game: ComponentType<GameUIProps<any, any>>;
  Setup?: ComponentType<GameSetupProps<any>>;
  /** The running game's settings (from its view), for anyone to look up. */
  settings?(view: any): GameSetting[];
  /** No chime when it becomes your turn: the game's own sounds already say so. */
  quietTurn?: boolean;
}
