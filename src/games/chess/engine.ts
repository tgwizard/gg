/**
 * Chess for two, as a state machine around ./rules, at a kit duel table (two seats,
 * games in a series, colors swapping every game; see kit/duel).
 *
 * Games end on the board (checkmate, stalemate, threefold repetition, the fifty-move
 * rule, too little material to mate) or off it (resigning, a draw agreed, running out
 * of time, leaving).
 *
 * Clocks are chess clocks (kit/duel `fischer`). Running out loses, unless the other side
 * has nothing but a king, which can't win: then it's a draw.
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
  fischer,
  leaveDuel,
  type Side,
  sitDuel,
  waitingOnColor,
} from "../kit/duel";
import { nextTimer, takeDueTimer } from "../kit/timers";
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

export type { Side };

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

export interface ChessState extends Duel<Color> {
  config: ChessConfig;
  fen: string;
  moves: PlayedMove[];
  /** Positions since the last capture or pawn move (none can come back past those), for threefold repetition. */
  positions: string[];
  clock: { w: number; b: number } | null;
  clockSince: number;
  /** A standing draw offer, by color. */
  drawOffer: Color | null;
  /** The move count when each color last offered a draw: one offer per move. */
  offeredAt: { w: number; b: number };
  result: ChessResult | null;
}

export const SPEC: DuelSpec<Color> = { name: "Chess", colors: ["w", "b"] };

export function createState(config: ChessConfig): ChessState {
  return {
    config,
    ...emptyDuel<Color>(),
    fen: START_FEN,
    moves: [],
    positions: [],
    clock: null,
    clockSince: 0,
    drawOffer: null,
    offeredAt: { w: -1, b: -1 },
    result: null,
  };
}

const position = (state: ChessState): Position => parseFen(state.fen);

// --- seating -------------------------------------------------------------------

export function sit(state: ChessState, playerId: string, seat: number, ctx: GameContext) {
  if (sitDuel(state, playerId, seat)) startGame(state, ctx);
}

export function leave(state: ChessState, playerId: string, ctx: GameContext) {
  leaveDuel(state, SPEC, playerId, ctx, {
    moved: (c) => state.moves.length > (c === "w" ? 0 : 1),
    forfeit: (c) => finish(state, { winner: other(c), reason: "left" }, ctx),
    calledOff: () => {
      state.drawOffer = null;
    },
  });
}

export function rematch(state: ChessState, actor: string, ctx: GameContext) {
  checkRematch(state, actor);
  startGame(state, ctx);
}

function startGame(state: ChessState, ctx: GameContext) {
  beginDuel(state, SPEC);
  state.fen = START_FEN;
  state.moves = [];
  state.positions = [positionKey(parseFen(START_FEN))];
  state.drawOffer = null;
  state.offeredAt = { w: -1, b: -1 };
  state.result = null;
  fischer.start(state, SPEC, ctx.now);
}

// --- playing -------------------------------------------------------------------

export function move(state: ChessState, actor: string, uci: string, ctx: GameContext) {
  const pos = position(state);
  const c = actingColor(state, SPEC, actor, pos.turn);
  const m = parseUci(uci);
  const legal = legalMoves(pos);
  const found = m && legal.find((l) => sameMove(l, m));
  if (!found) {
    const promotes = m && !m.promotion && legal.some((l) => l.from === m.from && l.to === m.to && l.promotion);
    throw new GameError("illegal_move", promotes ? "Say which piece the pawn becomes." : "That move isn't allowed.");
  }

  fischer.stop(state, c, ctx.now, true);
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
  fischer.flag(state, next.turn);
}

export function resign(state: ChessState, actor: string, ctx: GameContext) {
  const c = actingColor(state, SPEC, actor);
  finish(state, { winner: other(c), reason: "resign" }, ctx);
}

export function canOfferDraw(state: ChessState, c: Color) {
  return state.phase === "playing" && state.drawOffer === null && state.offeredAt[c] < state.moves.length;
}

export function offerDraw(state: ChessState, actor: string, ctx: GameContext) {
  const c = actingColor(state, SPEC, actor);
  // Offering back when they've offered is agreeing.
  if (state.drawOffer === other(c)) return finish(state, { winner: null, reason: "agreement" }, ctx);
  if (state.drawOffer === c) throw new GameError("already_offered", "Your draw offer is standing.");
  if (!canOfferDraw(state, c)) throw new GameError("already_offered", "You can offer a draw again after the next move.");
  state.drawOffer = c;
  state.offeredAt[c] = state.moves.length;
}

export function answerDraw(state: ChessState, actor: string, accept: boolean, ctx: GameContext) {
  const c = actingColor(state, SPEC, actor);
  if (state.drawOffer !== other(c)) throw new GameError("no_offer", "Nobody's offering a draw.");
  if (accept) finish(state, { winner: null, reason: "agreement" }, ctx);
  else state.drawOffer = null;
}

function finish(state: ChessState, result: ChessResult, ctx: GameContext) {
  fischer.stop(state, position(state).turn, ctx.now);
  state.result = result;
  state.drawOffer = null;
  endDuel(state, SPEC, result.winner, resultText(result, (c) => ctx.nameOf(state.sides![c])), ctx);
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
  return state.phase === "playing" ? waitingOnColor(state, SPEC, position(state).turn) : [];
}

export function checkInvariants(state: ChessState) {
  checkDuel(state, SPEC);
  fischer.check(state);
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
  if (state.drawOffer && state.phase !== "playing") throw new Error("a draw offer outside a game");
}

// --- views ---------------------------------------------------------------------

export interface ChessView extends DuelView<Color> {
  config: ChessConfig;
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
  you: DuelView<Color>["you"] & { canOfferDraw: boolean };
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
  const table = duelView(state, SPEC, viewer);
  const pos = position(state);
  const color = table.you.color;
  const rows: string[] = [];
  for (let r = 7; r >= 0; r--) rows.push(pos.board.slice(r * 8, r * 8 + 8).map((p) => p ?? ".").join(""));
  return {
    ...table,
    config: { minutes: state.config.minutes, increment: state.config.increment },
    fen: state.fen,
    board: rows,
    turn: pos.turn,
    check: inCheck(pos),
    moves: state.moves.map((m) => (m.took ? { san: m.san, took: m.took } : { san: m.san })),
    lastMove: lastMoveView(state.moves.at(-1)),
    clock: fischer.view(state, state.phase === "playing" ? pos.turn : null),
    drawOffer: state.drawOffer,
    result: state.result ? { winner: state.result.winner, reason: state.result.reason } : null,
    you: { ...table.you, canOfferDraw: color !== null && state.phase === "playing" && canOfferDraw(state, color) },
  };
}
