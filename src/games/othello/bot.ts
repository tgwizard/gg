/**
 * The Easy Othello bot: it looks one move ahead. It weighs squares the usual way
 * (corners are gold, the squares beside an empty corner give it away, edges are good)
 * and likes leaving the other side few moves, with enough randomness that it can be
 * beaten.
 */
import type { GameBot } from "../types";
import type { OthelloView } from "./engine";
import type { OthelloOp } from "./index";
import { type Color, CORNERS, legalMoves, other, parseSquare, play } from "./rules";

const WEIGHTS = [
  100, -20, 10,  5,  5, 10, -20, 100,
  -20, -40, -2, -2, -2, -2, -40, -20,
   10,  -2,  1,  1,  1,  1,  -2,  10,
    5,  -2,  1,  0,  0,  1,  -2,   5,
    5,  -2,  1,  0,  0,  1,  -2,   5,
   10,  -2,  1,  1,  1,  1,  -2,  10,
  -20, -40, -2, -2, -2, -2, -40, -20,
  100, -20, 10,  5,  5, 10, -20, 100,
];

/** The corner each square next to a corner gives away. */
const NEAR_CORNER: Record<number, number> = { 1: 0, 8: 0, 9: 0, 6: 7, 14: 7, 15: 7, 48: 56, 49: 56, 57: 56, 54: 63, 55: 63, 62: 63 };

export const othelloBot: GameBot<OthelloView, OthelloOp> = {
  easy(view, ops, rand) {
    const me = view.you.color;
    const moves = ops.flatMap((op) => (op.type === "move" ? [op] : []));
    if (!me || !moves.length) return null;
    let best = moves[0]!;
    let bestScore = -Infinity;
    for (const op of moves) {
      const s = score(view.board, me, parseSquare(op.square)!) + rand(1200) / 100;
      if (s > bestScore) [best, bestScore] = [op, s];
    }
    return best;
  },
};

function score(board: string, me: Color, sq: number): number {
  const next = play(board, me, sq);
  const corner = NEAR_CORNER[sq];
  // Next to a corner that's already taken is just an edge or inner square.
  let s = corner !== undefined && board[corner] !== "." ? 2 : WEIGHTS[sq]!;
  s += next.flips.length * 0.6;
  const replies = legalMoves(next.board, other(me));
  if (!replies.length) s += 15;
  s -= replies.length * 1.5;
  if (replies.some((r) => CORNERS.includes(r))) s -= 30;
  return s;
}
