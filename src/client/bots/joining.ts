/**
 * How your bots are getting on joining a room, for the room page to show between
 * "Invite" and the bot being there: still on its way, or why it can't come in yet.
 * Kept in memory by the tab that plays them (see BotPlayer).
 */
import { useSyncExternalStore } from "react";

export interface Joining {
  /** Why it isn't in yet, when something's wrong (it keeps trying). */
  problem?: string;
  /** Only reloading the page helps (the site was updated since it loaded). */
  reload?: boolean;
}

let states = new Map<string, Joining>();
const listeners = new Set<() => void>();
const key = (roomId: string, botId: string) => `${roomId}:${botId}`;

export function setJoining(roomId: string, botId: string, state: Joining | null) {
  const k = key(roomId, botId);
  const was = states.get(k);
  if (!state ? !was : was && was.problem === state.problem && was.reload === state.reload) return;
  states = new Map(states);
  if (state) states.set(k, state);
  else states.delete(k);
  for (const l of listeners) l();
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** Every bot's state (look one up with `joiningOf`). */
export function useJoining() {
  return useSyncExternalStore(subscribe, () => states);
}

export const joiningOf = (all: Map<string, Joining>, roomId: string, botId: string): Joining => all.get(key(roomId, botId)) ?? {};
