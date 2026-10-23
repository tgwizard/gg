import { useEffect } from "react";
import { BotPlayer } from "./BotPlayer";
import { getBots, subscribeBots } from "./store";

/**
 * Play your bots for this room while it's open: new ones join, renamed ones tell the
 * room, removed ones leave it (in whichever tab is playing them), and closing the
 * room stops them.
 */
export function useRunBots(roomId: string, ownerSecret: string) {
  useEffect(() => {
    const players = new Map<string, BotPlayer>();
    const sync = () => {
      const bots = getBots().filter((b) => b.roomId === roomId);
      for (const bot of bots) {
        const playing = players.get(bot.id);
        if (playing) {
          playing.update(bot);
          continue;
        }
        const player = new BotPlayer(bot, ownerSecret);
        players.set(bot.id, player);
        player.start();
      }
      for (const [id, player] of players) {
        if (bots.some((b) => b.id === id)) continue;
        players.delete(id);
        void player.remove();
      }
    };
    sync();
    const unsubscribe = subscribeBots(sync);
    return () => {
      unsubscribe();
      for (const player of players.values()) player.stop();
    };
  }, [roomId, ownerSecret]);
}
