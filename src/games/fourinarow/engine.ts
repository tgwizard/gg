/**
 * Four in a Row for two, as a state machine around ./rules.
 *
 * Built like Othello: the first game starts when both seats fill, and "Play again"
 * starts the next. Whoever plays "x" drops the first disc; by default that alternates
 * every game, or (`opener: "loser"`) the loser of the last game starts the next (after a
 * draw it alternates). The first to line up four wins; a full board is a draw. A game
 * can also end off the board: resigning, running out of time, leaving. Leaving before
 * you've dropped a disc calls the game off.
 *
 * Clocks work like chess clocks: each side has `minutes` and gains `increment` seconds
 * per move, and only the side to move runs down; its flag is a timer. With `minutes` 0
 * there's no clock.
 *
 * Nothing is hidden, but the view is still built field by field.
 */
import { emptySeating, requireSeat, type Seat, type Seating, seatOf, sitDown, standUp } from "../kit/seating";
import { nextTimer, setTimer, takeDueTimer, type Timers } from "../kit/timers";
import { type GameContext, GameError } from "../types";
import {
  anyFour,
  colOf,
  count,
  drop,
  emptyBoard,
  fourThrough,
  landing,
  other,
  parseSize,
  type Piece,
  rowNumber,
  settled,
  type Size,
  type SizeName,
} from "./rules";

/** Seat 0 or 1. */
export type Side = 0 | 1;
export type FourSeat = Seat & { wins: number };

export interface FourConfig {
  board: SizeName;
  /** Who drops the first disc of the next game: take turns, or the last game's loser. */
  opener: "alternate" | "loser";
  /** Minutes on each clock; 0 = no clock. */
  minutes: number;
  /** Seconds added to your clock for each move you make. */
  increment: number;
}

export type EndReason = "four" | "full" | "resign" | "timeout" | "left";

export interface FourResult {
  /** Null for a draw (a full board). */
  winner: Piece | null;
  reason: EndReason;
  /** The winning discs (every disc in a line of four or more through the last one), as cells; empty unless `reason` is "four". */
  line: number[];
}

export interface PlayedMove {
  by: Piece;
  /** The cell the disc landed on. */
  cell: number;
}

export interface FourState extends Seating<FourSeat> {
  config: FourConfig;
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
  moves: PlayedMove[];
  /** Milliseconds left on each clock, as of `clockSince` for the side to move. Null when untimed. */
  clock: { x: number; o: number } | null;
  clockSince: number;
  result: FourResult | null;
  draws: number;
  timers: Timers<"flag">;
}

export function createState(config: FourConfig): FourState {
  const size = parseSize(config.board);
  return {
    config,
    ...emptySeating<FourSeat>(2),
    phase: "waiting",
    game: 0,
    xSeat: 0,
    nextXSeat: 0,
    sides: null,
    board: emptyBoard(size),
    turn: "x",
    moves: [],
    clock: null,
    clockSince: 0,
    result: null,
    draws: 0,
    timers: {},
  };
}

export const sizeOf = (state: { config: FourConfig }): Size => parseSize(state.config.board);
const bothSeated = (state: FourState) => state.seats.every(Boolean);
export const seatPiece = (state: FourState, seat: number): Piece => (seat === state.xSeat ? "x" : "o");
const seatOfPiece = (state: FourState, p: Piece): Side => (p === "x" ? state.xSeat : ((1 - state.xSeat) as Side));
const hasMoved = (state: FourState, p: Piece) => state.moves.some((m) => m.by === p);

// --- seating -------------------------------------------------------------------

export function sit(state: FourState, playerId: string, seat: number, ctx: GameContext) {
  sitDown(state, playerId, seat, () => ({ wins: 0 }));
  if (state.phase === "waiting" && bothSeated(state)) startGame(state, ctx);
}

export function leave(state: FourState, playerId: string, ctx: GameContext) {
  const seat = requireSeat(state, playerId);
  if (state.phase === "playing") {
    const p = seatPiece(state, seat);
    if (hasMoved(state, p)) finish(state, { winner: other(p), reason: "left", line: [] }, ctx);
    else {
      // Nothing lost yet: call it off, and the next game is this one again (the same opener).
      state.phase = "waiting";
      state.nextXSeat = state.xSeat;
      state.game--;
      state.sides = null;
      state.board = emptyBoard(sizeOf(state));
      state.moves = [];
      state.turn = "x";
      setTimer(state.timers, "flag", null);
      ctx.announce(`The Four in a Row game was called off: ${ctx.nameOf(playerId)} left before making a move.`);
    }
  }
  standUp(state, playerId);
}

export function rematch(state: FourState, actor: string, ctx: GameContext) {
  requireSeat(state, actor);
  if (state.phase !== "over") throw new GameError("in_progress", "A game is already on.");
  if (!bothSeated(state)) throw new GameError("not_enough_players", "Two players need to be seated.");
  startGame(state, ctx);
}

export const canRematch = (state: FourState) => state.phase === "over" && bothSeated(state);

function startGame(state: FourState, ctx: GameContext) {
  state.phase = "playing";
  state.game++;
  state.xSeat = state.nextXSeat;
  state.sides = { x: state.seats[state.xSeat]!.playerId, o: state.seats[1 - state.xSeat]!.playerId };
  state.board = emptyBoard(sizeOf(state));
  state.turn = "x";
  state.moves = [];
  const ms = state.config.minutes * 60_000;
  state.clock = ms > 0 ? { x: ms, o: ms } : null;
  state.clockSince = ctx.now;
  state.result = null;
  setFlag(state);
}

/** The side to move's clock runs out at its flag. */
function setFlag(state: FourState) {
  setTimer(state.timers, "flag", state.clock ? state.clockSince + state.clock[state.turn] : null);
}

/** Stop the side to move's clock now. */
function stopClock(state: FourState, now: number) {
  if (state.clock) state.clock[state.turn] = Math.max(0, state.clock[state.turn] - (now - state.clockSince));
  state.clockSince = now;
}

// --- playing -------------------------------------------------------------------

/** Drop a disc in `column` (1 = the leftmost). */
export function move(state: FourState, actor: string, column: number, ctx: GameContext) {
  const seat = requireSeat(state, actor);
  if (state.phase !== "playing") throw new GameError("not_playing", "There's no game on.");
  const p = seatPiece(state, seat);
  if (state.turn !== p) throw new GameError("not_your_turn", "It's not your move.");
  const size = sizeOf(state);
  if (!Number.isInteger(column) || column < 1 || column > size.columns) throw new GameError("illegal_move", "There's no such column.");
  if (landing(state.board, size, column - 1) === null) throw new GameError("illegal_move", "That column is full.");

  stopClock(state, ctx.now);
  if (state.clock) state.clock[p] += state.config.increment * 1000;
  const after = drop(state.board, size, p, column - 1);
  state.board = after.board;
  state.moves.push({ by: p, cell: after.cell });

  const line = fourThrough(state.board, size, after.cell);
  if (line.length) return finish(state, { winner: p, reason: "four", line }, ctx);
  if (!state.board.includes(".")) return finish(state, { winner: null, reason: "full", line: [] }, ctx);
  state.turn = other(p);
  setFlag(state);
}

export function resign(state: FourState, actor: string, ctx: GameContext) {
  const seat = requireSeat(state, actor);
  if (state.phase !== "playing") throw new GameError("not_playing", "There's no game on.");
  finish(state, { winner: other(seatPiece(state, seat)), reason: "resign", line: [] }, ctx);
}

function finish(state: FourState, result: FourResult, ctx: GameContext) {
  stopClock(state, ctx.now);
  state.phase = "over";
  state.result = result;
  setTimer(state.timers, "flag", null);
  if (result.winner) {
    const seat = state.seats[seatOfPiece(state, result.winner)];
    if (seat?.playerId === state.sides![result.winner]) seat.wins++;
  } else state.draws++;
  // Who starts the next game: the loser, or else the other seat.
  const loser = result.winner && seatOfPiece(state, other(result.winner));
  state.nextXSeat = state.config.opener === "loser" && loser !== null ? loser : ((1 - state.xSeat) as Side);
  ctx.announce(`Four in a Row game ${state.game}: ${resultText(result, (p) => ctx.nameOf(state.sides![p]))}`);
}

/** "Alice wins with four in a row." / "A draw: the board is full." */
export function resultText(result: Pick<FourResult, "winner" | "reason">, name: (p: Piece) => string): string {
  if (!result.winner) return "A draw: the board is full.";
  const loser = name(other(result.winner));
  const how: Record<EndReason, string> = {
    four: " with four in a row",
    full: "",
    resign: ` (${loser} resigned)`,
    timeout: ` on time (${loser} ran out)`,
    left: ` (${loser} left the board)`,
  };
  return `${name(result.winner)} wins${how[result.reason]}.`;
}

// --- timers --------------------------------------------------------------------

export function nextDeadline(state: FourState): number | null {
  return nextTimer(state.timers);
}

export function onDeadline(state: FourState, ctx: GameContext) {
  const due = takeDueTimer(state.timers, ctx.now);
  if (due !== "flag" || state.phase !== "playing" || !state.clock) return;
  const late = state.turn;
  finish(state, { winner: other(late), reason: "timeout", line: [] }, ctx);
  state.clock[late] = 0;
}

// --- who and what --------------------------------------------------------------

export function waitingOn(state: FourState): string[] {
  if (state.phase !== "playing") return [];
  return [state.seats[seatOfPiece(state, state.turn)]!.playerId];
}

export function checkInvariants(state: FourState) {
  const size = sizeOf(state);
  if (state.board.length !== size.columns * size.rows || !/^[xo.]+$/.test(state.board)) throw new Error("a malformed board");
  if (!settled(state.board, size)) throw new Error("a disc floating over an empty cell");
  const n = count(state.board);
  if (n.x + n.o !== state.moves.length) throw new Error("discs and moves out of step");
  if (n.x !== n.o && n.x !== n.o + 1) throw new Error("x and o out of step");
  if (state.moves.some((m, i) => m.by !== (i % 2 ? "o" : "x") || state.board[m.cell] !== m.by)) throw new Error("a move that isn't on the board");
  if (state.clock && (state.clock.x < 0 || state.clock.o < 0)) throw new Error("negative clock");
  if (state.phase === "playing") {
    if (!bothSeated(state)) throw new Error("playing without two players");
    for (const p of ["x", "o"] as const) if (state.seats[seatOfPiece(state, p)]!.playerId !== state.sides?.[p]) throw new Error(`${p} isn't who's seated`);
    if (state.turn !== (n.x === n.o ? "x" : "o")) throw new Error("the wrong side to move");
    if (anyFour(state.board, size)) throw new Error("four in a row while playing");
    if (!state.board.includes(".")) throw new Error("a full board while playing");
    if (state.result) throw new Error("a result while playing");
  }
  if (state.phase === "over" && !state.result) throw new Error("over without a result");
  if (state.result?.reason === "four" && state.result.line.length < 4) throw new Error("a win without a line");
}

// --- views ---------------------------------------------------------------------

/** A cell as players name it: column 1 is the left, row 1 the bottom. */
export interface Spot {
  column: number;
  row: number;
}

export interface FourView {
  config: FourConfig;
  size: Size;
  seats: (FourSeat | null)[];
  phase: FourState["phase"];
  game: number;
  /** Who plays each piece this (or the last) game; "x" starts. */
  sides: { x: string; o: string } | null;
  /** The seat playing "x" this game; while waiting, in the next. */
  xSeat: Side;
  /** The seat that starts the next game (after this one ends). */
  nextXSeat: Side;
  /** columns × rows cells, row by row from the top left: "x", "o" or ".". */
  board: string;
  /** The same as strings, the top row first (so the last string is the bottom row, row 1). */
  rows: string[];
  turn: Piece;
  /** Every move so far, as the column dropped into. */
  moves: { by: Piece; column: number }[];
  /** The last disc dropped, where it landed. */
  lastMove: (Spot & { by: Piece; cell: number }) | null;
  /** Milliseconds left on each clock as of `since`; the `running` side's has been ticking since then. */
  clock: { x: number; o: number; since: number; running: Piece | null } | null;
  result: { winner: Piece | null; reason: EndReason; line: Spot[]; cells: number[] } | null;
  draws: number;
  canRematch: boolean;
  you: { seat: Side | null; piece: Piece | null };
}

export const spot = (size: Size, cell: number): Spot => ({ column: colOf(size, cell) + 1, row: rowNumber(size, cell) });

export function viewFor(state: FourState, viewer: string): FourView {
  const size = sizeOf(state);
  const seat = seatOf(state, viewer);
  const xSeat: Side = state.phase === "waiting" ? state.nextXSeat : state.xSeat;
  const last = state.moves.at(-1);
  return {
    config: { board: state.config.board, opener: state.config.opener, minutes: state.config.minutes, increment: state.config.increment },
    size: { columns: size.columns, rows: size.rows },
    seats: state.seats.map((s) => (s ? { playerId: s.playerId, sittingOut: s.sittingOut, wins: s.wins } : null)),
    phase: state.phase,
    game: state.game,
    sides: state.sides ? { x: state.sides.x, o: state.sides.o } : null,
    xSeat,
    nextXSeat: state.nextXSeat,
    board: state.board,
    rows: Array.from({ length: size.rows }, (_, r) => state.board.slice(r * size.columns, (r + 1) * size.columns)),
    turn: state.turn,
    moves: state.moves.map((m) => ({ by: m.by, column: colOf(size, m.cell) + 1 })),
    lastMove: last ? { by: last.by, ...spot(size, last.cell), cell: last.cell } : null,
    clock: state.clock ? { x: state.clock.x, o: state.clock.o, since: state.clockSince, running: state.phase === "playing" ? state.turn : null } : null,
    result: state.result
      ? { winner: state.result.winner, reason: state.result.reason, line: state.result.line.map((c) => spot(size, c)), cells: [...state.result.line] }
      : null,
    draws: state.draws,
    canRematch: canRematch(state),
    you: { seat: seat < 0 ? null : (seat as Side), piece: seat < 0 ? null : seat === xSeat ? "x" : "o" },
  };
}
