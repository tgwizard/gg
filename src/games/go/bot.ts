/**
 * The built-in Go bot: Monte Carlo. For each move it plays out a few thousand random
 * games (see ./montecarlo) and picks the move that won most. It knows no joseki or shape,
 * but it reads captures and life and death well enough to punish loose play on 9×9
 * (bigger boards get fewer playouts per point, so it plays weaker there).
 *
 * It passes when every point left is settled one way or the other, or when the other
 * side has passed and it's ahead. While counting, it corrects the marking where it's
 * clearly wrong against it (its live groups marked dead, the other side's dead ones
 * not), then accepts.
 */
import type { GameBot } from "../types";
import type { GoView } from "./engine";
import type { GoOp } from "./index";
import { estimateOwnership, pickBest, search } from "./montecarlo";
import { chainAt, type Color, other, parsePoint, pointName, type Size } from "./rules";

const PLAYOUTS: Record<Size, number> = { 9: 5000, 13: 3000, 19: 2000 };
/** It runs on the page, so it stops thinking after this long whatever the board. */
const THINK_MS = 350;
/** A point this decided (out of 1) is settled: no use playing there. */
const SETTLED = 0.8;
/** While counting, how clearly a group must lean its way before it changes the marking. */
const CLEAR = 0.6;

/** How hard it thinks: playouts per move (and for counting), and a time limit. */
export interface Budget {
  playouts: number;
  timeMs: number;
}

const QUICK: Budget = { playouts: 40, timeMs: 15 };

export const goBot: GameBot<GoView, GoOp> = {
  easy: (view, ops, rand, opts) => goMove(view, ops, rand, opts?.quick ? QUICK : { playouts: PLAYOUTS[view.size], timeMs: THINK_MS }),
};

/** The bot's move with a given budget (set-up positions use a middling one). */
export function goMove(view: GoView, ops: GoOp[], rand: (maxExclusive: number) => number, budget: Budget): GoOp | null {
  const me = view.you.color;
  if (!me) return null;
  const quick = budget.playouts < 100;
  const seed = rand(2 ** 31);
  const at = (point: string) => parsePoint(point, view.size)!;

  if (view.phase === "scoring") {
    if (!view.scoring || view.scoring.accepted[me]) return null;
    // Fix the marking where it's clearly wrong in the other side's favor, a group at a
    // time, then accept. Only clear cases, and only its own way, so two bots can't
    // keep flipping the same group.
    const marked = new Set(view.scoring.dead.map(at));
    const own = estimateOwnership(view.board, view.turn, { playouts: Math.min(400, budget.playouts), seed });
    for (const op of ops) {
      if (op.type !== "mark") continue;
      const ch = chainAt(view.board, at(op.point)).stones;
      const lean = ch.reduce((sum, p) => sum + own[p]!, 0) / ch.length;
      const mineLeans = me === "b" ? lean : -lean;
      const ours = view.board[at(op.point)] === me;
      if (ours && marked.has(at(op.point)) && mineLeans > CLEAR) return op;
      if (!ours && !marked.has(at(op.point)) && mineLeans > CLEAR) return op;
    }
    return ops.find((op) => op.type === "accept") ?? null;
  }

  // Only on your move is passing among the moves.
  const passOp = ops.find((op) => op.type === "pass");
  if (!passOp) return null;
  const points = ops.flatMap((op) => (op.type === "play" ? [at(op.point)] : [])).filter((p) => sensible(view, p));
  const result = search(view.board, me, points, {
    komi: view.komi,
    playouts: budget.playouts,
    timeMs: budget.timeMs,
    seed,
    lastMove: view.lastMove ? at(view.lastMove.point) : null,
  });
  const mine = (p: number) => (me === "b" ? result.ownership[p]! : -result.ownership[p]!);

  // The other side passed: pass too if that wins, counting every point by who it leans to.
  if (view.passed === other(me) && margin(view, me, mine) > 0) return passOp;
  const open = result.stats.filter((s) => Math.abs(mine(s.point)) < SETTLED);
  if (!open.length) return passOp;
  const best = pickBest(open);
  // Hopeless, late in the game: resign rather than play it out.
  if (!quick && best.winRate < 0.03 && best.visits > 30 && view.moves.length > view.size * view.size * 0.6) return ops.find((op) => op.type === "resign") ?? passOp;
  return { type: "play", point: pointName(best.point, view.size) };
}

/** Your lead by area if the game were counted now, each point going to whoever it leans to. */
function margin(view: GoView, me: Color, mine: (p: number) => number): number {
  let lead = 0;
  for (let p = 0; p < view.board.length; p++) lead += Math.sign(mine(p));
  return lead + (me === "w" ? view.komi : -view.komi);
}

/** Leaves out moves on the outer two lines with nothing near: random playouts like them more than they should. */
function sensible(view: GoView, p: number): boolean {
  const n = view.size;
  const [r, c] = [Math.floor(p / n), p % n];
  if (Math.min(r, c, n - 1 - r, n - 1 - c) >= 2) return true;
  for (let dr = -2; dr <= 2; dr++) {
    for (let dc = -2; dc <= 2; dc++) {
      const [rr, cc] = [r + dr, c + dc];
      if (Math.abs(dr) + Math.abs(dc) <= 2 && rr >= 0 && cc >= 0 && rr < n && cc < n && view.board[rr * n + cc] !== ".") return true;
    }
  }
  return false;
}
