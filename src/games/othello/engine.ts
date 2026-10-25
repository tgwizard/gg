/**
 * Othello for two, as a state machine around ./rules, at a kit duel table (two seats,
 * games in a series, colors swapping every game; see kit/duel).
 *
 * Black moves first. Someone with no move passes, and the server does that for them at
 * once (it's never a choice), so the game only ever waits on a player who can move. It
 * ends when neither can: most discs wins. It can also end off the board: resigning,
 * running out of time, leaving.
 *
 * Clocks are chess clocks (kit/duel `fischer`). Nothing is hidden, but the view is still
 * built field by field.
 */
import {
  actingColor,
  beginDuel,
  checkDuel,
  checkRematch,
  type Duel,
  type DuelSpec,
  type DuelView,
  duelView,
  emptyDuel,
  endDuel,
  fischer,
  leaveDuel,
  type Side,
  sitDuel,
  waitingOnColor,
} from "../kit/duel";
import { nextTimer, takeDueTimer } from "../kit/timers";
import { type GameContext, GameError } from "../types";
import { type Color, count, flipsFor, legalMoves, other, parseSquare, play, squareName, START_BOARD } from "./rules";

export type { Side };

export interface OthelloConfig {
  /** Minutes on each clock; 0 = no clock. */
  minutes: number;
  /** Seconds added to your clock for each move you make. */
  increment: number;
}

export type EndReason = "board" | "resign" | "timeout" | "left";

export interface OthelloResult {
  /** Null for a draw (the same number of discs). */
  winner: Color | null;
  reason: EndReason;
  /** Discs on the board at the end. */
  score: { b: number; w: number };
}

/** A disc set down, or a pass (`at` null). */
export interface PlayedMove {
  by: Color;
  at: number | null;
  flips: number[];
}

export interface OthelloState extends Duel<Color> {
  config: OthelloConfig;
  board: string;
  turn: Color;
  moves: PlayedMove[];
  clock: { b: number; w: number } | null;
  clockSince: number;
  result: OthelloResult | null;
}

export const SPEC: DuelSpec<Color> = { name: "Othello", colors: ["b", "w"] };

export function createState(config: OthelloConfig): OthelloState {
  return { config, ...emptyDuel<Color>(), board: START_BOARD, turn: "b", moves: [], clock: null, clockSince: 0, result: null };
}

const hasMoved = (state: OthelloState, c: Color) => state.moves.some((m) => m.by === c && m.at !== null);
const score = (state: OthelloState) => {
  const { b, w } = count(state.board);
  return { b, w };
};

// --- seating -------------------------------------------------------------------

export function sit(state: OthelloState, playerId: string, seat: number, ctx: GameContext) {
  if (sitDuel(state, playerId, seat)) startGame(state, ctx);
}

export function leave(state: OthelloState, playerId: string, ctx: GameContext) {
  leaveDuel(state, SPEC, playerId, ctx, {
    moved: (c) => hasMoved(state, c),
    forfeit: (c) => finish(state, { winner: other(c), reason: "left", score: score(state) }, ctx),
  });
}

export function rematch(state: OthelloState, actor: string, ctx: GameContext) {
  checkRematch(state, actor);
  startGame(state, ctx);
}

function startGame(state: OthelloState, ctx: GameContext) {
  beginDuel(state, SPEC);
  state.board = START_BOARD;
  state.turn = "b";
  state.moves = [];
  state.result = null;
  fischer.start(state, SPEC, ctx.now);
}

// --- playing -------------------------------------------------------------------

export function move(state: OthelloState, actor: string, square: string, ctx: GameContext) {
  const c = actingColor(state, SPEC, actor, state.turn);
  const sq = parseSquare(square);
  if (sq === null || state.board[sq] !== ".") throw new GameError("illegal_move", "That square is taken.");
  if (!flipsFor(state.board, c, sq).length) throw new GameError("illegal_move", "A disc has to trap at least one of theirs in a line.");

  fischer.stop(state, c, ctx.now, true);
  const after = play(state.board, c, sq);
  state.board = after.board;
  state.moves.push({ by: c, at: sq, flips: after.flips });

  const them = other(c);
  if (legalMoves(state.board, them).length) state.turn = them;
  else if (legalMoves(state.board, c).length) {
    // They're stuck: they pass, and it's yours again.
    state.moves.push({ by: them, at: null, flips: [] });
  } else return finishOnBoard(state, ctx);
  fischer.flag(state, state.turn);
}

function finishOnBoard(state: OthelloState, ctx: GameContext) {
  const s = score(state);
  finish(state, { winner: s.b > s.w ? "b" : s.w > s.b ? "w" : null, reason: "board", score: s }, ctx);
}

export function resign(state: OthelloState, actor: string, ctx: GameContext) {
  const c = actingColor(state, SPEC, actor);
  finish(state, { winner: other(c), reason: "resign", score: score(state) }, ctx);
}

function finish(state: OthelloState, result: OthelloResult, ctx: GameContext) {
  fischer.stop(state, state.turn, ctx.now);
  state.result = result;
  endDuel(state, SPEC, result.winner, resultText(result, (c) => ctx.nameOf(state.sides![c])), ctx);
}

/** "Alice wins, 40–24." / "A draw, 32–32." */
export function resultText(result: OthelloResult, name: (c: Color) => string): string {
  const { b, w } = result.score;
  if (!result.winner) return `A draw, ${b}–${w}.`;
  const [mine, theirs] = result.winner === "b" ? [b, w] : [w, b];
  const loser = name(other(result.winner));
  const how: Record<EndReason, string> = {
    board: `, ${mine}–${theirs}`,
    resign: ` (${loser} resigned)`,
    timeout: ` on time (${loser} ran out)`,
    left: ` (${loser} left the board)`,
  };
  return `${name(result.winner)} wins${how[result.reason]}.`;
}

// --- timers --------------------------------------------------------------------

export function nextDeadline(state: OthelloState): number | null {
  return nextTimer(state.timers);
}

export function onDeadline(state: OthelloState, ctx: GameContext) {
  const due = takeDueTimer(state.timers, ctx.now);
  if (due !== "flag" || state.phase !== "playing" || !state.clock) return;
  const late = state.turn;
  finish(state, { winner: other(late), reason: "timeout", score: score(state) }, ctx);
  state.clock[late] = 0;
}

// --- who and what --------------------------------------------------------------

export function waitingOn(state: OthelloState): string[] {
  return state.phase === "playing" ? waitingOnColor(state, SPEC, state.turn) : [];
}

export function checkInvariants(state: OthelloState) {
  checkDuel(state, SPEC);
  fischer.check(state);
  if (!/^[bw.]{64}$/.test(state.board)) throw new Error("a malformed board");
  const placed = state.moves.filter((m) => m.at !== null);
  if (64 - count(state.board).empty !== 4 + placed.length) throw new Error("discs and moves out of step");
  if (placed.some((m) => state.board[m.at!] === ".")) throw new Error("a move on a square that's empty");
  if (state.phase === "playing" && !legalMoves(state.board, state.turn).length) throw new Error("waiting on a side that can't move");
}

// --- views ---------------------------------------------------------------------

export interface LastMove {
  by: Color;
  square: string;
  /** The discs it turned over, nearest first along each line. */
  flipped: string[];
}

export interface OthelloView extends DuelView<Color> {
  config: OthelloConfig;
  /** 64 cells, row by row from a1 at the top left: "b", "w" or ".". */
  board: string;
  /** The same as 8 rows, row 1 (the top) first. */
  rows: string[];
  turn: Color;
  score: { b: number; w: number };
  /** Every move so far: the square, or null for a pass. */
  moves: { by: Color; square: string | null }[];
  /** The last disc set down. */
  lastMove: LastMove | null;
  /** Who passed after it, if anyone (it's the mover's turn again). */
  passed: Color | null;
  /** Milliseconds left on each clock as of `since`; the `running` side's has been ticking since then. */
  clock: { b: number; w: number; since: number; running: Color | null } | null;
  result: OthelloResult | null;
}

export function lastMoveView(moves: PlayedMove[]): { lastMove: LastMove | null; passed: Color | null } {
  const last = moves.findLast((m) => m.at !== null);
  const tail = moves.at(-1);
  return {
    lastMove: last ? { by: last.by, square: squareName(last.at!), flipped: last.flips.map(squareName) } : null,
    passed: tail && tail.at === null ? tail.by : null,
  };
}

export function viewFor(state: OthelloState, viewer: string): OthelloView {
  return {
    ...duelView(state, SPEC, viewer),
    config: { minutes: state.config.minutes, increment: state.config.increment },
    board: state.board,
    rows: Array.from({ length: 8 }, (_, r) => state.board.slice(r * 8, r * 8 + 8)),
    turn: state.turn,
    score: score(state),
    moves: state.moves.map((m) => ({ by: m.by, square: m.at === null ? null : squareName(m.at) })),
    ...lastMoveView(state.moves),
    clock: fischer.view(state, state.phase === "playing" ? state.turn : null),
    result: state.result ? { winner: state.result.winner, reason: state.result.reason, score: { ...state.result.score } } : null,
  };
}
