/**
 * The built-in Four in a Row bot: a real search (./search), alpha-beta on a time budget,
 * so it never misses a win or a block it can see and plays for threats on the right
 * rows. It sees about a dozen moves ahead in the middle of a game and plays the end
 * perfectly; early on it picks at random among moves that look about as good as the
 * best, so no two games go the same way. A good player who builds threats patiently
 * can still beat it.
 */
import type { GameBot } from "../types";
import type { FourView } from "./engine";
import type { FourOp } from "./index";
import { Position, type SearchOptions, type SearchResult } from "./search";

/** It runs on the page, so it stops thinking after this long. */
const THINK_MS = 450;
/** And never looks further ahead than this many moves (beyond that it would be all but perfect). */
const MAX_DEPTH = 14;
/** The first moves of a game: pick among the moves within this much of the best. */
const OPENING_MOVES = 10;
const OPENING_MARGIN = 8;

/** How hard it thinks. */
export interface Budget {
  maxDepth: number;
  timeMs: number;
}

/** Tests and set-up positions: a few moves ahead, no clock (so it's repeatable), and plenty of variety. */
const QUICK: Budget = { maxDepth: 4, timeMs: Infinity };

export const fourInARowBot: GameBot<FourView, FourOp> = {
  easy(view, ops, rand, opts) {
    const me = view.you.color;
    const columns = new Set(ops.flatMap((op) => (op.type === "drop" ? [op.column] : [])));
    if (!me || view.phase !== "playing" || view.turn !== me || !columns.size) return null;
    const best = think(view, rand, opts?.quick ? QUICK : { maxDepth: MAX_DEPTH, timeMs: THINK_MS });
    const column = columns.has(best.column + 1) ? best.column + 1 : [...columns][0]!;
    return { type: "drop", column };
  },
};

/** The bot's choice for the side to move in `view`, with a given budget. */
export function think(view: Pick<FourView, "board" | "size" | "moves">, rand: (maxExclusive: number) => number, budget: Budget): SearchResult {
  const pos = Position.fromBoard(view.board, view.size.columns, view.size.rows);
  // The first disc goes in the middle (the search can't see far enough to know it's best).
  if (!view.moves.length) {
    const W = view.size.columns;
    return { column: W % 2 ? (W - 1) / 2 : W / 2 - rand(2), score: 0, depth: 0, nodes: 0, solved: false };
  }
  const quick = budget.timeMs === Infinity;
  const opening = view.moves.length < OPENING_MOVES;
  const opts: SearchOptions = { maxDepth: budget.maxDepth, timeMs: budget.timeMs, table: !quick, rand };
  // Quick bots wander more (scenarios look for games that go different ways); a real one only in the opening.
  if (quick) opts.margin = 25;
  else if (opening) opts.margin = OPENING_MARGIN;
  return pos.search(opts);
}
