/**
 * Players kept in this browser besides you: your bots, and people who play on this device
 * with you (hot seat). Each is one player (its own secret, so the same player id
 * everywhere) that you bring into rooms, and that's played from this browser while you
 * have one of those rooms open. Editing one changes it in every room; deleting it takes
 * it out of all of them.
 *
 * `localPlayers` makes the store for one kind; bots/store.ts and guests.ts add their own.
 */
import { useMemo, useSyncExternalStore } from "react";
import { playerIdFromSecret } from "../shared/playerId";
import { MAX_OWNED_PER_PLAYER } from "../shared/protocol";
import { newSecret } from "./identity";
import { storage } from "./storage";

/** A room a local player has been brought into. */
export interface LocalRoom {
  invitedAt: string;
  /**
   * You took it out of the room, and it's leaving. Kept until the room confirms, so a
   * removal made while the room isn't open happens when you're next there.
   */
  removing?: true;
}

export interface LocalPlayer {
  id: string;
  secret: string;
  /** What rooms call it (derived from the secret). */
  playerId: string;
  name: string;
  color: number;
  createdAt: string;
  rooms: Record<string, LocalRoom>;
  /** Deleted: gone from your list, and leaving every room it's in; forgotten once it has. */
  deleted?: true;
}

/** Every kind's store: a room takes up to MAX_OWNED_PER_PLAYER of them from each person, all kinds together. */
const stores: { playingIn(roomId: string): LocalPlayer[] }[] = [];

/** How many of your bots and guests are in a room (the room's limit counts them together). */
export const ownedIn = (roomId: string) => stores.reduce((n, s) => n + s.playingIn(roomId).length, 0);

export function localPlayers<R extends LocalPlayer>(key: string, migrate: (list: R[]) => R[] = (l) => l) {
  const event = `${key}:changed`;
  let cache: { raw: string | null; list: R[] } = { raw: null, list: [] };

  /** Every one, deleted ones still on their way out of rooms included. */
  function all(): R[] {
    const raw = storage.get(key);
    if (raw !== cache.raw) {
      let list: R[] = [];
      try {
        const parsed: unknown = raw ? JSON.parse(raw) : [];
        if (Array.isArray(parsed)) list = migrate(parsed.filter((p) => typeof p?.secret === "string" && typeof p.playerId === "string"));
      } catch {
        // Unreadable: start over rather than break the page.
      }
      cache = { raw, list };
    }
    return cache.list;
  }

  function save(list: R[]) {
    storage.set(key, JSON.stringify(list));
    window.dispatchEvent(new Event(event));
  }

  const inRoom = (roomId: string, list = all()) => list.filter((p) => p.rooms[roomId]);
  const playingIn = (roomId: string, list = all()) => list.filter((p) => p.rooms[roomId] && !p.rooms[roomId].removing && !p.deleted);
  stores.push({ playingIn: (roomId) => playingIn(roomId) });

  function patch(id: string, change: Partial<R>) {
    save(all().map((p) => (p.id === id ? { ...p, ...change } : p)));
  }

  function subscribe(cb: () => void) {
    window.addEventListener("storage", cb);
    window.addEventListener(event, cb);
    return () => {
      window.removeEventListener("storage", cb);
      window.removeEventListener(event, cb);
    };
  }

  return {
    all,
    save,
    patch,
    subscribe,
    /** In a room, including ones on their way in or out. */
    inRoom,
    /** Playing in a room (not leaving it). */
    playingIn,

    /** A new one, with the fields `fields` adds; null if you have `max` already. */
    async create(fields: Omit<R, keyof LocalPlayer> & Pick<R, "name" | "color">, max: number): Promise<R | null> {
      if (all().filter((p) => !p.deleted).length >= max) return null;
      const secret = newSecret();
      const made = { ...fields, id: crypto.randomUUID(), secret, playerId: await playerIdFromSecret(secret), createdAt: new Date().toISOString(), rooms: {} } as R;
      save([...all(), made]);
      return made;
    },

    /** Bring one into a room (the room page plays it). False if you've brought as many there as you can. */
    invite(id: string, roomId: string): boolean {
      if (ownedIn(roomId) >= MAX_OWNED_PER_PLAYER) return false;
      save(all().map((p) => (p.id === id && !p.deleted ? { ...p, rooms: { ...p.rooms, [roomId]: { invitedAt: p.rooms[roomId]?.invitedAt ?? new Date().toISOString() } } } : p)));
      return true;
    },

    /** Take one out of a room for good (it stays yours). Whichever tab plays it there does the leaving. */
    removeFromRoom(id: string, roomId: string) {
      save(all().map((p) => (p.id === id && p.rooms[roomId] ? { ...p, rooms: { ...p.rooms, [roomId]: { ...p.rooms[roomId], removing: true } } } : p)));
    },

    /** The room has let it go (or is gone): forget it there, and forget a deleted one that's left everywhere. */
    leftRoom(id: string, roomId: string) {
      save(
        all().flatMap((p) => {
          if (p.id !== id) return [p];
          const { [roomId]: _, ...rooms } = p.rooms;
          return p.deleted && !Object.keys(rooms).length ? [] : [{ ...p, rooms }];
        }),
      );
    },

    /** Delete one: it leaves every room it's in, then it's forgotten. */
    remove(id: string) {
      save(
        all().flatMap((p) => {
          if (p.id !== id) return [p];
          if (!Object.keys(p.rooms).length) return [];
          const rooms = Object.fromEntries(Object.entries(p.rooms).map(([room, r]) => [room, { ...r, removing: true as const }]));
          return [{ ...p, rooms, deleted: true as const }];
        }),
      );
    },

    /** Yours (not deleted ones), oldest first. */
    useMine(): R[] {
      const list = useSyncExternalStore(subscribe, all);
      return useMemo(() => list.filter((p) => !p.deleted), [list]);
    },

    /** In a room, including ones on their way out. */
    useIn(roomId: string): R[] {
      const list = useSyncExternalStore(subscribe, all);
      return useMemo(() => inRoom(roomId, list), [list, roomId]);
    },
  };
}
