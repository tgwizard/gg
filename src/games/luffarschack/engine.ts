/**
 * Luffarschack (five in a row on squared paper) for two, as a state machine around
 * ./rules, at a kit duel table (two seats, games in a series, the other seat drawing the
 * first cross next game; see kit/duel). The first to get five in a row wins; a full sheet
 * is a draw. A game can also end off the paper: resigning, running out of time, leaving.
 *
 * The clock is per turn: `turnSeconds` to make each mark (0 = no limit). Run out and you
 * lose the game.
 *
 * Nothing is hidden, but the view is still built field by field.
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
  leaveDuel,
  type Side,
  sitDuel,
  waitingOnColor,
} from "../kit/duel";
import { nextTimer, setTimer, takeDueTimer } from "../kit/timers";
import { type GameContext, GameError } from "../types";
import { anyFive, count, emptyBoard, fiveThrough, other, parseSquare, type Piece, place, type SizeName, sizeOf, squareName, winningRuns } from "./rules";

export type { Side };

export interface LuffaConfig {
  size: SizeName;
  /** Seconds for each mark; 0 = no limit. */
  turnSeconds: number;
}

export type EndReason = "five" | "full" | "resign" | "timeout" | "left";

export interface LuffaResult {
  /** Null for a draw (a full sheet). */
  winner: Piece | null;
  reason: EndReason;
  /** The winning runs through the last mark, as [first, last] cells; empty unless `reason` is "five". */
  runs: [number, number][];
}

export interface LuffaState extends Duel<Piece> {
  config: LuffaConfig;
  board: string;
  turn: Piece;
  /** The cells marked, in order: x first, then taking turns. */
  moves: number[];
  result: LuffaResult | null;
}

export const SPEC: DuelSpec<Piece> = { name: "Luffarschack", colors: ["x", "o"] };

export function createState(config: LuffaConfig): LuffaState {
  return { config, ...emptyDuel<Piece>(), board: emptyBoard(sizeOf(config.size)), turn: "x", moves: [], result: null };
}

export const boardSize = (state: { config: LuffaConfig }): number => sizeOf(state.config.size);
const hasMoved = (state: LuffaState, p: Piece) => state.moves.length > (p === "x" ? 0 : 1);
export const moveBy = (i: number): Piece => (i % 2 ? "o" : "x");

// --- seating -------------------------------------------------------------------

export function sit(state: LuffaState, playerId: string, seat: number, ctx: GameContext) {
  if (sitDuel(state, playerId, seat)) startGame(state, ctx);
}

export function leave(state: LuffaState, playerId: string, ctx: GameContext) {
  leaveDuel(state, SPEC, playerId, ctx, {
    moved: (p) => hasMoved(state, p),
    forfeit: (p) => finish(state, { winner: other(p), reason: "left", runs: [] }, ctx),
    calledOff: () => reset(state),
  });
}

export function rematch(state: LuffaState, actor: string, ctx: GameContext) {
  checkRematch(state, actor);
  startGame(state, ctx);
}

function reset(state: LuffaState) {
  state.board = emptyBoard(boardSize(state));
  state.turn = "x";
  state.moves = [];
}

function startGame(state: LuffaState, ctx: GameContext) {
  beginDuel(state, SPEC);
  reset(state);
  state.result = null;
  startTurn(state, ctx.now);
}

function startTurn(state: LuffaState, now: number) {
  const s = state.config.turnSeconds;
  setTimer(state.timers, "turn", s > 0 ? now + s * 1000 : null);
}

// --- playing -------------------------------------------------------------------

/** Mark `square` ("H8") with your cross or circle. */
export function mark(state: LuffaState, actor: string, square: string, ctx: GameContext) {
  const p = actingColor(state, SPEC, actor, state.turn);
  const n = boardSize(state);
  const cell = parseSquare(square, n);
  if (cell === null) throw new GameError("illegal_move", `There's no square ${square} on a ${n}×${n} sheet.`);
  if (state.board[cell] !== ".") throw new GameError("illegal_move", `${squareName(n, cell)} is already marked.`);

  state.board = place(state.board, cell, p);
  state.moves.push(cell);
  const runs = winningRuns(state.board, n, cell);
  if (runs.length) return finish(state, { winner: p, reason: "five", runs }, ctx);
  if (!state.board.includes(".")) return finish(state, { winner: null, reason: "full", runs: [] }, ctx);
  state.turn = other(p);
  startTurn(state, ctx.now);
}

export function resign(state: LuffaState, actor: string, ctx: GameContext) {
  const p = actingColor(state, SPEC, actor);
  finish(state, { winner: other(p), reason: "resign", runs: [] }, ctx);
}

function finish(state: LuffaState, result: LuffaResult, ctx: GameContext) {
  state.result = result;
  endDuel(state, SPEC, result.winner, resultText(result, (p) => ctx.nameOf(state.sides![p])), ctx);
}

/** "Alice wins with five in a row." / "A draw: the sheet is full." */
export function resultText(result: Pick<LuffaResult, "winner" | "reason">, name: (p: Piece) => string): string {
  if (!result.winner) return "A draw: the sheet is full.";
  const loser = name(other(result.winner));
  const how: Record<EndReason, string> = {
    five: " with five in a row",
    full: "",
    resign: ` (${loser} resigned)`,
    timeout: ` on time (${loser} ran out)`,
    left: ` (${loser} left the game)`,
  };
  return `${name(result.winner)} wins${how[result.reason]}.`;
}

// --- timers --------------------------------------------------------------------

export function nextDeadline(state: LuffaState): number | null {
  return nextTimer(state.timers);
}

export function onDeadline(state: LuffaState, ctx: GameContext) {
  const due = takeDueTimer(state.timers, ctx.now);
  if (due !== "turn" || state.phase !== "playing") return;
  finish(state, { winner: other(state.turn), reason: "timeout", runs: [] }, ctx);
}

// --- who and what --------------------------------------------------------------

export function waitingOn(state: LuffaState): string[] {
  return state.phase === "playing" ? waitingOnColor(state, SPEC, state.turn) : [];
}

export function checkInvariants(state: LuffaState) {
  checkDuel(state, SPEC);
  const n = boardSize(state);
  if (state.board.length !== n * n || !/^[xo.]+$/.test(state.board)) throw new Error("a malformed board");
  const c = count(state.board);
  if (c.x + c.o !== state.moves.length) throw new Error("marks and moves out of step");
  if (new Set(state.moves).size !== state.moves.length) throw new Error("a square marked twice");
  if (state.moves.some((cell, i) => state.board[cell] !== moveBy(i))) throw new Error("a move that isn't on the board");
  if (state.phase === "playing") {
    if (state.turn !== moveBy(state.moves.length)) throw new Error("the wrong side to move");
    if (anyFive(state.board, n)) throw new Error("five in a row while playing");
    if (!state.board.includes(".")) throw new Error("a full board while playing");
    if (state.config.turnSeconds > 0 && state.timers.turn === undefined) throw new Error("no turn timer");
  }
  if (state.result?.reason === "five" && !state.result.runs.length) throw new Error("a win without a line");
}

// --- views ---------------------------------------------------------------------

export interface LuffaView extends DuelView<Piece> {
  config: LuffaConfig;
  /** The sheet is size × size squares. */
  size: number;
  /** size × size cells, row by row from the top left: "x", "o" or ".". */
  board: string;
  /** The same as strings, row 1 (the top) first. */
  rows: string[];
  turn: Piece;
  /** Every mark so far, in order, by square name ("H8"). */
  moves: { by: Piece; square: string }[];
  /** The last mark made. */
  lastMove: { by: Piece; square: string; cell: number } | null;
  /** When the player to move runs out of time (server ms), or null. */
  turnDeadline: number | null;
  result: { winner: Piece | null; reason: EndReason; squares: string[]; runs: [number, number][]; cells: number[] } | null;
}

export function viewFor(state: LuffaState, viewer: string): LuffaView {
  const n = boardSize(state);
  const last = state.moves.at(-1);
  const r = state.result;
  const cells = r && r.runs.length ? fiveThrough(state.board, n, state.moves.at(-1)!) : [];
  return {
    ...duelView(state, SPEC, viewer),
    config: { size: state.config.size, turnSeconds: state.config.turnSeconds },
    size: n,
    board: state.board,
    rows: Array.from({ length: n }, (_, i) => state.board.slice(i * n, (i + 1) * n)),
    turn: state.turn,
    moves: state.moves.map((cell, i) => ({ by: moveBy(i), square: squareName(n, cell) })),
    lastMove: last === undefined ? null : { by: moveBy(state.moves.length - 1), square: squareName(n, last), cell: last },
    turnDeadline: state.phase === "playing" ? (state.timers.turn ?? null) : null,
    result: r ? { winner: r.winner, reason: r.reason, squares: cells.map((c) => squareName(n, c)), runs: r.runs.map(([a, b]) => [a, b] as [number, number]), cells } : null,
  };
}
