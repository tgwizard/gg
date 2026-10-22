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

export interface GameUI {
  meta: GameMeta;
  /** Square artwork for pickers and headers (a path under /public). */
  icon: string;
  Game: ComponentType<GameUIProps<any, any>>;
  Setup?: ComponentType<GameSetupProps<any>>;
}
