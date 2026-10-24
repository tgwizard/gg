/**
 * Luffarschack (five in a row on squared paper) for two, as a state machine around ./rules.
 *
 * Built like Four in a Row: the first game starts when both seats fill, and "Play again"
 * starts the next, with the other seat drawing the first cross. The first to get five in a
 * row wins; a full sheet is a draw. A game can also end off the paper: resigning, running
 * out of time, leaving. Leaving before you've made a mark calls the game off.
 *
 * The clock is per turn: `turnSeconds` to make each mark (0 = no limit). Run out and you
 * lose the game.
 *
 * Nothing is hidden, but the view is still built field by field.
 */
import { emptySeating, requireSeat, type Seat, type Seating, seatOf, sitDown, standUp } from "../kit/seating";
import { nextTimer, setTimer, takeDueTimer, type Timers } from "../kit/timers";
import { type GameContext, GameError } from "../types";
import { anyFive, count, emptyBoard, fiveThrough, other, parseSquare, type Piece, place, type SizeName, sizeOf, squareName, winningRuns } from "./rules";

/** Seat 0 or 1. */
export type Side = 0 | 1;
export type LuffaSeat = Seat & { wins: number };

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

export interface LuffaState extends Seating<LuffaSeat> {
  config: LuffaConfig;
  phase: "waiting" | "playing" | "over";
  game: number;
  /** The seat playing "x" (who starts) this game. */
  xSeat: Side;
  /** The seat that starts the next game. */
  nextXSeat: Side;
  /** Who plays each piece this (or the last) game, kept after they leave so the result can name them. */
  sides: { x: string; o: string } | null;
  board: string;
  turn: Piece;
  /** The cells marked, in order: x first, then taking turns. */
  moves: number[];
  result: LuffaResult | null;
  draws: number;
  timers: Timers<"turn">;
}

export function createState(config: LuffaConfig): LuffaState {
  return {
    config,
    ...emptySeating<LuffaSeat>(2),
    phase: "waiting",
    game: 0,
    xSeat: 0,
    nextXSeat: 0,
    sides: null,
    board: emptyBoard(sizeOf(config.size)),
    turn: "x",
    moves: [],
    result: null,
    draws: 0,
    timers: {},
  };
}

export const boardSize = (state: { config: LuffaConfig }): number => sizeOf(state.config.size);
const bothSeated = (state: LuffaState) => state.seats.every(Boolean);
export const seatPiece = (state: LuffaState, seat: number): Piece => (seat === state.xSeat ? "x" : "o");
const seatOfPiece = (state: LuffaState, p: Piece): Side => (p === "x" ? state.xSeat : ((1 - state.xSeat) as Side));
const hasMoved = (state: LuffaState, p: Piece) => state.moves.length > (p === "x" ? 0 : 1);
export const moveBy = (i: number): Piece => (i % 2 ? "o" : "x");

// --- seating -------------------------------------------------------------------

export function sit(state: LuffaState, playerId: string, seat: number, ctx: GameContext) {
  sitDown(state, playerId, seat, () => ({ wins: 0 }));
  if (state.phase === "waiting" && bothSeated(state)) startGame(state, ctx);
}

export function leave(state: LuffaState, playerId: string, ctx: GameContext) {
  const seat = requireSeat(state, playerId);
  if (state.phase === "playing") {
    const p = seatPiece(state, seat);
    if (hasMoved(state, p)) finish(state, { winner: other(p), reason: "left", runs: [] }, ctx);
    else {
      // Nothing lost yet: call it off, and the next game is this one again (the same opener).
      state.phase = "waiting";
      state.nextXSeat = state.xSeat;
      state.game--;
      state.sides = null;
      state.board = emptyBoard(boardSize(state));
      state.moves = [];
      state.turn = "x";
      setTimer(state.timers, "turn", null);
      ctx.announce(`The Luffarschack game was called off: ${ctx.nameOf(playerId)} left before making a mark.`);
    }
  }
  standUp(state, playerId);
}

export function rematch(state: LuffaState, actor: string, ctx: GameContext) {
  requireSeat(state, actor);
  if (state.phase !== "over") throw new GameError("in_progress", "A game is already on.");
  if (!bothSeated(state)) throw new GameError("not_enough_players", "Two players need to be seated.");
  startGame(state, ctx);
}

export const canRematch = (state: LuffaState) => state.phase === "over" && bothSeated(state);

function startGame(state: LuffaState, ctx: GameContext) {
  state.phase = "playing";
  state.game++;
  state.xSeat = state.nextXSeat;
  state.sides = { x: state.seats[state.xSeat]!.playerId, o: state.seats[1 - state.xSeat]!.playerId };
  state.board = emptyBoard(boardSize(state));
  state.turn = "x";
  state.moves = [];
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
  const seat = requireSeat(state, actor);
  if (state.phase !== "playing") throw new GameError("not_playing", "There's no game on.");
  const p = seatPiece(state, seat);
  if (state.turn !== p) throw new GameError("not_your_turn", "It's not your move.");
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
  const seat = requireSeat(state, actor);
  if (state.phase !== "playing") throw new GameError("not_playing", "There's no game on.");
  finish(state, { winner: other(seatPiece(state, seat)), reason: "resign", runs: [] }, ctx);
}

function finish(state: LuffaState, result: LuffaResult, ctx: GameContext) {
  state.phase = "over";
  state.result = result;
  setTimer(state.timers, "turn", null);
  if (result.winner) {
    const seat = state.seats[seatOfPiece(state, result.winner)];
    if (seat?.playerId === state.sides![result.winner]) seat.wins++;
  } else state.draws++;
  state.nextXSeat = (1 - state.xSeat) as Side;
  ctx.announce(`Luffarschack game ${state.game}: ${resultText(result, (p) => ctx.nameOf(state.sides![p]))}`);
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
  if (state.phase !== "playing") return [];
  return [state.seats[seatOfPiece(state, state.turn)]!.playerId];
}

export function checkInvariants(state: LuffaState) {
  const n = boardSize(state);
  if (state.board.length !== n * n || !/^[xo.]+$/.test(state.board)) throw new Error("a malformed board");
  const c = count(state.board);
  if (c.x + c.o !== state.moves.length) throw new Error("marks and moves out of step");
  if (new Set(state.moves).size !== state.moves.length) throw new Error("a square marked twice");
  if (state.moves.some((cell, i) => state.board[cell] !== moveBy(i))) throw new Error("a move that isn't on the board");
  if (state.phase === "playing") {
    if (!bothSeated(state)) throw new Error("playing without two players");
    for (const p of ["x", "o"] as const) if (state.seats[seatOfPiece(state, p)]!.playerId !== state.sides?.[p]) throw new Error(`${p} isn't who's seated`);
    if (state.turn !== moveBy(state.moves.length)) throw new Error("the wrong side to move");
    if (anyFive(state.board, n)) throw new Error("five in a row while playing");
    if (!state.board.includes(".")) throw new Error("a full board while playing");
    if (state.result) throw new Error("a result while playing");
    if (state.config.turnSeconds > 0 && state.timers.turn === undefined) throw new Error("no turn timer");
  }
  if (state.phase === "over" && !state.result) throw new Error("over without a result");
  if (state.result?.reason === "five" && !state.result.runs.length) throw new Error("a win without a line");
}

// --- views ---------------------------------------------------------------------

export interface LuffaView {
  config: LuffaConfig;
  /** The sheet is size × size squares. */
  size: number;
  seats: (LuffaSeat | null)[];
  phase: LuffaState["phase"];
  game: number;
  /** Who plays each piece this (or the last) game; "x" starts. */
  sides: { x: string; o: string } | null;
  /** The seat playing "x" this game; while waiting, in the next. */
  xSeat: Side;
  /** The seat that starts the next game (after this one ends). */
  nextXSeat: Side;
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
  draws: number;
  canRematch: boolean;
  you: { seat: Side | null; piece: Piece | null };
}

export function viewFor(state: LuffaState, viewer: string): LuffaView {
  const n = boardSize(state);
  const seat = seatOf(state, viewer);
  const xSeat: Side = state.phase === "waiting" ? state.nextXSeat : state.xSeat;
  const last = state.moves.at(-1);
  const r = state.result;
  const cells = r && r.runs.length ? fiveThrough(state.board, n, state.moves.at(-1)!) : [];
  return {
    config: { size: state.config.size, turnSeconds: state.config.turnSeconds },
    size: n,
    seats: state.seats.map((s) => (s ? { playerId: s.playerId, sittingOut: s.sittingOut, wins: s.wins } : null)),
    phase: state.phase,
    game: state.game,
    sides: state.sides ? { x: state.sides.x, o: state.sides.o } : null,
    xSeat,
    nextXSeat: state.nextXSeat,
    board: state.board,
    rows: Array.from({ length: n }, (_, i) => state.board.slice(i * n, (i + 1) * n)),
    turn: state.turn,
    moves: state.moves.map((cell, i) => ({ by: moveBy(i), square: squareName(n, cell) })),
    lastMove: last === undefined ? null : { by: moveBy(state.moves.length - 1), square: squareName(n, last), cell: last },
    turnDeadline: state.phase === "playing" ? (state.timers.turn ?? null) : null,
    result: r ? { winner: r.winner, reason: r.reason, squares: cells.map((c) => squareName(n, c)), runs: r.runs.map(([a, b]) => [a, b] as [number, number]), cells } : null,
    draws: state.draws,
    canRematch: canRematch(state),
    you: { seat: seat < 0 ? null : (seat as Side), piece: seat < 0 ? null : seat === xSeat ? "x" : "o" },
  };
}
