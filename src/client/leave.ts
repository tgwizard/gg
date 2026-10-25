import type { LocalPlayer } from "./local";
import { type Owned, RoomClient } from "./net/RoomClient";

/** How long to try a room before leaving it for the next time it's opened. */
const GIVE_UP_MS = 15_000;

/**
 * Take a bot or guest of yours (`owned` says which) out of every room it's leaving, now,
 * from whatever page you're on (it gives up its seat there too); `leftRoom` is its
 * store's. A room that can't be reached keeps it marked, and the room page finishes the
 * job the next time you open that room.
 */
export function leaveRooms(player: LocalPlayer, owned: Owned, leftRoom: (id: string, roomId: string) => void): Promise<void> {
  const rooms = Object.entries(player.rooms).filter(([, r]) => r.removing || player.deleted);
  return Promise.all(rooms.map(([roomId]) => leaveRoom(player, roomId, owned, leftRoom))).then(() => {});
}

function leaveRoom(player: LocalPlayer, roomId: string, owned: Owned, leftRoom: (id: string, roomId: string) => void): Promise<void> {
  const client = new RoomClient(roomId, player.secret, player.name, player.color, owned);
  return new Promise((resolve) => {
    let asked = false;
    const done = (left: boolean) => {
      unsubscribe();
      clearTimeout(timer);
      client.stop();
      if (left) leftRoom(player.id, roomId);
      resolve();
    };
    const timer = setTimeout(() => done(false), GIVE_UP_MS);
    const unsubscribe = client.subscribe(() => {
      const status = client.getSnapshot().status;
      if (status === "left" || status === "not_found") return done(true);
      if (status !== "connected" || asked) return;
      asked = true;
      client.leaveRoom().then(
        () => done(true),
        () => done(false),
      );
    });
    client.start();
  });
}
