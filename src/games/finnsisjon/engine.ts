/**
 * Finns i sjön (Go Fish, the Swedish way), as a pure state machine.
 *
 * Rules: 2–6 players get 7 cards each (5 with four or more players); the rest is
 * the lake. On your turn you ask another player for a rank you hold. If they have
 * any, they hand them all over and you go again. If not: "Finns i sjön!" You draw
 * from the lake, and if you catch the rank you asked for you show it and go again;
 * otherwise play passes clockwise. Four of a kind is laid down at once as a book.
 * With an empty hand at the start of your turn you draw a card (if the lake is
 * empty too, you're out). The game ends when all 13 books are down; most books wins.
 *
 * Hidden information: hands and drawn cards are private; asks and their answers are
 * public, as at a real table. A lucky draw is shown, since you must show it.
 */
import { type Card, newDeck, rankName, rankOf, rankValue, shuffle } from "../kit/cards";
import {
  emptySeating,
  nextClockwise,
  requireSeat,
  type Seat,
  type Seating,
  seatOf,
  seatsWhere,
  setSittingOut as setSeatSittingOut,
  sitDown,
  standUp,
} from "../kit/seating";
import { nextTimer, setTimer, takeDueTimer, type Timers } from "../kit/timers";
import { type GameContext, GameError } from "../types";

export const SEAT_COUNT = 6;
export const TOTAL_BOOKS = 13;
/** How fast an away player's turns are played for them. */
export const AUTO_PLAY_DELAY_MS = 2500;

export interface FishConfig {
  /** Seconds to make your move before it's made for you (and you're marked away); 0 = no clock. */
  turnSeconds: number;
}

export type FishSeat = Seat & { gamesWon: number };

export interface FishPlayer {
  seat: number;
  playerId: string;
  hand: Card[];
  /** Ranks of completed books, in the order they were laid down. */
  books: string[];
  /** Left mid-game: hand went back to the lake, books stay on the table. */
  left: boolean;
  /** The last card this player drew from the lake. Private to them. */
  lastDrawn: Card | null;
}

export type FishEvent =
  /** `cards` are what changed hands, handed over in plain view, so everyone sees them. */
  | { type: "ask"; from: string; to: string; rank: string; got: number; cards: Card[] }
  /** Drew after "Finns i sjön!". The card is only public when it was the rank asked for. */
  | { type: "fish"; who: string; rank: string; lucky: boolean; card: Card | null }
  /** Drew because their hand was empty, or nobody had cards to ask for. */
  | { type: "draw"; who: string }
  | { type: "book"; who: string; rank: string }
  | { type: "left"; who: string };

export interface FishState extends Seating<FishSeat> {
  config: FishConfig;
  phase: "lobby" | "playing" | "over";
  game: number;
  dealer: number | null;
  /** Everyone dealt into the current (or last) game, by seat. */
  players: FishPlayer[];
  lake: Card[];
  /** Seat whose turn it is. */
  turn: number | null;
  /** The most recent events (LOG_KEEP of them). */
  log: FishEvent[];
  /** Events so far this game, so a view can tell which are new once the log is full. */
  logged: number;
  result: { winners: string[]; books: Record<string, number> } | null;
  /** When the current turn's clock runs out (null: no clock), whatever happens to "turn". */
  turnEndsAt: number | null;
  /** turn: the current turn's deadline, sooner for a player who's away. */
  timers: Timers<"turn">;
}

/** Events kept in state, as many as views show. Play can go round in circles for a long time. */
export const LOG_KEEP = 40;

export function createState(config: FishConfig): FishState {
  return {
    config,
    ...emptySeating<FishSeat>(SEAT_COUNT),
    phase: "lobby",
    game: 0,
    dealer: null,
    players: [],
    lake: [],
    turn: null,
    log: [],
    logged: 0,
    result: null,
    turnEndsAt: null,
    timers: {},
  };
}

// --- helpers ---------------------------------------------------------------

const active = (state: FishState) => state.players.filter((p) => !p.left);

export function playerOf(state: FishState, playerId: string): FishPlayer | undefined {
  return state.players.find((p) => p.playerId === playerId && !p.left);
}

export function currentPlayer(state: FishState): FishPlayer | undefined {
  return state.phase === "playing" ? active(state).find((p) => p.seat === state.turn) : undefined;
}

function opponentsWithCards(state: FishState, p: FishPlayer) {
  return active(state).filter((o) => o !== p && o.hand.length > 0);
}

function logEvent(state: FishState, e: FishEvent) {
  state.log.push(e);
  state.logged = (state.logged ?? 0) + 1;
  if (state.log.length > LOG_KEEP) state.log.splice(0, state.log.length - LOG_KEEP);
}

function booksDown(state: FishState) {
  return state.players.reduce((n, p) => n + p.books.length, 0);
}

function draw(state: FishState, p: FishPlayer): Card {
  const card = state.lake.pop()!;
  p.hand.push(card);
  p.lastDrawn = card;
  return card;
}

/** Lay down any four of a kind. */
function layBooks(state: FishState, p: FishPlayer, ctx: GameContext) {
  const counts = new Map<string, number>();
  for (const c of p.hand) counts.set(rankOf(c), (counts.get(rankOf(c)) ?? 0) + 1);
  for (const [rank, n] of counts) {
    if (n < 4) continue;
    p.hand = p.hand.filter((c) => rankOf(c) !== rank);
    p.books.push(rank);
    logEvent(state, { type: "book", who: p.playerId, rank });
    ctx.announce(`${ctx.nameOf(p.playerId)} lays down four ${rankName(rank, true)}.`);
  }
}

export function canStart(state: FishState): boolean {
  return state.phase !== "playing" && seatsWhere(state, (s) => !s.sittingOut).length >= 2;
}

// --- seating ---------------------------------------------------------------

export function sit(state: FishState, playerId: string, seat: number) {
  // Sitting down mid-game is fine: you're dealt in next game.
  sitDown(state, playerId, seat, () => ({ gamesWon: 0 }));
}

export function leave(state: FishState, playerId: string, ctx: GameContext) {
  requireSeat(state, playerId);
  const p = playerOf(state, playerId);
  if (state.phase === "playing" && p) {
    p.left = true;
    state.lake.push(...p.hand);
    p.hand = [];
    shuffle(state.lake, ctx.randomInt);
    logEvent(state, { type: "left", who: playerId });
    const current = currentPlayer(state);
    if (state.turn === p.seat) beginTurn(state, ctx, p.seat, false);
    else if (isOver(state)) finish(state, ctx);
    // Whoever's turn it is may have had only them to ask: then they draw and pass.
    else if (current && opponentsWithCards(state, current).length === 0) beginTurn(state, ctx, current.seat, true);
  }
  standUp(state, playerId);
}

export function setSittingOut(state: FishState, playerId: string, away: boolean, ctx: GameContext) {
  setSeatSittingOut(state, playerId, away);
  // On your turn: away, it's played for you soon; back, you have what's left of your turn.
  const p = currentPlayer(state);
  if (p?.playerId === playerId) setTurnTimer(state, p, ctx);
}

// --- the game --------------------------------------------------------------

/** Deal a new game: for players at the table only. */
export function start(state: FishState, actor: string, ctx: GameContext) {
  requireSeat(state, actor);
  if (state.phase === "playing") throw new GameError("in_progress", "A game is already on.");
  const seats = seatsWhere(state, (s) => !s.sittingOut);
  if (seats.length < 2) throw new GameError("not_enough_players", "Need at least two players at the table.");

  const deck = shuffle(newDeck(), ctx.randomInt);
  state.players = seats.map((seat) => ({ seat, playerId: state.seats[seat]!.playerId, hand: [], books: [], left: false, lastDrawn: null }));
  const dealer = state.dealer === null ? seats[ctx.randomInt(seats.length)]! : nextClockwise(state.players, state.dealer)!.seat;
  const handSize = seats.length <= 3 ? 7 : 5;
  for (let i = 0; i < handSize; i++) for (const p of state.players) p.hand.push(deck.pop()!);
  state.lake = deck;
  state.dealer = dealer;
  state.game++;
  state.phase = "playing";
  state.log = [];
  state.logged = 0;
  state.result = null;
  for (const p of state.players) layBooks(state, p, ctx);
  beginTurn(state, ctx, dealer, false);
}

export function ask(state: FishState, actor: string, targetId: string, rank: string, ctx: GameContext) {
  const p = currentPlayer(state);
  if (!p) throw new GameError("not_playing", "There's no game on.");
  if (p.playerId !== actor) throw new GameError("not_your_turn", "It's not your turn.");
  const target = playerOf(state, targetId);
  if (!target || target === p) throw new GameError("bad_target", "Ask another player in the game.");
  if (target.hand.length === 0) throw new GameError("no_cards", `${ctx.nameOf(targetId)} has no cards.`);
  if (!p.hand.some((c) => rankOf(c) === rank)) throw new GameError("must_hold_rank", "You can only ask for a rank you hold.");

  const given = target.hand.filter((c) => rankOf(c) === rank);
  logEvent(state, { type: "ask", from: actor, to: targetId, rank, got: given.length, cards: [...given] });
  if (given.length) {
    target.hand = target.hand.filter((c) => rankOf(c) !== rank);
    p.hand.push(...given);
    layBooks(state, p, ctx);
    return beginTurn(state, ctx, p.seat, true);
  }

  // Finns i sjön!
  if (state.lake.length === 0) return beginTurn(state, ctx, p.seat, false);
  const card = draw(state, p);
  const lucky = rankOf(card) === rank;
  logEvent(state, { type: "fish", who: actor, rank, lucky, card: lucky ? card : null });
  layBooks(state, p, ctx);
  beginTurn(state, ctx, p.seat, lucky);
}

/** Make the move for a player who's away or out of time: ask for what they hold most of. */
function autoPlay(state: FishState, ctx: GameContext) {
  const p = currentPlayer(state)!;
  const counts = new Map<string, number>();
  for (const c of p.hand) counts.set(rankOf(c), (counts.get(rankOf(c)) ?? 0) + 1);
  const rank = [...counts].sort((a, b) => b[1] - a[1] || rankValue(b[0]) - rankValue(a[0]))[0]![0];
  const targets = opponentsWithCards(state, p);
  if (!targets.length) return beginTurn(state, ctx, p.seat, true);
  ask(state, p.playerId, targets[ctx.randomInt(targets.length)]!.playerId, rank, ctx);
}

function isOver(state: FishState) {
  return booksDown(state) === TOTAL_BOOKS || active(state).length < 2;
}

/**
 * Hand the turn to `from` (if `again`) or the next player clockwise, settling the
 * automatic parts: drawing into an empty hand, skipping players who are out, and
 * drawing-and-passing when there's nobody with cards to ask.
 */
function beginTurn(state: FishState, ctx: GameContext, from: number, again: boolean) {
  const next = (seat: number) => nextClockwise(active(state), seat)!.seat;
  let seat = again ? from : next(from);
  // Every pass through the loop either hands out a turn, draws a card or skips
  // a player with nothing left, so it ends; the bound is just a backstop.
  for (let guard = 0; guard < 200; guard++) {
    if (isOver(state)) return finish(state, ctx);
    const p = active(state).find((x) => x.seat === seat)!;
    if (p.hand.length === 0) {
      if (state.lake.length === 0) {
        seat = next(seat); // out of cards for good
        continue;
      }
      draw(state, p);
      logEvent(state, { type: "draw", who: p.playerId });
    }
    if (opponentsWithCards(state, p).length === 0) {
      // Nobody to ask: take a card from the lake, if any, and pass.
      if (state.lake.length > 0) {
        draw(state, p);
        logEvent(state, { type: "draw", who: p.playerId });
        layBooks(state, p, ctx);
      }
      seat = next(seat);
      continue;
    }
    state.turn = p.seat;
    const secs = state.config.turnSeconds;
    state.turnEndsAt = secs > 0 ? ctx.now + secs * 1000 : null;
    setTurnTimer(state, p, ctx);
    return;
  }
  finish(state, ctx);
}

/** The turn's deadline: the end of its clock, or soon for a player who's away. */
function setTurnTimer(state: FishState, p: FishPlayer, ctx: GameContext) {
  const away = state.seats[p.seat]?.sittingOut ?? true;
  const ends = state.turnEndsAt ?? null;
  setTimer(state.timers, "turn", away ? Math.min(ends ?? Infinity, ctx.now + AUTO_PLAY_DELAY_MS) : ends);
}

function finish(state: FishState, ctx: GameContext) {
  state.phase = "over";
  state.turn = null;
  state.turnEndsAt = null;
  setTimer(state.timers, "turn", null);
  const books = Object.fromEntries(state.players.map((p) => [p.playerId, p.books.length]));
  const contenders = active(state);
  const best = Math.max(0, ...contenders.map((p) => p.books.length));
  const winners = contenders.filter((p) => p.books.length === best).map((p) => p.playerId);
  state.result = { winners, books };
  for (const id of winners) {
    const seat = state.seats[seatOf(state, id)];
    if (seat) seat.gamesWon++;
  }
  const names = winners.map((id) => ctx.nameOf(id));
  const sets = `${best} ${best === 1 ? "book" : "books"}`;
  ctx.announce(
    names.length === 1 ? `Game ${state.game}: ${names[0]} wins with ${sets}!` : `Game ${state.game}: ${names.join(" & ")} share the win with ${sets} each.`,
  );
}

export function nextDeadline(state: FishState): number | null {
  return nextTimer(state.timers);
}

export function onDeadline(state: FishState, ctx: GameContext) {
  if (takeDueTimer(state.timers, ctx.now) !== "turn") return;
  const p = currentPlayer(state);
  if (!p) return;
  // Out of time: you're marked away, and your turns are played for you until you're back.
  const seat = state.seats[p.seat];
  if (seat && !seat.sittingOut) seat.sittingOut = true;
  autoPlay(state, ctx);
}

/** What the player whose turn it is may ask for. */
export function askOptions(state: FishState, playerId: string): { targets: string[]; ranks: string[] } | null {
  const p = currentPlayer(state);
  if (!p || p.playerId !== playerId) return null;
  const ranks = [...new Set(p.hand.map(rankOf))].sort((a, b) => rankValue(a) - rankValue(b));
  return { targets: opponentsWithCards(state, p).map((o) => o.playerId), ranks };
}

// --- views -----------------------------------------------------------------

export interface FishPlayerView {
  seat: number;
  playerId: string;
  cardCount: number;
  books: string[];
  left: boolean;
  /** Only for the viewer's own player. */
  hand: Card[] | null;
  lastDrawn: Card | null;
}

export interface FishView {
  config: FishConfig;
  seats: (FishSeat | null)[];
  phase: FishState["phase"];
  game: number;
  dealer: number | null;
  players: FishPlayerView[];
  lakeCount: number;
  turn: number | null;
  turnDeadline: number | null;
  log: FishEvent[];
  /** Events so far this game (more than `log` holds once it's long). */
  logged: number;
  result: FishState["result"];
  canStart: boolean;
  you: { seat: number | null; inGame: boolean; ask: { targets: string[]; ranks: string[] } | null };
}

const byRank = (a: Card, b: Card) => rankValue(a) - rankValue(b) || a.localeCompare(b);

/** Built field by field: never spread from state, so hands and the lake can't leak. */
export function viewFor(state: FishState, viewer: string): FishView {
  const seat = seatOf(state, viewer);
  return {
    config: state.config,
    seats: state.seats.map((s) => (s ? { playerId: s.playerId, sittingOut: s.sittingOut, gamesWon: s.gamesWon } : null)),
    phase: state.phase,
    game: state.game,
    dealer: state.dealer,
    players: state.players.map((p) => {
      const mine = p.playerId === viewer && !p.left;
      return {
        seat: p.seat,
        playerId: p.playerId,
        cardCount: p.hand.length,
        books: [...p.books],
        left: p.left,
        hand: mine ? [...p.hand].sort(byRank) : null,
        lastDrawn: mine ? p.lastDrawn : null,
      };
    }),
    lakeCount: state.lake.length,
    turn: state.turn,
    turnDeadline: state.phase === "playing" ? (state.timers.turn ?? null) : null,
    log: state.log.slice(-40).map((e) =>
      e.type === "ask"
        ? // Cards are handed over in plain view, so everyone sees which ones.
          { type: "ask", from: e.from, to: e.to, rank: e.rank, got: e.got, cards: [...e.cards] }
        : { ...e },
    ),
    logged: state.logged ?? state.log.length,
    result: state.result,
    canStart: canStart(state),
    you: { seat: seat < 0 ? null : seat, inGame: !!playerOf(state, viewer), ask: askOptions(state, viewer) },
  };
}
