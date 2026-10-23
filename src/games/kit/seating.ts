/**
 * Seats around a table: the lobby part of most turn-based games.
 *
 * A game's state includes `seats` and `away` (spread a `Seating` into it). Seat
 * objects carry whatever per-player data the game needs (a poker stack, a score);
 * when a player stands up that data is kept in `away` and handed back if they sit
 * down again, so standing up is never a way to reset yourself. Only the most recent
 * MAX_AWAY are kept, so a long-running game can't grow without bound.
 */
import { GameError } from "../types";

/** How many players who stood up are remembered. */
export const MAX_AWAY = 32;

export interface Seat {
  playerId: string;
  /** Skipped when dealing in / taking turns, but keeps the seat. */
  sittingOut: boolean;
}

/** The game-specific part of a seat. */
export type SeatData<S extends Seat> = Omit<S, "playerId" | "sittingOut">;

export interface Seating<S extends Seat> {
  seats: (S | null)[];
  away: Record<string, SeatData<S>>;
}

export function emptySeating<S extends Seat>(count: number): Seating<S> {
  return { seats: Array.from({ length: count }, () => null), away: {} };
}

/** Seat index of a player, or -1. */
export function seatOf(t: Seating<Seat>, playerId: string): number {
  return t.seats.findIndex((s) => s?.playerId === playerId);
}

/** Seat index of a player, or a GameError if they aren't seated. */
export function requireSeat(t: Seating<Seat>, playerId: string): number {
  const seat = seatOf(t, playerId);
  if (seat < 0) throw new GameError("not_seated", "You're not seated.");
  return seat;
}

export function seatedPlayers(t: Seating<Seat>): string[] {
  return t.seats.flatMap((s) => (s ? [s.playerId] : []));
}

/** Indices of occupied seats matching `pred`, ascending. */
export function seatsWhere<S extends Seat>(t: Seating<S>, pred: (s: S) => boolean = () => true): number[] {
  return t.seats.flatMap((s, i) => (s && pred(s) ? [i] : []));
}

/** Sit a player down, restoring what they had if they stood up earlier; `fresh` makes a newcomer's data. */
export function sitDown<S extends Seat>(t: Seating<S>, playerId: string, seat: number, fresh: () => SeatData<S>): S {
  if (seatOf(t, playerId) >= 0) throw new GameError("already_seated", "You already have a seat.");
  if (!Number.isInteger(seat) || seat < 0 || seat >= t.seats.length) throw new GameError("bad_seat", "No such seat.");
  if (t.seats[seat]) throw new GameError("seat_taken", "That seat is taken.");
  const data = t.away[playerId] ?? fresh();
  delete t.away[playerId];
  const s = { ...data, playerId, sittingOut: false } as S;
  t.seats[seat] = s;
  return s;
}

/**
 * Stand a player up, remembering their seat data. Returns the seat they left. When
 * that makes too many to remember, the longest gone are forgotten, through `forget`
 * (e.g. their chips leave the table).
 */
export function standUp<S extends Seat>(t: Seating<S>, playerId: string, forget?: (data: SeatData<S>) => void): number {
  const seat = requireSeat(t, playerId);
  const { playerId: _id, sittingOut: _out, ...data } = t.seats[seat]!;
  t.away[playerId] = data as SeatData<S>;
  t.seats[seat] = null;
  // Keys keep insertion order (player ids are never integer-like), so the first are the oldest.
  for (const id of Object.keys(t.away).slice(0, -MAX_AWAY)) {
    forget?.(t.away[id]!);
    delete t.away[id];
  }
  return seat;
}

/** Sit out or back in; asking for what's already so is refused (it would change nothing). */
export function setSittingOut<S extends Seat>(t: Seating<S>, playerId: string, sittingOut: boolean): S {
  const s = t.seats[requireSeat(t, playerId)]!;
  if (s.sittingOut === sittingOut) throw new GameError("no_change", sittingOut ? "You're already sitting out." : "You're already in.");
  s.sittingOut = sittingOut;
  return s;
}

/** First item strictly after seat `from`, going clockwise (wrapping), that matches `pred`. */
export function nextClockwise<T extends { seat: number }>(items: T[], from: number, pred: (item: T) => boolean = () => true): T | undefined {
  const sorted = [...items].sort((a, b) => a.seat - b.seat);
  const start = Math.max(0, sorted.findIndex((i) => i.seat > from));
  for (let k = 0; k < sorted.length; k++) {
    const item = sorted[(start + k) % sorted.length]!;
    if (pred(item)) return item;
  }
  return undefined;
}

/** Distance clockwise from `from` to `seat` (1 = next seat), for ordering (e.g. odd chips). */
export function clockwiseDistance(from: number, seat: number, count: number): number {
  return ((seat - from + count - 1) % count) + 1;
}
