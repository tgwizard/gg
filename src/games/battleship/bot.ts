/**
 * The built-in Battleship bot: lets the server place its fleet at random, then fires at
 * random until it hits, and then around the hit until the ship sinks. Easy, it follows
 * up a hit only now and then.
 */
import { chance, easy } from "../kit/bot";
import type { GameBot } from "../types";
import { type BsView, FLEET, SIZE } from "./engine";
import type { BsOp } from "./index";

export const battleshipBot: GameBot<BsView, BsOp> = {
  play(view, ops, rand, opts) {
    const has = (type: BsOp["type"]) => ops.find((op) => op.type === type);
    const me = view.you.seat;
    if (me === null) return null;
    if (view.phase === "placing") {
      const placed = view.boards[me]?.ships?.length ?? 0;
      return placed < FLEET.length ? (has("random") ?? null) : (has("ready") ?? null);
    }
    const open = ops.flatMap((op) => (op.type === "fire" ? [op.cell] : []));
    if (!open.length) return null;
    const target = view.boards[1 - me];
    if (target && (!easy(opts) || chance(rand, 25))) {
      const sunk = new Set(target.sunk.flatMap((s) => s.cells));
      const hits = target.shots.filter((s) => s.hit && !sunk.has(s.cell)).map((s) => s.cell);
      const near = open.filter((c) => hits.some((h) => adjacent(c, h)));
      if (near.length) return { type: "fire", cell: near[rand(near.length)]! };
    }
    return { type: "fire", cell: open[rand(open.length)]! };
  },
};

function adjacent(a: number, b: number): boolean {
  const [ar, ac, br, bc] = [Math.floor(a / SIZE), a % SIZE, Math.floor(b / SIZE), b % SIZE];
  return Math.abs(ar - br) + Math.abs(ac - bc) === 1;
}
