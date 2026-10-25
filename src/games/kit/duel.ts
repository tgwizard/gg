/**
 * The table for a two-player board game (chess, Othello, Go, Four in a Row,
 * Luffarschack): two seats with a running score, and a series of games between whoever
 * sits in them.
 *
 *   - The first game starts when both seats fill; after that "Play again" starts the
 *     next. Each side has a color (or mark): `colors[0]` opens. Who opens the next game
 *     alternates, or (`loserOpens`) goes to the last game's loser.
 *   - Leaving mid-game forfeits it, unless you hadn't moved yet: then the game is called
 *     off, and the next one is the same game again (the same opener).
 *   - A finished game counts a win for the winner's seat (if they're still in it) or a
 *     draw, and is announced in the chat.
 *
 * A game's state extends `Duel` and calls these from its own ops. What a game is about
 * (the board, its clock, how it's won) stays with the game.
 */
import { type GameContext, GameError } from "../types";
import { emptySeating, requireSeat, type Seat, type Seating, seatOf, sitDown, standUp } from "./seating";
import { setTimer, type Timers } from "./timers";

/** Seat 0 or 1. */
export type Side = 0 | 1;
export type DuelSeat = Seat & { wins: number };

export interface Duel<C extends string, P extends string = never> extends Seating<DuelSeat> {
  phase: "waiting" | "playing" | "over" | P;
  /** Games started so far (a called-off one doesn't count). */
  game: number;
  /** The seat playing `colors[0]` (who opens) this (or the last) game. */
  openerSeat: Side;
  /** The seat that opens the next game. */
  nextOpenerSeat: Side;
  /** Who plays each color this (or the last) game, kept after they leave so the result can name them. */
  sides: Record<C, string> | null;
  draws: number;
  /** Every game's timers end with its game. */
  timers: Timers<string>;
}

export interface DuelSpec<C extends string> {
  /** As in the chat: "Chess game 3: …". */
  name: string;
  /** The two colors, the opener's first. */
  colors: readonly [C, C];
  /** Whether the last game's loser opens the next (else it alternates). */
  loserOpens?(state: Duel<C, string>): boolean;
}

export function emptyDuel<C extends string>(): Omit<Duel<C>, "phase"> & { phase: "waiting" } {
  return { ...emptySeating<DuelSeat>(2), phase: "waiting", game: 0, openerSeat: 0, nextOpenerSeat: 0, sides: null, draws: 0, timers: {} };
}

export const otherColor = <C extends string>(spec: DuelSpec<C>, c: C): C => (c === spec.colors[0] ? spec.colors[1] : spec.colors[0]);
export const colorOfSeat = <C extends string>(state: Duel<C, string>, spec: DuelSpec<C>, seat: number): C => spec.colors[seat === state.openerSeat ? 0 : 1];
export const seatOfColor = <C extends string>(state: Duel<C, string>, spec: DuelSpec<C>, c: C): Side =>
  c === spec.colors[0] ? state.openerSeat : ((1 - state.openerSeat) as Side);
export const bothSeated = (state: Duel<string, string>) => state.seats.every(Boolean);
/** A game is on (playing, or a phase of its own such as counting). */
export const inGame = (state: Duel<string, string>) => state.phase !== "waiting" && state.phase !== "over";
export const canRematch = (state: Duel<string, string>) => state.phase === "over" && bothSeated(state);

/** Take a seat; true when that fills the table for a first game (the game then starts it). */
export function sitDuel(state: Duel<string, string>, playerId: string, seat: number): boolean {
  sitDown(state, playerId, seat, () => ({ wins: 0 }));
  return state.phase === "waiting" && bothSeated(state);
}

/** Check that `actor` may start the next game ("Play again"). */
export function checkRematch(state: Duel<string, string>, actor: string) {
  requireSeat(state, actor);
  if (state.phase !== "over") throw new GameError("in_progress", "A game is already on.");
  if (!bothSeated(state)) throw new GameError("not_enough_players", "Two players need to be seated.");
}

/** The table side of starting a game; the game then sets up its board. */
export function beginDuel<C extends string>(state: Duel<C, string>, spec: DuelSpec<C>) {
  state.phase = "playing";
  state.game++;
  state.openerSeat = state.nextOpenerSeat;
  const [first, second] = spec.colors;
  state.sides = { [first]: state.seats[state.openerSeat]!.playerId, [second]: state.seats[1 - state.openerSeat]!.playerId } as Record<C, string>;
  state.timers = {};
}

/** The actor's color in a game that's on (and, with `turn`, only if it's theirs to move). */
export function actingColor<C extends string>(state: Duel<C, string>, spec: DuelSpec<C>, actor: string, turn?: C): C {
  const seat = requireSeat(state, actor);
  if (state.phase !== "playing") throw new GameError("not_playing", "There's no game on.");
  const c = colorOfSeat(state, spec, seat);
  if (turn !== undefined && turn !== c) throw new GameError("not_your_turn", "It's not your move.");
  return c;
}

/**
 * Give up your seat. In a game you've moved in, that loses it (`forfeit`); before your
 * first move it calls the game off (`calledOff` puts the game's own state back).
 */
export function leaveDuel<C extends string>(
  state: Duel<C, string>,
  spec: DuelSpec<C>,
  playerId: string,
  ctx: GameContext,
  game: { moved(c: C): boolean; forfeit(c: C): void; calledOff?(): void },
) {
  const seat = requireSeat(state, playerId);
  if (inGame(state)) {
    const c = colorOfSeat(state, spec, seat);
    if (game.moved(c)) game.forfeit(c);
    else {
      state.phase = "waiting";
      state.game--;
      state.nextOpenerSeat = state.openerSeat;
      state.sides = null;
      state.timers = {};
      game.calledOff?.();
      ctx.announce(`The ${spec.name} game was called off: ${ctx.nameOf(playerId)} left before making a move.`);
    }
  }
  standUp(state, playerId);
}

/** The table side of a finished game: the score, who opens next, and the news (`text`, e.g. "Alice wins."). */
export function endDuel<C extends string>(state: Duel<C, string>, spec: DuelSpec<C>, winner: C | null, text: string, ctx: GameContext) {
  state.phase = "over";
  state.timers = {};
  if (winner) {
    const seat = state.seats[seatOfColor(state, spec, winner)];
    if (seat?.playerId === state.sides![winner]) seat.wins++;
  } else state.draws++;
  const loser = winner && seatOfColor(state, spec, otherColor(spec, winner));
  state.nextOpenerSeat = spec.loserOpens?.(state) && loser !== null ? loser : ((1 - state.openerSeat) as Side);
  ctx.announce(`${spec.name} game ${state.game}: ${text}`);
}

/** Whose move it is, as the game waits on them. */
export function waitingOnColor<C extends string>(state: Duel<C, string>, spec: DuelSpec<C>, c: C): string[] {
  return [state.seats[seatOfColor(state, spec, c)]!.playerId];
}

/** What every duel must keep true. */
export function checkDuel<C extends string>(state: Duel<C, string> & { result: unknown }, spec: DuelSpec<C>) {
  if (inGame(state)) {
    if (!bothSeated(state)) throw new Error("playing without two players");
    for (const c of spec.colors) if (state.seats[seatOfColor(state, spec, c)]!.playerId !== state.sides?.[c]) throw new Error(`${c} isn't who's seated`);
    if (state.result) throw new Error("a result while playing");
  }
  if (state.phase === "over" && !state.result) throw new Error("over without a result");
}

export interface DuelView<C extends string, P extends string = never> {
  seats: (DuelSeat | null)[];
  phase: Duel<C, P>["phase"];
  game: number;
  /** Who plays each color this (or the last) game. */
  sides: Record<C, string> | null;
  /** The seat playing `colors[0]` (who opens) this game; while waiting, in the next. */
  openerSeat: Side;
  /** The seat that opens the next game (after this one ends). */
  nextOpenerSeat: Side;
  draws: number;
  canRematch: boolean;
  you: { seat: Side | null; color: C | null };
}

/** The table, as everyone may see it. */
export function duelView<C extends string, P extends string>(state: Duel<C, P>, spec: DuelSpec<C>, viewer: string): DuelView<C, P> {
  const seat = seatOf(state, viewer);
  const openerSeat = state.phase === "waiting" ? state.nextOpenerSeat : state.openerSeat;
  const [first, second] = spec.colors;
  return {
    seats: state.seats.map((s) => (s ? { playerId: s.playerId, sittingOut: s.sittingOut, wins: s.wins } : null)),
    phase: state.phase,
    game: state.game,
    sides: state.sides ? ({ [first]: state.sides[first], [second]: state.sides[second] } as Record<C, string>) : null,
    openerSeat,
    nextOpenerSeat: state.nextOpenerSeat,
    draws: state.draws,
    canRematch: canRematch(state),
    you: { seat: seat < 0 ? null : (seat as Side), color: seat < 0 ? null : spec.colors[seat === openerSeat ? 0 : 1] },
  };
}

// --- a chess clock ---------------------------------------------------------------

/**
 * Fischer clocks: each side has `minutes` and gains `increment` seconds per move, and
 * only the side to move runs down; its flag is the "flag" timer. With `minutes` 0
 * there's no clock.
 */
export interface FischerClock<C extends string> {
  config: { minutes: number; increment: number };
  /** Milliseconds left on each clock, as of `clockSince` for the side to move. Null when untimed. */
  clock: Record<C, number> | null;
  clockSince: number;
  timers: Timers<string>;
}

export const fischer = {
  /** Full clocks for a new game, the opener's running. */
  start<C extends string>(state: FischerClock<C>, spec: DuelSpec<C>, now: number) {
    const ms = state.config.minutes * 60_000;
    state.clock = ms > 0 ? ({ [spec.colors[0]]: ms, [spec.colors[1]]: ms } as Record<C, number>) : null;
    state.clockSince = now;
    fischer.flag(state, spec.colors[0]);
  },
  /** Stop `turn`'s clock now (and, with `increment`, add the bonus for a move made). */
  stop<C extends string>(state: FischerClock<C>, turn: C, now: number, increment = false) {
    if (state.clock) state.clock[turn] = Math.max(0, state.clock[turn] - (now - state.clockSince)) + (increment ? state.config.increment * 1000 : 0);
    state.clockSince = now;
  },
  /** `turn`'s clock is running: it runs out at its flag. */
  flag<C extends string>(state: FischerClock<C>, turn: C) {
    setTimer(state.timers, "flag", state.clock ? state.clockSince + state.clock[turn] : null);
  },
  /** For the view: the `running` side's has been ticking since `since`. */
  view<C extends string>(state: FischerClock<C>, running: C | null): (Record<C, number> & { since: number; running: C | null }) | null {
    return state.clock ? { ...state.clock, since: state.clockSince, running } : null;
  },
  check(state: FischerClock<string>) {
    if (state.clock && Object.values<number>(state.clock).some((ms) => ms < 0)) throw new Error("negative clock");
  },
};
