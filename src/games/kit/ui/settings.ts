import type { GameSetting } from "../../ui";

/** The usual "turn timer" line: "45 seconds" or "Off". */
export function turnTimerSetting(seconds: number, hint?: string): GameSetting {
  return { label: "Turn timer", value: seconds > 0 ? `${seconds} seconds` : "Off", hint };
}
