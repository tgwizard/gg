import { createContext, type CSSProperties, type ReactNode, useContext } from "react";
import { COLOR_COUNT, PLAYER_COLORS } from "../shared/colors";

/** CSS variables for a player color: --pc (the color) and --pc-ink (text on it). */
export function playerStyle(color: number): CSSProperties {
  const c = PLAYER_COLORS[color] ?? PLAYER_COLORS[0]!;
  return { "--pc": c.hex, "--pc-ink": c.ink } as CSSProperties;
}

const Colors = createContext<ReadonlyMap<string, number>>(new Map());

/** Makes each room member's color available to everything below (chat, games). */
export function PlayerColorsProvider({ colors, children }: { colors: ReadonlyMap<string, number>; children: ReactNode }) {
  return <Colors.Provider value={colors}>{children}</Colors.Provider>;
}

/** Look up players' colors; someone who's left the room gets a stable stand-in. */
export function usePlayerColors(): (playerId: string) => number {
  const colors = useContext(Colors);
  return (id) => colors.get(id) ?? fallback(id);
}

function fallback(id: string): number {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) % COLOR_COUNT;
  return h;
}

/** A round badge with someone's initial in their color, and optionally an online dot. */
export function Avatar({ name, color, online, size = "md" }: { name: string; color: number; online?: boolean; size?: "sm" | "md" | "lg" }) {
  return (
    <span className={`avatar ${size}`} style={playerStyle(color)} aria-hidden>
      {name.trim().charAt(0).toUpperCase() || "?"}
      {online !== undefined && <span className={`avatar-status ${online ? "on" : "off"}`} title={online ? "Online" : "Away"} />}
    </span>
  );
}

/** A name in its owner's color. */
export function PlayerName({ name, color, className }: { name: string; color: number; className?: string }) {
  return (
    <span className={`name ${className ?? ""}`} style={playerStyle(color)}>
      {name}
    </span>
  );
}
