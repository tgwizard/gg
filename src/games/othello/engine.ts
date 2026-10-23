/**
 * Othello for two, as a state machine around ./rules.
 *
 * The first game starts when both seats fill, and "Play again" starts the next with
 * colors swapped. Black moves first. Someone with no move passes, and the server does
 * that for them at once (it's never a choice), so the game only ever waits on a player
 * who can move. It ends when neither can: most discs wins. It can also end off the
 * board: resigning, running out of time, leaving. Leaving before you've moved calls
 * the game off.
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
import { type Color, count, flipsFor, legalMoves, other, parseSquare, play, squareName, START_BOARD } from "./rules";

/** Seat 0 or 1. */
export type Side = 0 | 1;
export type OthelloSeat = Seat & { wins: number };

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

export interface OthelloState extends Seating<OthelloSeat> {
  config: OthelloConfig;
  phase: "waiting" | "playing" | "over";
  game: number;
  /** The seat playing Black (who opens) this game; swaps every game. */
  blackSeat: Side;
  /** Who plays each color this (or the last) game, kept after they leave so the result can name them. */
  sides: { b: string; w: string } | null;
  board: string;
  turn: Color;
  moves: PlayedMove[];
  /** Milliseconds left on each clock, as of `clockSince` for the side to move. Null when untimed. */
  clock: { b: number; w: number } | null;
  clockSince: number;
  result: OthelloResult | null;
  draws: number;
  timers: Timers<"flag">;
}

export function createState(config: OthelloConfig): OthelloState {
  return {
    config,
    ...emptySeating<OthelloSeat>(2),
    phase: "waiting",
    game: 0,
    // Swapped as each game starts, so seat 0 has Black in the first.
    blackSeat: 1,
    sides: null,
    board: START_BOARD,
    turn: "b",
    moves: [],
    clock: null,
    clockSince: 0,
    result: null,
    draws: 0,
    timers: {},
  };
}

const bothSeated = (state: OthelloState) => state.seats.every(Boolean);
export const seatColor = (state: OthelloState, seat: number): Color => (seat === state.blackSeat ? "b" : "w");
const seatOfColor = (state: OthelloState, c: Color): Side => (c === "b" ? state.blackSeat : ((1 - state.blackSeat) as Side));
const hasMoved = (state: OthelloState, c: Color) => state.moves.some((m) => m.by === c && m.at !== null);

// --- seating -------------------------------------------------------------------

export function sit(state: OthelloState, playerId: string, seat: number, ctx: GameContext) {
  sitDown(state, playerId, seat, () => ({ wins: 0 }));
  if (state.phase === "waiting" && bothSeated(state)) startGame(state, ctx);
}

export function leave(state: OthelloState, playerId: string, ctx: GameContext) {
  const seat = requireSeat(state, playerId);
  if (state.phase === "playing") {
    const c = seatColor(state, seat);
    if (hasMoved(state, c)) finish(state, { winner: other(c), reason: "left", score: score(state) }, ctx);
    else {
      // Nothing lost yet: call it off, and the next game is this one again (same colors).
      state.phase = "waiting";
      state.blackSeat = (1 - state.blackSeat) as Side;
      state.game--;
      state.sides = null;
      setTimer(state.timers, "flag", null);
      ctx.announce(`The Othello game was called off: ${ctx.nameOf(playerId)} left before making a move.`);
    }
  }
  standUp(state, playerId);
}

export function rematch(state: OthelloState, actor: string, ctx: GameContext) {
  requireSeat(state, actor);
  if (state.phase !== "over") throw new GameError("in_progress", "A game is already on.");
  if (!bothSeated(state)) throw new GameError("not_enough_players", "Two players need to be seated.");
  startGame(state, ctx);
}

export const canRematch = (state: OthelloState) => state.phase === "over" && bothSeated(state);

function startGame(state: OthelloState, ctx: GameContext) {
  state.phase = "playing";
  state.game++;
  state.blackSeat = (1 - state.blackSeat) as Side;
  state.sides = { b: state.seats[state.blackSeat]!.playerId, w: state.seats[1 - state.blackSeat]!.playerId };
  state.board = START_BOARD;
  state.turn = "b";
  state.moves = [];
  const ms = state.config.minutes * 60_000;
  state.clock = ms > 0 ? { b: ms, w: ms } : null;
  state.clockSince = ctx.now;
  state.result = null;
  setFlag(state);
}

/** The side to move's clock runs out at its flag. */
function setFlag(state: OthelloState) {
  setTimer(state.timers, "flag", state.clock ? state.clockSince + state.clock[state.turn] : null);
}

/** Stop the side to move's clock now. */
function stopClock(state: OthelloState, now: number) {
  if (state.clock) state.clock[state.turn] = Math.max(0, state.clock[state.turn] - (now - state.clockSince));
  state.clockSince = now;
}

// --- playing -------------------------------------------------------------------

const score = (state: OthelloState) => {
  const { b, w } = count(state.board);
  return { b, w };
};

export function move(state: OthelloState, actor: string, square: string, ctx: GameContext) {
  const seat = requireSeat(state, actor);
  if (state.phase !== "playing") throw new GameError("not_playing", "There's no game on.");
  const c = seatColor(state, seat);
  if (state.turn !== c) throw new GameError("not_your_turn", "It's not your move.");
  const sq = parseSquare(square);
  if (sq === null || state.board[sq] !== ".") throw new GameError("illegal_move", "That square is taken.");
  if (!flipsFor(state.board, c, sq).length) throw new GameError("illegal_move", "A disc has to trap at least one of theirs in a line.");

  stopClock(state, ctx.now);
  if (state.clock) state.clock[c] += state.config.increment * 1000;
  const after = play(state.board, c, sq);
  state.board = after.board;
  state.moves.push({ by: c, at: sq, flips: after.flips });

  const them = other(c);
  if (legalMoves(state.board, them).length) state.turn = them;
  else if (legalMoves(state.board, c).length) {
    // They're stuck: they pass, and it's yours again.
    state.moves.push({ by: them, at: null, flips: [] });
  } else return finishOnBoard(state, ctx);
  setFlag(state);
}

function finishOnBoard(state: OthelloState, ctx: GameContext) {
  const s = score(state);
  finish(state, { winner: s.b > s.w ? "b" : s.w > s.b ? "w" : null, reason: "board", score: s }, ctx);
}

export function resign(state: OthelloState, actor: string, ctx: GameContext) {
  const seat = requireSeat(state, actor);
  if (state.phase !== "playing") throw new GameError("not_playing", "There's no game on.");
  finish(state, { winner: other(seatColor(state, seat)), reason: "resign", score: score(state) }, ctx);
}

function finish(state: OthelloState, result: OthelloResult, ctx: GameContext) {
  stopClock(state, ctx.now);
  state.phase = "over";
  state.result = result;
  setTimer(state.timers, "flag", null);
  if (result.winner) {
    const seat = state.seats[seatOfColor(state, result.winner)];
    if (seat?.playerId === state.sides![result.winner]) seat.wins++;
  } else state.draws++;
  ctx.announce(`Othello game ${state.game}: ${resultText(result, (c) => ctx.nameOf(state.sides![c]))}`);
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
  if (state.phase !== "playing") return [];
  return [state.seats[seatOfColor(state, state.turn)]!.playerId];
}

export function checkInvariants(state: OthelloState) {
  if (!/^[bw.]{64}$/.test(state.board)) throw new Error("a malformed board");
  const placed = state.moves.filter((m) => m.at !== null);
  if (64 - count(state.board).empty !== 4 + placed.length) throw new Error("discs and moves out of step");
  if (placed.some((m) => state.board[m.at!] === ".")) throw new Error("a move on a square that's empty");
  if (state.clock && (state.clock.b < 0 || state.clock.w < 0)) throw new Error("negative clock");
  if (state.phase === "playing") {
    if (!bothSeated(state)) throw new Error("playing without two players");
    for (const c of ["b", "w"] as const) if (state.seats[seatOfColor(state, c)]!.playerId !== state.sides?.[c]) throw new Error(`${c} isn't who's seated`);
    if (!legalMoves(state.board, state.turn).length) throw new Error("waiting on a side that can't move");
    if (state.result) throw new Error("a result while playing");
  }
  if (state.phase === "over" && !state.result) throw new Error("over without a result");
}

// --- views ---------------------------------------------------------------------

export interface LastMove {
  by: Color;
  square: string;
  /** The discs it turned over, nearest first along each line. */
  flipped: string[];
}

export interface OthelloView {
  config: OthelloConfig;
  seats: (OthelloSeat | null)[];
  phase: OthelloState["phase"];
  game: number;
  /** Who plays each color this (or the last) game. */
  sides: { b: string; w: string } | null;
  /** The seat playing Black this (or the last) game; while waiting, in the next. */
  blackSeat: Side;
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
  draws: number;
  canRematch: boolean;
  you: { seat: Side | null; color: Color | null };
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
  const seat = seatOf(state, viewer);
  const blackSeat: Side = state.phase === "waiting" ? ((1 - state.blackSeat) as Side) : state.blackSeat;
  return {
    config: { minutes: state.config.minutes, increment: state.config.increment },
    seats: state.seats.map((s) => (s ? { playerId: s.playerId, sittingOut: s.sittingOut, wins: s.wins } : null)),
    phase: state.phase,
    game: state.game,
    sides: state.sides ? { b: state.sides.b, w: state.sides.w } : null,
    blackSeat,
    board: state.board,
    rows: Array.from({ length: 8 }, (_, r) => state.board.slice(r * 8, r * 8 + 8)),
    turn: state.turn,
    score: score(state),
    moves: state.moves.map((m) => ({ by: m.by, square: m.at === null ? null : squareName(m.at) })),
    ...lastMoveView(state.moves),
    clock: state.clock ? { b: state.clock.b, w: state.clock.w, since: state.clockSince, running: state.phase === "playing" ? state.turn : null } : null,
    result: state.result ? { winner: state.result.winner, reason: state.result.reason, score: { ...state.result.score } } : null,
    draws: state.draws,
    canRematch: canRematch(state),
    you: { seat: seat < 0 ? null : (seat as Side), color: seat < 0 ? null : seat === blackSeat ? "b" : "w" },
  };
}
