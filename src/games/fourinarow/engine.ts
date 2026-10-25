/**
 * Four in a Row for two, as a state machine around ./rules, at a kit duel table (two
 * seats, games in a series; see kit/duel). Whoever plays "x" drops the first disc; by
 * default that alternates every game, or (`opener: "loser"`) the loser of the last game
 * starts the next (after a draw it alternates). The first to line up four wins; a full
 * board is a draw. A game can also end off the board: resigning, running out of time,
 * leaving.
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

export type { Side };

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

export interface FourState extends Duel<Piece> {
  config: FourConfig;
  board: string;
  turn: Piece;
  moves: PlayedMove[];
  clock: { x: number; o: number } | null;
  clockSince: number;
  result: FourResult | null;
}

export const SPEC: DuelSpec<Piece> = { name: "Four in a Row", colors: ["x", "o"], loserOpens: (state) => (state as FourState).config.opener === "loser" };

export function createState(config: FourConfig): FourState {
  return { config, ...emptyDuel<Piece>(), board: emptyBoard(parseSize(config.board)), turn: "x", moves: [], clock: null, clockSince: 0, result: null };
}

export const sizeOf = (state: { config: FourConfig }): Size => parseSize(state.config.board);
const hasMoved = (state: FourState, p: Piece) => state.moves.some((m) => m.by === p);

// --- seating -------------------------------------------------------------------

export function sit(state: FourState, playerId: string, seat: number, ctx: GameContext) {
  if (sitDuel(state, playerId, seat)) startGame(state, ctx);
}

export function leave(state: FourState, playerId: string, ctx: GameContext) {
  leaveDuel(state, SPEC, playerId, ctx, {
    moved: (p) => hasMoved(state, p),
    forfeit: (p) => finish(state, { winner: other(p), reason: "left", line: [] }, ctx),
    calledOff: () => reset(state),
  });
}

export function rematch(state: FourState, actor: string, ctx: GameContext) {
  checkRematch(state, actor);
  startGame(state, ctx);
}

function reset(state: FourState) {
  state.board = emptyBoard(sizeOf(state));
  state.turn = "x";
  state.moves = [];
}

function startGame(state: FourState, ctx: GameContext) {
  beginDuel(state, SPEC);
  reset(state);
  state.result = null;
  fischer.start(state, SPEC, ctx.now);
}

// --- playing -------------------------------------------------------------------

/** Drop a disc in `column` (1 = the leftmost). */
export function move(state: FourState, actor: string, column: number, ctx: GameContext) {
  const p = actingColor(state, SPEC, actor, state.turn);
  const size = sizeOf(state);
  if (!Number.isInteger(column) || column < 1 || column > size.columns) throw new GameError("illegal_move", "There's no such column.");
  if (landing(state.board, size, column - 1) === null) throw new GameError("illegal_move", "That column is full.");

  fischer.stop(state, p, ctx.now, true);
  const after = drop(state.board, size, p, column - 1);
  state.board = after.board;
  state.moves.push({ by: p, cell: after.cell });

  const line = fourThrough(state.board, size, after.cell);
  if (line.length) return finish(state, { winner: p, reason: "four", line }, ctx);
  if (!state.board.includes(".")) return finish(state, { winner: null, reason: "full", line: [] }, ctx);
  state.turn = other(p);
  fischer.flag(state, state.turn);
}

export function resign(state: FourState, actor: string, ctx: GameContext) {
  const p = actingColor(state, SPEC, actor);
  finish(state, { winner: other(p), reason: "resign", line: [] }, ctx);
}

function finish(state: FourState, result: FourResult, ctx: GameContext) {
  fischer.stop(state, state.turn, ctx.now);
  state.result = result;
  endDuel(state, SPEC, result.winner, resultText(result, (p) => ctx.nameOf(state.sides![p])), ctx);
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
  return state.phase === "playing" ? waitingOnColor(state, SPEC, state.turn) : [];
}

export function checkInvariants(state: FourState) {
  checkDuel(state, SPEC);
  fischer.check(state);
  const size = sizeOf(state);
  if (state.board.length !== size.columns * size.rows || !/^[xo.]+$/.test(state.board)) throw new Error("a malformed board");
  if (!settled(state.board, size)) throw new Error("a disc floating over an empty cell");
  const n = count(state.board);
  if (n.x + n.o !== state.moves.length) throw new Error("discs and moves out of step");
  if (n.x !== n.o && n.x !== n.o + 1) throw new Error("x and o out of step");
  if (state.moves.some((m, i) => m.by !== (i % 2 ? "o" : "x") || state.board[m.cell] !== m.by)) throw new Error("a move that isn't on the board");
  if (state.phase === "playing") {
    if (state.turn !== (n.x === n.o ? "x" : "o")) throw new Error("the wrong side to move");
    if (anyFour(state.board, size)) throw new Error("four in a row while playing");
    if (!state.board.includes(".")) throw new Error("a full board while playing");
  }
  if (state.result?.reason === "four" && state.result.line.length < 4) throw new Error("a win without a line");
}

// --- views ---------------------------------------------------------------------

/** A cell as players name it: column 1 is the left, row 1 the bottom. */
export interface Spot {
  column: number;
  row: number;
}

export interface FourView extends DuelView<Piece> {
  config: FourConfig;
  size: Size;
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
}

export const spot = (size: Size, cell: number): Spot => ({ column: colOf(size, cell) + 1, row: rowNumber(size, cell) });

export function viewFor(state: FourState, viewer: string): FourView {
  const size = sizeOf(state);
  const last = state.moves.at(-1);
  return {
    ...duelView(state, SPEC, viewer),
    config: { board: state.config.board, opener: state.config.opener, minutes: state.config.minutes, increment: state.config.increment },
    size: { columns: size.columns, rows: size.rows },
    board: state.board,
    rows: Array.from({ length: size.rows }, (_, r) => state.board.slice(r * size.columns, (r + 1) * size.columns)),
    turn: state.turn,
    moves: state.moves.map((m) => ({ by: m.by, column: colOf(size, m.cell) + 1 })),
    lastMove: last ? { by: last.by, ...spot(size, last.cell), cell: last.cell } : null,
    clock: fischer.view(state, state.phase === "playing" ? state.turn : null),
    result: state.result
      ? { winner: state.result.winner, reason: state.result.reason, line: state.result.line.map((c) => spot(size, c)), cells: [...state.result.line] }
      : null,
  };
}
