/**
 * Rooms you've been in, newest first, for "Your rooms" on the home page. Kept in this
 * browser, noted while you're in a room, and forgotten once a room is gone (deleted
 * after ROOM_IDLE_TTL_MS with nobody in it, so one you last saw longer ago than that may
 * be gone too, and isn't listed).
 */
import { useMemo, useSyncExternalStore } from "react";
import { ROOM_IDLE_TTL_MS } from "../shared/protocol";
import { storage } from "./storage";

/** Someone you were in a room with: a person or a bot, as they looked there. */
export interface RoomMate {
  name: string;
  color: number;
  bot: boolean;
}

export interface RecentRoom {
  id: string;
  name: string | null;
  /** When you were last there (ms). */
  at: number;
  /** The game running when you were last there. */
  gameId: string | null;
  /** Who else was there, people and bots, the most recently there first (a few). */
  people: RoomMate[];
}

const KEY = "gg.rooms";
const EVENT = "gg.rooms:changed";
const MAX = 8;

let cache: { raw: string | null; list: RecentRoom[] } = { raw: null, list: [] };

function all(): RecentRoom[] {
  const raw = storage.get(KEY);
  if (raw !== cache.raw) {
    let list: RecentRoom[] = [];
    try {
      const parsed: unknown = raw ? JSON.parse(raw) : [];
      if (Array.isArray(parsed)) list = parsed.filter((r) => typeof r?.id === "string" && typeof r.at === "number" && Array.isArray(r.people) && r.people.every((p: unknown) => typeof (p as RoomMate)?.name === "string"));
    } catch {
      // Unreadable: start over.
    }
    cache = { raw, list };
  }
  return cache.list;
}

function save(list: RecentRoom[]) {
  storage.set(KEY, JSON.stringify(list));
  window.dispatchEvent(new Event(EVENT));
}

/** You're in this room now (or it changed while you were). */
export function rememberRoom(room: Omit<RecentRoom, "at">) {
  const before = all().find((r) => r.id === room.id);
  // Written when something changed, or every few minutes while you stay.
  if (before && before.name === room.name && before.gameId === room.gameId && JSON.stringify(before.people) === JSON.stringify(room.people) && Date.now() - before.at < 5 * 60_000) return;
  save([{ ...room, at: Date.now() }, ...all().filter((r) => r.id !== room.id)].slice(0, MAX));
}

/** The room is gone. */
export function forgetRoom(id: string) {
  if (all().some((r) => r.id === id)) save(all().filter((r) => r.id !== id));
}

function subscribe(cb: () => void) {
  window.addEventListener("storage", cb);
  window.addEventListener(EVENT, cb);
  return () => {
    window.removeEventListener("storage", cb);
    window.removeEventListener(EVENT, cb);
  };
}

/** Rooms you've been in that may well still be there, newest first. */
export function useRecentRooms(): RecentRoom[] {
  const list = useSyncExternalStore(subscribe, all);
  return useMemo(() => list.filter((r) => Date.now() - r.at < ROOM_IDLE_TTL_MS), [list]);
}
