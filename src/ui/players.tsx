import { createContext, type CSSProperties, type ReactNode, useContext, useMemo } from "react";
import { COLOR_COUNT, PLAYER_COLORS } from "../shared/colors";

/** CSS variables for a player color: --pc (the color) and --pc-ink (text on it). */
export function playerStyle(color: number): CSSProperties {
  const c = PLAYER_COLORS[color] ?? PLAYER_COLORS[0]!;
  return { "--pc": c.hex, "--pc-ink": c.ink } as CSSProperties;
}

const Players = createContext<{ colors: ReadonlyMap<string, number>; bots: ReadonlySet<string> }>({ colors: new Map(), bots: new Set() });

/** Makes each room member's color, and which members are bots, available to everything below (chat, games). */
export function PlayersProvider({ colors, bots, children }: { colors: ReadonlyMap<string, number>; bots: ReadonlySet<string>; children: ReactNode }) {
  return <Players.Provider value={useMemo(() => ({ colors, bots }), [colors, bots])}>{children}</Players.Provider>;
}

/** Look up players' colors; someone who's left the room gets a stable stand-in. */
export function usePlayerColors(): (playerId: string) => number {
  const { colors } = useContext(Players);
  return (id) => colors.get(id) ?? fallback(id);
}

export function useIsBot(): (playerId: string) => boolean {
  const { bots } = useContext(Players);
  return (id) => bots.has(id);
}

function fallback(id: string): number {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) % COLOR_COUNT;
  return h;
}

/** A round badge in someone's color with their initial (a robot for bots), and optionally an online dot. */
export function Avatar(props: { name: string; color: number; online?: boolean; bot?: boolean; size?: "sm" | "md" | "lg" }) {
  const { name, color, online, bot, size = "md" } = props;
  return (
    <span className={`avatar ${size}`} style={playerStyle(color)} title={bot ? "Bot" : undefined} data-bot={bot || undefined} aria-hidden>
      {bot ? <BotIcon /> : name.trim().charAt(0).toUpperCase() || "?"}
      {online !== undefined && <span className={`avatar-status ${online ? "on" : "off"}`} title={online ? "Online" : "Away"} />}
    </span>
  );
}

/** A little robot head, drawn in the current text color. */
export function BotIcon() {
  return (
    <svg className="bot-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <rect x="11" y="1.5" width="2" height="4" rx="1" />
      <circle cx="12" cy="2.5" r="1.8" />
      <path d="M7 6h10a4 4 0 0 1 4 4v6a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4v-6a4 4 0 0 1 4-4Zm1.5 5.5a1.75 1.75 0 1 0 0 3.5 1.75 1.75 0 0 0 0-3.5Zm7 0a1.75 1.75 0 1 0 0 3.5 1.75 1.75 0 0 0 0-3.5Z" fillRule="evenodd" />
    </svg>
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
