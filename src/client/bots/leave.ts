import { RoomClient } from "../net/RoomClient";
import { type BotRecord, leftRoom } from "./store";

/** How long to try a room before leaving it for the next time it's opened. */
const GIVE_UP_MS = 15_000;

/**
 * Take a bot out of every room it's leaving, now, from whatever page you're on (it
 * gives up its seat there too). A room that can't be reached keeps it marked, and the
 * room page finishes the job the next time you open that room.
 */
export function leaveRooms(bot: BotRecord, ownerSecret: string): Promise<void> {
  const rooms = Object.entries(bot.rooms).filter(([, r]) => r.removing || bot.deleted);
  return Promise.all(rooms.map(([roomId]) => leaveRoom(bot, roomId, ownerSecret))).then(() => {});
}

function leaveRoom(bot: BotRecord, roomId: string, ownerSecret: string): Promise<void> {
  const client = new RoomClient(roomId, bot.secret, bot.name, bot.color, ownerSecret, { level: "easy" });
  return new Promise((resolve) => {
    let asked = false;
    const done = (left: boolean) => {
      unsubscribe();
      clearTimeout(timer);
      client.stop();
      if (left) leftRoom(bot.id, roomId);
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
