/**
 * Chess for two, as a state machine around ./rules.
 *
 * The first game starts when both seats fill, and "Play again" starts the next with
 * colors swapped. Games end on the board (checkmate, stalemate, threefold repetition,
 * the fifty-move rule, too little material to mate) or off it (resigning, a draw
 * agreed, running out of time, leaving). Leaving before you've moved calls the game off.
 *
 * Clocks: each side has `minutes` and gains `increment` seconds per move, Fischer
 * style. Only the side to move runs down; its flag is a timer. Running out loses,
 * unless the other side has nothing but a king, which can't win: then it's a draw.
 * With `minutes` 0 there's no clock.
 *
 * Nothing is hidden, but the view is still built field by field.
 */
import { emptySeating, requireSeat, type Seat, type Seating, seatOf, sitDown, standUp } from "../kit/seating";
import { nextTimer, setTimer, takeDueTimer, type Timers } from "../kit/timers";
import { type GameContext, GameError } from "../types";
import {
  type Color,
  colorOf,
  inCheck,
  insufficientMaterial,
  kingSquare,
  legalMoves,
  loneKing,
  makeMove,
  moveFacts,
  other,
  parseFen,
  parseUci,
  type PieceType,
  type Position,
  positionKey,
  sameMove,
  squareName,
  START_FEN,
  toFen,
  toSan,
  toUci,
} from "./rules";

/** Seat 0 or 1. */
export type Side = 0 | 1;
export type ChessSeat = Seat & { wins: number };

export interface ChessConfig {
  /** Minutes on each clock; 0 = no clock. */
  minutes: number;
  /** Seconds added to your clock for each move you make. */
  increment: number;
}

export type EndReason =
  | "checkmate"
  | "resign"
  | "timeout"
  | "left"
  | "stalemate"
  | "repetition"
  | "fifty"
  | "material"
  | "agreement"
  /** Out of time, but the other side couldn't have mated. */
  | "timeoutDraw";

export interface ChessResult {
  winner: Color | null;
  reason: EndReason;
}

export interface PlayedMove {
  uci: string;
  san: string;
  piece: PieceType;
  /** What it took, and on which square (en passant takes beside where it lands). */
  took: PieceType | null;
  tookAt: number | null;
}

export interface ChessState extends Seating<ChessSeat> {
  config: ChessConfig;
  phase: "waiting" | "playing" | "over";
  game: number;
  /** The seat playing White this game; swaps every game. */
  whiteSeat: Side;
  /** Who plays each color this (or the last) game, kept after they leave so the result can name them. */
  sides: { w: string; b: string } | null;
  fen: string;
  moves: PlayedMove[];
  /** Positions since the last capture or pawn move (none can come back past those), for threefold repetition. */
  positions: string[];
  /** Milliseconds left on each clock, as of `clockSince` for the side to move. Null when untimed. */
  clock: { w: number; b: number } | null;
  clockSince: number;
  /** A standing draw offer, by color. */
  drawOffer: Color | null;
  /** The move count when each color last offered a draw: one offer per move. */
  offeredAt: { w: number; b: number };
  result: ChessResult | null;
  draws: number;
  timers: Timers<"flag">;
}

export function createState(config: ChessConfig): ChessState {
  return {
    config,
    ...emptySeating<ChessSeat>(2),
    phase: "waiting",
    game: 0,
    // Swapped as each game starts, so seat 0 has White in the first.
    whiteSeat: 1,
    sides: null,
    fen: START_FEN,
    moves: [],
    positions: [],
    clock: null,
    clockSince: 0,
    drawOffer: null,
    offeredAt: { w: -1, b: -1 },
    result: null,
    draws: 0,
    timers: {},
  };
}

const bothSeated = (state: ChessState) => state.seats.every(Boolean);
export const seatColor = (state: ChessState, seat: number): Color => (seat === state.whiteSeat ? "w" : "b");
const seatOfColor = (state: ChessState, c: Color): Side => (c === "w" ? state.whiteSeat : ((1 - state.whiteSeat) as Side));
const position = (state: ChessState): Position => parseFen(state.fen);

// --- seating -------------------------------------------------------------------

export function sit(state: ChessState, playerId: string, seat: number, ctx: GameContext) {
  sitDown(state, playerId, seat, () => ({ wins: 0 }));
  if (state.phase === "waiting" && bothSeated(state)) startGame(state, ctx);
}

export function leave(state: ChessState, playerId: string, ctx: GameContext) {
  const seat = requireSeat(state, playerId);
  if (state.phase === "playing") {
    const c = seatColor(state, seat);
    const moved = state.moves.length > (c === "w" ? 0 : 1);
    if (moved) finish(state, { winner: other(c), reason: "left" }, ctx);
    else {
      // Nothing lost yet: call it off, and the next game is this one again (same colors).
      state.phase = "waiting";
      state.whiteSeat = (1 - state.whiteSeat) as Side;
      state.game--;
      state.sides = null;
      state.drawOffer = null;
      setTimer(state.timers, "flag", null);
      ctx.announce(`The chess game was called off: ${ctx.nameOf(playerId)} left before making a move.`);
    }
  }
  standUp(state, playerId);
}

export function rematch(state: ChessState, actor: string, ctx: GameContext) {
  requireSeat(state, actor);
  if (state.phase !== "over") throw new GameError("in_progress", "A game is already on.");
  if (!bothSeated(state)) throw new GameError("not_enough_players", "Two players need to be seated.");
  startGame(state, ctx);
}

export const canRematch = (state: ChessState) => state.phase === "over" && bothSeated(state);

function startGame(state: ChessState, ctx: GameContext) {
  state.phase = "playing";
  state.game++;
  state.whiteSeat = (1 - state.whiteSeat) as Side;
  state.sides = { w: state.seats[state.whiteSeat]!.playerId, b: state.seats[1 - state.whiteSeat]!.playerId };
  const pos = parseFen(START_FEN);
  state.fen = START_FEN;
  state.moves = [];
  state.positions = [positionKey(pos)];
  const ms = state.config.minutes * 60_000;
  state.clock = ms > 0 ? { w: ms, b: ms } : null;
  state.clockSince = ctx.now;
  state.drawOffer = null;
  state.offeredAt = { w: -1, b: -1 };
  state.result = null;
  setFlag(state, "w");
}

/** The side to move's clock runs out at its flag. */
function setFlag(state: ChessState, turn: Color) {
  setTimer(state.timers, "flag", state.clock ? state.clockSince + state.clock[turn] : null);
}

/** Stop the side to move's clock now. */
function stopClock(state: ChessState, turn: Color, now: number) {
  if (state.clock) state.clock[turn] = Math.max(0, state.clock[turn] - (now - state.clockSince));
  state.clockSince = now;
}

// --- playing -------------------------------------------------------------------

/** The actor's color in a game that's on. */
function playingColor(state: ChessState, actor: string): Color {
  const seat = requireSeat(state, actor);
  if (state.phase !== "playing") throw new GameError("not_playing", "There's no game on.");
  return seatColor(state, seat);
}

export function move(state: ChessState, actor: string, uci: string, ctx: GameContext) {
  const c = playingColor(state, actor);
  const pos = position(state);
  if (pos.turn !== c) throw new GameError("not_your_turn", "It's not your move.");
  const m = parseUci(uci);
  const legal = legalMoves(pos);
  const found = m && legal.find((l) => sameMove(l, m));
  if (!found) {
    const promotes = m && !m.promotion && legal.some((l) => l.from === m.from && l.to === m.to && l.promotion);
    throw new GameError("illegal_move", promotes ? "Say which piece the pawn becomes." : "That move isn't allowed.");
  }

  stopClock(state, c, ctx.now);
  if (state.clock) state.clock[c] += state.config.increment * 1000;
  const san = toSan(pos, found, legal);
  const next = makeMove(pos, found);
  state.fen = toFen(next);
  state.moves.push({ uci: toUci(found), san, ...moveFacts(pos, found) });
  const key = positionKey(next);
  state.positions = next.halfmove === 0 ? [key] : [...state.positions, key];
  // Moving turns down the other side's offer; your own stands until they've replied.
  if (state.drawOffer !== c) state.drawOffer = null;

  const replies = legalMoves(next);
  if (!replies.length) return finish(state, inCheck(next) ? { winner: c, reason: "checkmate" } : { winner: null, reason: "stalemate" }, ctx);
  if (insufficientMaterial(next.board)) return finish(state, { winner: null, reason: "material" }, ctx);
  if (state.positions.filter((k) => k === key).length >= 3) return finish(state, { winner: null, reason: "repetition" }, ctx);
  if (next.halfmove >= 100) return finish(state, { winner: null, reason: "fifty" }, ctx);
  setFlag(state, next.turn);
}

export function resign(state: ChessState, actor: string, ctx: GameContext) {
  const c = playingColor(state, actor);
  finish(state, { winner: other(c), reason: "resign" }, ctx);
}

export function canOfferDraw(state: ChessState, c: Color) {
  return state.phase === "playing" && state.drawOffer === null && state.offeredAt[c] < state.moves.length;
}

export function offerDraw(state: ChessState, actor: string, ctx: GameContext) {
  const c = playingColor(state, actor);
  // Offering back when they've offered is agreeing.
  if (state.drawOffer === other(c)) return finish(state, { winner: null, reason: "agreement" }, ctx);
  if (state.drawOffer === c) throw new GameError("already_offered", "Your draw offer is standing.");
  if (!canOfferDraw(state, c)) throw new GameError("already_offered", "You can offer a draw again after the next move.");
  state.drawOffer = c;
  state.offeredAt[c] = state.moves.length;
}

export function answerDraw(state: ChessState, actor: string, accept: boolean, ctx: GameContext) {
  const c = playingColor(state, actor);
  if (state.drawOffer !== other(c)) throw new GameError("no_offer", "Nobody's offering a draw.");
  if (accept) finish(state, { winner: null, reason: "agreement" }, ctx);
  else state.drawOffer = null;
}

function finish(state: ChessState, result: ChessResult, ctx: GameContext) {
  stopClock(state, position(state).turn, ctx.now);
  state.phase = "over";
  state.result = result;
  state.drawOffer = null;
  setTimer(state.timers, "flag", null);
  if (result.winner) {
    const seat = state.seats[seatOfColor(state, result.winner)];
    if (seat?.playerId === state.sides![result.winner]) seat.wins++;
  } else state.draws++;
  const name = (c: Color) => ctx.nameOf(state.sides![c]);
  ctx.announce(`Chess game ${state.game}: ${resultText(result, name)}`);
}

/** "Alice wins by checkmate." / "Draw by repetition." */
export function resultText(result: ChessResult, name: (c: Color) => string): string {
  if (!result.winner) {
    const why: Partial<Record<EndReason, string>> = {
      stalemate: "Stalemate: a draw.",
      repetition: "Draw by threefold repetition.",
      fifty: "Draw by the fifty-move rule.",
      material: "Draw: neither side can mate.",
      agreement: "Draw agreed.",
      timeoutDraw: "Out of time, but a lone king can't win: a draw.",
    };
    return why[result.reason] ?? "A draw.";
  }
  const loser = name(other(result.winner));
  const how: Partial<Record<EndReason, string>> = {
    checkmate: "by checkmate",
    resign: `(${loser} resigned)`,
    timeout: `on time (${loser} ran out)`,
    left: `(${loser} left the board)`,
  };
  return `${name(result.winner)} wins ${how[result.reason] ?? ""}.`.replace(" .", ".");
}

// --- timers --------------------------------------------------------------------

export function nextDeadline(state: ChessState): number | null {
  return nextTimer(state.timers);
}

export function onDeadline(state: ChessState, ctx: GameContext) {
  const due = takeDueTimer(state.timers, ctx.now);
  if (due !== "flag" || state.phase !== "playing" || !state.clock) return;
  const pos = position(state);
  const late = pos.turn;
  finish(state, loneKing(pos.board, other(late)) ? { winner: null, reason: "timeoutDraw" } : { winner: other(late), reason: "timeout" }, ctx);
  state.clock[late] = 0;
}

// --- who and what --------------------------------------------------------------

export function waitingOn(state: ChessState): string[] {
  if (state.phase !== "playing") return [];
  return [state.seats[seatOfColor(state, position(state).turn)]!.playerId];
}

export function checkInvariants(state: ChessState) {
  const pos = position(state);
  for (const c of ["w", "b"] as const) {
    if (pos.board.filter((p) => p === (c === "w" ? "K" : "k")).length !== 1) throw new Error(`${c} needs exactly one king`);
  }
  if (pos.board.some((p, sq) => p && (p === "P" || p === "p") && (sq < 8 || sq >= 56))) throw new Error("a pawn on the first or last rank");
  const them = other(pos.turn);
  if (pos.board.some((p) => p && colorOf(p) === them) && kingSquare(pos.board, them) >= 0 && inCheck({ ...pos, turn: them })) {
    throw new Error("the side that just moved is in check");
  }
  if (state.moves.length !== (pos.fullmove - 1) * 2 + (pos.turn === "b" ? 1 : 0)) throw new Error("moves and position out of step");
  if (state.phase !== "waiting" && state.positions.at(-1) !== positionKey(pos)) throw new Error("repetition history out of step");
  if (state.clock && (state.clock.w < 0 || state.clock.b < 0)) throw new Error("negative clock");
  if (state.phase === "playing") {
    if (!bothSeated(state)) throw new Error("playing without two players");
    for (const c of ["w", "b"] as const) if (state.seats[seatOfColor(state, c)]!.playerId !== state.sides?.[c]) throw new Error(`${c} isn't who's seated`);
    if (state.result) throw new Error("a result while playing");
  }
  if (state.phase === "over" && !state.result) throw new Error("over without a result");
  if (state.drawOffer && state.phase !== "playing") throw new Error("a draw offer outside a game");
}

// --- views ---------------------------------------------------------------------

export interface ChessView {
  config: ChessConfig;
  seats: (ChessSeat | null)[];
  phase: ChessState["phase"];
  game: number;
  /** Who plays each color this (or the last) game. */
  sides: { w: string; b: string } | null;
  /** The seat playing White this (or the last) game; while waiting, in the next. */
  whiteSeat: Side;
  fen: string;
  /** The board as 8 rows, rank 8 first, "." for an empty square (as FEN letters, White uppercase). */
  board: string[];
  turn: Color;
  check: boolean;
  /** Every move so far, in SAN, with the piece it took. */
  moves: { san: string; took?: PieceType }[];
  lastMove: LastMove | null;
  /** Milliseconds left on each clock as of `since`; the `running` side's has been ticking since then. */
  clock: { w: number; b: number; since: number; running: Color | null } | null;
  drawOffer: Color | null;
  result: ChessResult | null;
  draws: number;
  canRematch: boolean;
  you: { seat: Side | null; color: Color | null; canOfferDraw: boolean };
}

export interface LastMove {
  /** In UCI ("e2e4"). */
  uci: string;
  san: string;
  piece: PieceType;
  took: PieceType | null;
  /** The square of the piece it took. */
  tookAt: string | null;
}

export function lastMoveView(m: PlayedMove | undefined): LastMove | null {
  if (!m) return null;
  return { uci: m.uci, san: m.san, piece: m.piece, took: m.took, tookAt: m.tookAt === null ? null : squareName(m.tookAt) };
}

export function viewFor(state: ChessState, viewer: string): ChessView {
  const seat = seatOf(state, viewer);
  const pos = position(state);
  const whiteSeat: Side = state.phase === "waiting" ? ((1 - state.whiteSeat) as Side) : state.whiteSeat;
  const color: Color | null = seat < 0 ? null : seat === whiteSeat ? "w" : "b";
  const rows: string[] = [];
  for (let r = 7; r >= 0; r--) rows.push(pos.board.slice(r * 8, r * 8 + 8).map((p) => p ?? ".").join(""));
  return {
    config: { minutes: state.config.minutes, increment: state.config.increment },
    seats: state.seats.map((s) => (s ? { playerId: s.playerId, sittingOut: s.sittingOut, wins: s.wins } : null)),
    phase: state.phase,
    game: state.game,
    sides: state.sides ? { w: state.sides.w, b: state.sides.b } : null,
    whiteSeat,
    fen: state.fen,
    board: rows,
    turn: pos.turn,
    check: inCheck(pos),
    moves: state.moves.map((m) => (m.took ? { san: m.san, took: m.took } : { san: m.san })),
    lastMove: lastMoveView(state.moves.at(-1)),
    clock: state.clock ? { w: state.clock.w, b: state.clock.b, since: state.clockSince, running: state.phase === "playing" ? pos.turn : null } : null,
    drawOffer: state.drawOffer,
    result: state.result ? { winner: state.result.winner, reason: state.result.reason } : null,
    draws: state.draws,
    canRematch: canRematch(state),
    you: { seat: seat < 0 ? null : (seat as Side), color, canOfferDraw: color !== null && state.phase === "playing" && canOfferDraw(state, color) },
  };
}
