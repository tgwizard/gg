/**
 * The Easy Finns i sjön bot. It asks for the rank it holds most of, and half the
 * time remembers who just asked for a rank it has (they must be holding some).
 */
import { rankOf } from "../kit/cards";
import type { GameBot } from "../types";
import type { FishView } from "./engine";
import type { FishOp } from "./index";

type Ask = Extract<FishOp, { type: "ask" }>;

export const fishBot: GameBot<FishView, FishOp> = {
  easy(view, ops, rand) {
    const asks = ops.filter((op): op is Ask => op.type === "ask");
    if (!asks.length) return null;
    const me = view.players.find((p) => p.seat === view.you.seat);
    if (rand(2) === 0) {
      // You can only ask for a rank you hold, so recent askers likely still have it.
      for (const e of [...view.log].reverse().slice(0, 8)) {
        if (e.type !== "ask" || e.from === me?.playerId) continue;
        const ask = asks.find((a) => a.target === e.from && a.rank === e.rank);
        if (ask) return ask;
      }
    }
    const counts = new Map<string, number>();
    for (const c of me?.hand ?? []) counts.set(rankOf(c), (counts.get(rankOf(c)) ?? 0) + 1);
    const most = Math.max(...asks.map((a) => counts.get(a.rank) ?? 0));
    const best = asks.filter((a) => (counts.get(a.rank) ?? 0) === most);
    return best[rand(best.length)]!;
  },
};
