/**
 * Go for two, as a state machine around ./rules.
 *
 * The first game starts when both seats fill, and "Play again" starts the next with
 * colors swapped. Black moves first; White gets komi. You play a stone or pass, and two
 * passes in a row end the play: the game goes to counting, where the server's guess at
 * the dead stones is shown, either player can mark a group dead or alive, and once both
 * accept the same marking the game is scored by area. Either can resume play instead,
 * to settle a disagreement on the board (the other side moves first). If counting goes
 * quiet for SETTLE_MS, the marking as it stands is scored.
 *
 * It can also end off the board: resigning, running out of time, leaving. Leaving
 * before you've moved calls the game off.
 *
 * Clocks are byo-yomi: `minutes` of main time, then `periods` periods of `seconds`
 * each. A move made within a period keeps it; letting one run out uses it up, and
 * running out of the last loses. Only the side to move runs down, and its flag (when it
 * would run out of everything) is a timer. Clocks stop while counting.
 *
 * Nothing is hidden, but the view is still built field by field.
 */
import { emptySeating, requireSeat, type Seat, type Seating, seatOf, sitDown, standUp } from "../kit/seating";
import { nextTimer, setTimer, takeDueTimer, type Timers } from "../kit/timers";
import { type GameContext, GameError } from "../types";
import { estimateDead } from "./montecarlo";
import {
  areaScore,
  type Color,
  chainAt,
  chains,
  emptyBoard,
  KOMI,
  other,
  parsePoint,
  pointName,
  positionKey,
  type Size,
  tryPlay,
} from "./rules";

export type Side = 0 | 1;
export type GoSeat = Seat & { wins: number };

export interface GoConfig {
  size: Size;
  /** Minutes of main time each; 0 with no periods = no clock. */
  minutes: number;
  /** Byo-yomi periods after the main time. */
  periods: number;
  /** Seconds per period. */
  seconds: number;
}

export type EndReason = "score" | "resign" | "timeout" | "left";

export interface GoResult {
  winner: Color;
  reason: EndReason;
  /** Points by area, White's with komi; null when it ended before counting. */
  score: { b: number; w: number } | null;
}

/** A stone played (with what it captured), or a pass (`at` null). */
export interface PlayedMove {
  by: Color;
  at: number | null;
  captured: number[];
}

export interface ByoClock {
  /** Main time left, in ms. */
  main: number;
  /** Byo-yomi periods left. */
  periods: number;
}

export interface GoState extends Seating<GoSeat> {
  config: GoConfig;
  phase: "waiting" | "playing" | "scoring" | "over";
  game: number;
  /** The seat playing Black this game; swaps every game. */
  blackSeat: Side;
  sides: { b: string; w: string } | null;
  board: string;
  turn: Color;
  moves: PlayedMove[];
  /** Every position this game has had, by `positionKey`, the current one last. */
  history: string[];
  /** Passes in a row; two go to counting. */
  passes: number;
  /** Stones each color has taken. */
  captures: { b: number; w: number };
  clock: { b: ByoClock; w: ByoClock } | null;
  clockSince: number;
  /** While counting (and after a counted game): the stones marked dead, and who's accepted that. */
  scoring: { dead: number[]; accepted: { b: boolean; w: boolean } } | null;
  result: GoResult | null;
  timers: Timers<"flag" | "settle">;
}

/** Counting with nobody changing or accepting anything for this long scores it as marked. */
export const SETTLE_MS = 3 * 60_000;
/** Playouts for the server's guess at the dead stones. */
const DEAD_PLAYOUTS: Record<Size, number> = { 9: 400, 13: 250, 19: 150 };

export function createState(config: GoConfig): GoState {
  const timed = config.minutes > 0 || (config.periods > 0 && config.seconds > 0);
  return {
    config: { ...config, ...(config.seconds > 0 ? {} : { periods: 0 }), ...(timed ? {} : { minutes: 0, periods: 0, seconds: 0 }) },
    ...emptySeating<GoSeat>(2),
    phase: "waiting",
    game: 0,
    // Swapped as each game starts, so seat 0 has Black in the first.
    blackSeat: 1,
    sides: null,
    board: emptyBoard(config.size),
    turn: "b",
    moves: [],
    history: [positionKey(emptyBoard(config.size))],
    passes: 0,
    captures: { b: 0, w: 0 },
    clock: null,
    clockSince: 0,
    scoring: null,
    result: null,
    timers: {},
  };
}

const bothSeated = (state: GoState) => state.seats.every(Boolean);
export const seatColor = (state: GoState, seat: number): Color => (seat === state.blackSeat ? "b" : "w");
const seatOfColor = (state: GoState, c: Color): Side => (c === "b" ? state.blackSeat : ((1 - state.blackSeat) as Side));
const hasMoved = (state: GoState, c: Color) => state.moves.some((m) => m.by === c);
const timed = (config: GoConfig) => config.minutes > 0 || config.periods > 0;
const periodMs = (state: GoState) => state.config.seconds * 1000;
const inGame = (state: GoState) => state.phase === "playing" || state.phase === "scoring";

// --- seating -------------------------------------------------------------------

export function sit(state: GoState, playerId: string, seat: number, ctx: GameContext) {
  sitDown(state, playerId, seat, () => ({ wins: 0 }));
  if (state.phase === "waiting" && bothSeated(state)) startGame(state, ctx);
}

export function leave(state: GoState, playerId: string, ctx: GameContext) {
  const seat = requireSeat(state, playerId);
  if (inGame(state)) {
    const c = seatColor(state, seat);
    if (hasMoved(state, c)) finish(state, { winner: other(c), reason: "left", score: null }, ctx);
    else {
      // Nothing lost yet: call it off, and the next game is this one again (same colors).
      state.phase = "waiting";
      state.blackSeat = (1 - state.blackSeat) as Side;
      state.game--;
      state.sides = null;
      state.scoring = null;
      setTimer(state.timers, "flag", null);
      setTimer(state.timers, "settle", null);
      ctx.announce(`The Go game was called off: ${ctx.nameOf(playerId)} left before making a move.`);
    }
  }
  standUp(state, playerId);
}

export function rematch(state: GoState, actor: string, ctx: GameContext) {
  requireSeat(state, actor);
  if (state.phase !== "over") throw new GameError("in_progress", "A game is already on.");
  if (!bothSeated(state)) throw new GameError("not_enough_players", "Two players need to be seated.");
  startGame(state, ctx);
}

export const canRematch = (state: GoState) => state.phase === "over" && bothSeated(state);

function startGame(state: GoState, ctx: GameContext) {
  const empty = emptyBoard(state.config.size);
  state.phase = "playing";
  state.game++;
  state.blackSeat = (1 - state.blackSeat) as Side;
  state.sides = { b: state.seats[state.blackSeat]!.playerId, w: state.seats[1 - state.blackSeat]!.playerId };
  state.board = empty;
  state.turn = "b";
  state.moves = [];
  state.history = [positionKey(empty)];
  state.passes = 0;
  state.captures = { b: 0, w: 0 };
  const fresh = () => ({ main: state.config.minutes * 60_000, periods: state.config.periods });
  state.clock = timed(state.config) ? { b: fresh(), w: fresh() } : null;
  state.clockSince = ctx.now;
  state.scoring = null;
  state.result = null;
  setTimer(state.timers, "settle", null);
  setFlag(state);
}

// --- clocks --------------------------------------------------------------------

/** When the side to move runs out of everything. */
function setFlag(state: GoState) {
  const c = state.clock?.[state.turn];
  setTimer(state.timers, "flag", c && state.phase === "playing" ? state.clockSince + c.main + c.periods * periodMs(state) : null);
}

/** Take `elapsed` ms off a byo-yomi clock: main time first, then whole periods (the one you're in is kept). */
export function spend(clock: ByoClock, elapsed: number, period: number) {
  if (elapsed <= clock.main) {
    clock.main -= elapsed;
    return;
  }
  const over = elapsed - clock.main;
  clock.main = 0;
  clock.periods = period > 0 ? Math.max(0, clock.periods - Math.floor(over / period)) : 0;
}

/** Stop the side to move's clock now. */
function stopClock(state: GoState, now: number) {
  if (state.clock && state.phase === "playing") spend(state.clock[state.turn], now - state.clockSince, periodMs(state));
  state.clockSince = now;
}

// --- playing -------------------------------------------------------------------

function mover(state: GoState, actor: string): Color {
  const seat = requireSeat(state, actor);
  if (state.phase !== "playing") throw new GameError("not_playing", state.phase === "scoring" ? "The game is being counted." : "There's no game on.");
  const c = seatColor(state, seat);
  if (state.turn !== c) throw new GameError("not_your_turn", "It's not your move.");
  return c;
}

const ILLEGAL = {
  occupied: "That point is taken.",
  suicide: "That stone would have no liberties.",
  repeat: "That would bring back an earlier position (ko): play somewhere else first.",
} as const;

export function play(state: GoState, actor: string, point: string, ctx: GameContext) {
  const c = mover(state, actor);
  const p = parsePoint(point, state.config.size);
  if (p === null) throw new GameError("illegal_move", `There's no ${point} on a ${state.config.size}×${state.config.size} board.`);
  const after = tryPlay(state.board, c, p, new Set(state.history));
  if ("illegal" in after) throw new GameError("illegal_move", ILLEGAL[after.illegal]);
  stopClock(state, ctx.now);
  state.board = after.board;
  state.history.push(positionKey(after.board));
  state.moves.push({ by: c, at: p, captured: after.captured });
  state.captures[c] += after.captured.length;
  state.passes = 0;
  state.turn = other(c);
  setFlag(state);
}

export function pass(state: GoState, actor: string, ctx: GameContext) {
  const c = mover(state, actor);
  stopClock(state, ctx.now);
  state.moves.push({ by: c, at: null, captured: [] });
  state.turn = other(c);
  if (++state.passes >= 2) return startCounting(state, ctx);
  setFlag(state);
}

function startCounting(state: GoState, ctx: GameContext) {
  state.phase = "scoring";
  setTimer(state.timers, "flag", null);
  const dead = estimateDead(state.board, state.turn, { playouts: DEAD_PLAYOUTS[state.config.size], seed: ctx.randomInt(2 ** 31) });
  state.scoring = { dead, accepted: { b: false, w: false } };
  setTimer(state.timers, "settle", ctx.now + SETTLE_MS);
}

function counter(state: GoState, actor: string): Color {
  const seat = requireSeat(state, actor);
  if (state.phase !== "scoring" || !state.scoring) throw new GameError("not_counting", "The game isn't being counted.");
  return seatColor(state, seat);
}

/** Mark the chain on `point` dead, or alive again if it's marked dead. Anyone's acceptance is withdrawn. */
export function mark(state: GoState, actor: string, point: string, ctx: GameContext) {
  counter(state, actor);
  const scoring = state.scoring!;
  const p = parsePoint(point, state.config.size);
  if (p === null || state.board[p] === ".") throw new GameError("no_stone", "Point at a stone to mark its group dead or alive.");
  const stones = chainAt(state.board, p).stones;
  const dead = new Set(scoring.dead);
  const wasDead = dead.has(p);
  for (const s of stones) {
    if (wasDead) dead.delete(s);
    else dead.add(s);
  }
  scoring.dead = [...dead].sort((a, b) => a - b);
  scoring.accepted = { b: false, w: false };
  setTimer(state.timers, "settle", ctx.now + SETTLE_MS);
}

export function accept(state: GoState, actor: string, ctx: GameContext) {
  const c = counter(state, actor);
  const scoring = state.scoring!;
  if (scoring.accepted[c]) throw new GameError("already_accepted", "You've accepted; waiting for the other player.");
  scoring.accepted[c] = true;
  if (scoring.accepted.b && scoring.accepted.w) finish(state, scoreResult(state), ctx);
  else setTimer(state.timers, "settle", ctx.now + SETTLE_MS);
}

/** Back to playing, to settle it on the board; the other side moves first. */
export function resume(state: GoState, actor: string, ctx: GameContext) {
  const c = counter(state, actor);
  state.phase = "playing";
  state.scoring = null;
  state.passes = 0;
  state.turn = other(c);
  state.clockSince = ctx.now;
  setTimer(state.timers, "settle", null);
  setFlag(state);
  ctx.announce(`${ctx.nameOf(actor)} resumed play to settle the position; ${ctx.nameOf(state.sides![state.turn])} moves first.`);
}

/** The points by area as marked: stones and surrounded points, plus komi for White. */
export function countScore(board: string, dead: number[]): { b: number; w: number; owner: string } {
  const area = areaScore(board, dead);
  return { b: area.b, w: area.w + KOMI, owner: area.owner };
}

function scoreResult(state: GoState): GoResult {
  const { b, w } = countScore(state.board, state.scoring!.dead);
  return { winner: b > w ? "b" : "w", reason: "score", score: { b, w } };
}

export function resign(state: GoState, actor: string, ctx: GameContext) {
  const seat = requireSeat(state, actor);
  if (!inGame(state)) throw new GameError("not_playing", "There's no game on.");
  finish(state, { winner: other(seatColor(state, seat)), reason: "resign", score: null }, ctx);
}

function finish(state: GoState, result: GoResult, ctx: GameContext) {
  stopClock(state, ctx.now);
  state.phase = "over";
  state.result = result;
  // A counted game keeps its marking, to show the territory; any other loses it.
  if (result.reason !== "score") state.scoring = null;
  setTimer(state.timers, "flag", null);
  setTimer(state.timers, "settle", null);
  const seat = state.seats[seatOfColor(state, result.winner)];
  if (seat?.playerId === state.sides![result.winner]) seat.wins++;
  ctx.announce(`Go game ${state.game}: ${resultText(result, (c) => ctx.nameOf(state.sides![c]))}`);
}

/** "Alice wins by 6.5 points." / "Bob wins (Alice resigned)." */
export function resultText(result: GoResult, name: (c: Color) => string): string {
  const loser = name(other(result.winner));
  if (result.reason === "score" && result.score) {
    const margin = Math.abs(result.score.b - result.score.w);
    return `${name(result.winner)} wins by ${margin} ${margin === 1 ? "point" : "points"}.`;
  }
  const how: Record<Exclude<EndReason, "score">, string> = {
    resign: ` (${loser} resigned)`,
    timeout: ` on time (${loser} ran out)`,
    left: ` (${loser} left the board)`,
  };
  return `${name(result.winner)} wins${how[result.reason as Exclude<EndReason, "score">]}.`;
}

// --- timers --------------------------------------------------------------------

export function nextDeadline(state: GoState): number | null {
  return nextTimer(state.timers);
}

export function onDeadline(state: GoState, ctx: GameContext) {
  const due = takeDueTimer(state.timers, ctx.now);
  if (due === "flag" && state.phase === "playing" && state.clock) {
    const late = state.turn;
    finish(state, { winner: other(late), reason: "timeout", score: null }, ctx);
    state.clock[late] = { main: 0, periods: 0 };
  } else if (due === "settle" && state.phase === "scoring") finish(state, scoreResult(state), ctx);
}

// --- who and what --------------------------------------------------------------

export function waitingOn(state: GoState): string[] {
  if (state.phase === "playing") return [state.seats[seatOfColor(state, state.turn)]!.playerId];
  if (state.phase === "scoring") return (["b", "w"] as const).filter((c) => !state.scoring!.accepted[c]).map((c) => state.seats[seatOfColor(state, c)]!.playerId);
  return [];
}

/** One point per chain of stones, to mark it while counting. */
export const chainPoints = (board: string) => chains(board).map((ch) => Math.min(...ch.stones));

export function checkInvariants(state: GoState) {
  const n = state.config.size ** 2;
  if (state.board.length !== n || !/^[bw.]+$/.test(state.board)) throw new Error("a malformed board");
  for (const ch of chains(state.board)) if (!ch.liberties.length) throw new Error(`a chain at ${pointName(ch.stones[0]!, state.config.size)} with no liberties`);
  if (state.history.at(-1) !== positionKey(state.board)) throw new Error("the history doesn't end in the board");
  if (state.history.length !== 1 + state.moves.filter((m) => m.at !== null).length) throw new Error("history and moves out of step");
  if (state.clock && [state.clock.b, state.clock.w].some((c) => c.main < 0 || c.periods < 0)) throw new Error("negative clock");
  if (inGame(state)) {
    if (!bothSeated(state)) throw new Error("playing without two players");
    for (const c of ["b", "w"] as const) if (state.seats[seatOfColor(state, c)]!.playerId !== state.sides?.[c]) throw new Error(`${c} isn't who's seated`);
    if (state.result) throw new Error("a result while playing");
  }
  if (state.phase === "scoring" ? !state.scoring : state.scoring && state.result?.reason !== "score") throw new Error("counting out of step");
  if (state.scoring?.dead.some((p) => state.board[p] === ".")) throw new Error("an empty point marked dead");
  if (state.phase === "scoring" && state.timers.settle == null) throw new Error("counting with no deadline");
  if (state.phase === "over" && !state.result) throw new Error("over without a result");
}

// --- views ---------------------------------------------------------------------

export interface LastMove {
  by: Color;
  point: string;
  /** The stones it took off. */
  captured: string[];
}

export interface GoView {
  config: GoConfig;
  komi: number;
  seats: (GoSeat | null)[];
  phase: GoState["phase"];
  game: number;
  sides: { b: string; w: string } | null;
  /** The seat playing Black this (or the last) game; while waiting, in the next. */
  blackSeat: Side;
  size: Size;
  /** size×size cells, row by row from the top left: "b", "w" or ".". */
  board: string;
  /** The same as rows, the top row (row `size`) first. */
  rows: string[];
  turn: Color;
  /** Stones each color has taken. */
  captures: { b: number; w: number };
  /** Every move so far: the point, or null for a pass. */
  moves: { by: Color; point: string | null }[];
  /** The last stone played. */
  lastMove: LastMove | null;
  /** Whether the very last move was a pass, and by whom. */
  passed: Color | null;
  /** Empty points the side to move can't play because they'd repeat a position (ko). */
  ko: string[];
  /** Ms left, as of `since` for the `running` side; `period` is the length of a byo-yomi period. */
  clock: { b: ByoClock; w: ByoClock; since: number; running: Color | null; period: number } | null;
  /**
   * While counting, and after a counted game: the stones marked dead, whose each point
   * counts as, the score as marked, who's accepted, and when it's scored anyway.
   */
  scoring: { dead: string[]; owner: string; score: { b: number; w: number }; accepted: { b: boolean; w: boolean }; deadline: number } | null;
  result: GoResult | null;
  canRematch: boolean;
  you: { seat: Side | null; color: Color | null };
}

/** Points where only the repeat rule stops the side to move. */
function koPoints(state: GoState): number[] {
  if (state.phase !== "playing") return [];
  const seen = new Set(state.history);
  const out: number[] = [];
  // A repeat needs stones to come off, so only points next to a chain in atari can be one.
  for (const ch of chains(state.board)) {
    if (ch.color === state.turn || ch.liberties.length !== 1) continue;
    const p = ch.liberties[0]!;
    const tried = tryPlay(state.board, state.turn, p, seen);
    if ("illegal" in tried && tried.illegal === "repeat" && !out.includes(p)) out.push(p);
  }
  return out.sort((a, b) => a - b);
}

export function viewFor(state: GoState, viewer: string): GoView {
  const seat = seatOf(state, viewer);
  const size = state.config.size;
  const name = (p: number) => pointName(p, size);
  const blackSeat: Side = state.phase === "waiting" ? ((1 - state.blackSeat) as Side) : state.blackSeat;
  const last = state.moves.findLast((m) => m.at !== null);
  const tail = state.moves.at(-1);
  const counted = state.scoring && countScore(state.board, state.scoring.dead);
  return {
    config: { size, minutes: state.config.minutes, periods: state.config.periods, seconds: state.config.seconds },
    komi: KOMI,
    seats: state.seats.map((s) => (s ? { playerId: s.playerId, sittingOut: s.sittingOut, wins: s.wins } : null)),
    phase: state.phase,
    game: state.game,
    sides: state.sides ? { b: state.sides.b, w: state.sides.w } : null,
    blackSeat,
    size,
    board: state.board,
    rows: Array.from({ length: size }, (_, r) => state.board.slice(r * size, r * size + size)),
    turn: state.turn,
    captures: { b: state.captures.b, w: state.captures.w },
    moves: state.moves.map((m) => ({ by: m.by, point: m.at === null ? null : name(m.at) })),
    lastMove: last ? { by: last.by, point: name(last.at!), captured: last.captured.map(name) } : null,
    passed: tail && tail.at === null ? tail.by : null,
    ko: koPoints(state).map(name),
    clock: state.clock
      ? {
          b: { ...state.clock.b },
          w: { ...state.clock.w },
          since: state.clockSince,
          running: state.phase === "playing" ? state.turn : null,
          period: state.config.seconds * 1000,
        }
      : null,
    scoring:
      state.scoring && counted
        ? {
            dead: state.scoring.dead.map(name),
            owner: counted.owner,
            score: { b: counted.b, w: counted.w },
            accepted: { ...state.scoring.accepted },
            deadline: state.phase === "scoring" ? (state.timers.settle ?? 0) : 0,
          }
        : null,
    result: state.result ? { winner: state.result.winner, reason: state.result.reason, score: state.result.score && { ...state.result.score } } : null,
    canRematch: canRematch(state),
    you: { seat: seat < 0 ? null : (seat as Side), color: seat < 0 ? null : seat === blackSeat ? "b" : "w" },
  };
}
