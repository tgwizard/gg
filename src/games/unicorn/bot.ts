/**
 * The built-in Unicorn race bot. Rolling is all luck, so the only decision is who to
 * pick up at a stop with a choice: it takes the friend that's hardest to find on the
 * stretch ahead (fewest stops within a few rolls offering them). Easy, it picks anyone.
 * It never changes between kid and grown-up.
 */
import { easy } from "../kit/bot";
import type { GameBot } from "../types";
import type { Rider, UnicornView } from "./engine";
import type { UnicornOp } from "./index";

/** How far ahead it looks: about three rolls. */
const LOOKAHEAD = 12;

export const unicornBot: GameBot<UnicornView, UnicornOp> = {
  play(view, ops, rand, opts) {
    const roll = ops.find((op) => op.type === "roll");
    if (roll) return roll;
    const picks = ops.filter((op): op is Extract<UnicornOp, { type: "pick" }> => op.type === "pick");
    if (!picks.length) return null;
    if (easy(opts)) return picks[rand(picks.length)]!;
    const me = view.racers.find((r) => r.seat === view.you.seat && !r.left);
    const from = me?.at ?? 0;
    const ahead = (rider: Rider) => {
      let n = 0;
      for (let i = 1; i <= LOOKAHEAD; i++) if (view.track[(from + i) % view.track.length]!.riders.includes(rider)) n++;
      return n;
    };
    const fewest = Math.min(...picks.map((p) => ahead(p.rider)));
    const best = picks.filter((p) => ahead(p.rider) === fewest);
    return best[rand(best.length)]!;
  },
};
