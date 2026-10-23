/**
 * The Easy chess bot: it looks one move ahead. It takes a mate when it sees one, likes
 * winning material, checks and castling, and steers clear of moves that hand over
 * material or allow a mate in one. Beyond that it plays with some randomness, so it
 * blunders now and then and can be beaten. It takes a draw when it's well behind.
 */
import type { GameBot } from "../types";
import type { ChessView } from "./engine";
import type { ChessOp } from "./index";
import { attacked, colorOf, inCheck, isCapture, legalMoves, type Move, makeMove, material, other, parseFen, parseUci, type Position, typeOf, VALUE } from "./rules";

export const chessBot: GameBot<ChessView, ChessOp> = {
  easy(view, ops, rand) {
    const me = view.you.color;
    if (!me) return null;
    const pos = parseFen(view.fen);
    const accept = ops.find((op) => op.type === "acceptDraw");
    if (accept && material(pos.board, other(me)) - material(pos.board, me) >= 3) return accept;
    const moves = ops.filter((op) => op.type === "move");
    // Not its move: turn the offer down rather than leave it hanging.
    if (!moves.length) return ops.find((op) => op.type === "declineDraw") ?? null;
    let best = moves[0]!;
    let bestScore = -Infinity;
    for (const op of moves) {
      const s = score(pos, parseUci(op.move)!) + rand(100) / 100;
      if (s > bestScore) [best, bestScore] = [op, s];
    }
    return best;
  },
};

const CENTER = new Set([27, 28, 35, 36]);

/** How good `m` looks, in pawns, one move deep. */
function score(pos: Position, m: Move): number {
  const me = pos.turn;
  const piece = typeOf(pos.board[m.from]!);
  const next = makeMove(pos, m);
  const replies = legalMoves(next);
  if (!replies.length) {
    if (inCheck(next)) return 1000;
    // Stalemate: fine when losing, a waste when winning.
    return material(pos.board, other(me)) - material(pos.board, me);
  }
  let s = 0;
  if (isCapture(pos, m)) s += pos.board[m.to] ? VALUE[typeOf(pos.board[m.to]!)] : 1;
  if (m.promotion) s += VALUE[m.promotion] - 1;
  if (inCheck(next)) s += 0.3;
  if (piece === "k" && Math.abs(m.to - m.from) === 2) s += 0.6;
  if ((piece === "p" || piece === "n") && CENTER.has(m.to)) s += 0.2;
  if (piece === "q" && pos.fullmove < 8) s -= 0.3;
  // Their best answer: a mate, or the most they can take for free.
  let worst = 0;
  for (const r of replies) {
    const after = makeMove(next, r);
    if (inCheck(after) && !legalMoves(after).length) return -1000;
    const victim = next.board[r.to];
    if (!victim || colorOf(victim) !== me) continue;
    const gain = VALUE[typeOf(victim)] - (attacked(after.board, r.to, me) ? VALUE[typeOf(next.board[r.from]!)] : 0);
    worst = Math.max(worst, gain);
  }
  return s - worst;
}
