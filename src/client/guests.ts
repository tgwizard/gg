/**
 * People who play on this device with you (hot seat): players kept in this browser (see
 * ./local), like your bots, but played by hand. In a room each has its own connection
 * from your page, so it's in the room as itself (a "guest" member, on your device), and
 * in a hot-seat game the room shows the game as whichever of you is to move.
 */
import { useEffect, useState } from "react";
import { sanitizeName } from "../shared/protocol";
import { type LocalPlayer, localPlayers } from "./local";
import { RoomClient } from "./net/RoomClient";

export type GuestRecord = LocalPlayer;

/** As many people as play on one device. */
export const MAX_GUESTS = 12;

const guests = localPlayers<GuestRecord>("gg.guests");

export const getGuests = guests.all;
export const inviteGuest = guests.invite;
/** Take someone out of one room for good (they stay on this device). */
export const removeGuest = guests.removeFromRoom;
export const leftRoom = guests.leftRoom;
/** Forget someone: they leave every room they're in, then they're gone from this device. */
export const deleteGuest = guests.remove;
/** Everyone who plays on this device (not deleted ones), oldest first. */
export const useMyGuests = guests.useMine;
/** Those in a room, including ones on their way out. */
export const useGuests = guests.useIn;

export function createGuest(name: string, color: number): Promise<GuestRecord | null> {
  return guests.create({ name: sanitizeName(name), color }, MAX_GUESTS);
}

export function updateGuest(id: string, name: string, color: number) {
  guests.patch(id, { name: sanitizeName(name), color });
}

/**
 * Connect the guests you've brought into this room while it's open: each joins as
 * itself, takes on name and color changes, and leaves the room for good once removed
 * (or deleted). Returns their connections, by player id.
 */
export function useGuestClients(roomId: string, ownerSecret: string): ReadonlyMap<string, RoomClient> {
  const [clients, setClients] = useState<ReadonlyMap<string, RoomClient>>(new Map());
  useEffect(() => {
    const playing = new Map<string, { client: RoomClient; record: GuestRecord; leaving: boolean }>();
    const publish = () => setClients(new Map([...playing.values()].filter((p) => !removing(p.record, roomId)).map((p) => [p.record.playerId, p.client])));
    const leave = (p: { client: RoomClient; record: GuestRecord; leaving: boolean }) => {
      const status = p.client.getSnapshot().status;
      if (status === "left" || status === "not_found") return guests.leftRoom(p.record.id, roomId);
      if (p.leaving || status !== "connected") return;
      p.leaving = true;
      p.client.leaveRoom().then(
        () => guests.leftRoom(p.record.id, roomId),
        () => (p.leaving = false),
      );
    };
    const sync = () => {
      const here = guests.inRoom(roomId);
      for (const record of here) {
        const p = playing.get(record.id);
        if (p) {
          p.record = record;
          if (removing(record, roomId)) leave(p);
          else p.client.setProfile(record.name, record.color);
          continue;
        }
        const client = new RoomClient(roomId, record.secret, record.name, record.color, { owner: ownerSecret, guest: true });
        const fresh = { client, record, leaving: false };
        playing.set(record.id, fresh);
        client.subscribe(() => removing(fresh.record, roomId) && leave(fresh));
        client.start();
      }
      for (const [id, p] of playing) {
        if (here.some((r) => r.id === id)) continue;
        playing.delete(id);
        p.client.stop();
      }
      publish();
    };
    sync();
    const unsubscribe = guests.subscribe(sync);
    return () => {
      unsubscribe();
      for (const p of playing.values()) p.client.stop();
    };
  }, [roomId, ownerSecret]);
  return clients;
}

const removing = (g: GuestRecord, roomId: string) => !!(g.deleted || g.rooms[roomId]?.removing);
