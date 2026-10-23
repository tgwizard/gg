/**
 * Ticket to Ride (the standard North American map), as a pure state machine.
 *
 * Rules: 2–5 players get 45 trains, 4 train cards and 3 destination tickets each,
 * keeping at least 2 of the tickets. Five cards lie face up. On your turn you do one
 * of three things:
 *   - draw two train cards, from the face-up five or blind from the deck. A face-up
 *     locomotive (wild) is your whole draw, and can't be your second card;
 *   - claim a route: pay as many cards of its color as it is long (any one color for
 *     a gray route; locomotives stand in for any color) and put your trains on it;
 *   - draw three tickets and keep at least one.
 * Three face-up locomotives at once: all five are discarded and replaced. Only one
 * track of a double route is used in games of 2–3 players, and nobody can have both.
 * When someone ends a turn with two or fewer trains, everyone (them included) gets
 * one last turn. Routes score as they're claimed (1, 2, 4, 7, 10, 15 points for 1–6
 * trains), tickets add their value if completed and subtract it if not, and the
 * longest continuous path earns 10. Ties go to the most completed tickets, then
 * the longest path.
 *
 * Hidden information: hands, tickets, tickets being chosen, cards drawn blind, and
 * the decks. How many of each a player has is public, as are face-up draws and the
 * cards paid for a route. Tickets are revealed at the end.
 */
import { shuffle } from "../kit/cards";
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
import { bothTracksFor, type Claims, connects, longestPath, routeOpen } from "./graph";
import {
  CARD_COLORS,
  type CardColor,
  ROUTE_POINTS,
  ROUTES,
  type Route,
  routeById,
  routeName,
  TICKETS,
  type Ticket,
  ticketById,
  ticketName,
  TRAIN_COLORS,
  type TrainColor,
} from "./map";

export const SEAT_COUNT = 5;
export const TRAINS = 45;
export const FACE_UP = 5;
/** Cards of each color, and locomotives. */
export const CARDS_PER_COLOR = 12;
export const LOCOS = 14;
export const STARTING_CARDS = 4;
export const LONGEST_BONUS = 10;
/** How fast an away player's turns are played for them. */
export const AUTO_PLAY_DELAY_MS = 2500;
/** Events kept in state, as many as views show. */
export const LOG_KEEP = 40;

export interface TtrConfig {
  /** Seconds per turn before it's played for you (and you're marked away); 0 = no clock. Choosing the first tickets gets twice as long. */
  turnSeconds: number;
}

export type TtrSeat = Seat & { gamesWon: number };

/** Train cards by color. */
export type Hand = Record<CardColor, number>;

export interface TtrPlayer {
  seat: number;
  playerId: string;
  trains: number;
  hand: Hand;
  /** Kept tickets. */
  tickets: number[];
  /** Tickets drawn and not yet chosen from, and how many must be kept. */
  offered: number[] | null;
  keepAtLeast: number;
  /** Claimed routes, in order. */
  routes: string[];
  /** Points from routes so far. */
  points: number;
  /** Left mid-game: their cards went to the discards, their routes stay on the map. */
  left: boolean;
  /** Cards drawn blind in their latest draw (until they draw again). Private. */
  drawn: CardColor[];
}

export type TtrEvent =
  /** A train card drawn: `card` is null when it came blind from the deck. */
  | { type: "card"; who: string; card: CardColor | null }
  | { type: "claim"; who: string; route: string; color: CardColor; locos: number }
  | { type: "tickets"; who: string; drew: number; kept: number }
  /** Three locomotives face up: all five were discarded and replaced. */
  | { type: "reset" }
  | { type: "lastRound"; who: string }
  /** Nothing they could do: no cards to draw, routes to claim or tickets left. */
  | { type: "pass"; who: string }
  | { type: "left"; who: string };

export interface TicketResult {
  id: number;
  done: boolean;
}

export interface PlayerScore {
  playerId: string;
  routePoints: number;
  tickets: TicketResult[];
  ticketPoints: number;
  longest: number;
  bonus: number;
  total: number;
  left: boolean;
}

export interface TtrResult {
  winners: string[];
  /** By seat order. */
  scores: PlayerScore[];
}

export interface TtrState extends Seating<TtrSeat> {
  config: TtrConfig;
  /** choosing: everyone picks their first tickets. */
  phase: "lobby" | "choosing" | "playing" | "over";
  game: number;
  /** Who went first last game; the next game starts with the player after them. */
  starter: number | null;
  /** Everyone dealt into the current (or last) game, by seat. */
  players: TtrPlayer[];
  deck: CardColor[];
  discard: CardColor[];
  faceUp: (CardColor | null)[];
  /** Ticket ids; drawn from the end, returned to the front. */
  ticketDeck: number[];
  turn: number | null;
  /** start: nothing done yet. second: drew one card, one to go. tickets: choosing drawn tickets. */
  stage: "start" | "second" | "tickets";
  /** After someone runs low on trains: who still gets a last turn, in order. */
  finalTurns: string[] | null;
  log: TtrEvent[];
  result: TtrResult | null;
  /** When the current turn's clock runs out (null: no clock), however the turn goes. */
  turnEndsAt: number | null;
  /** turn: the current turn's deadline, sooner for a player who's away. setup: choosing the first tickets. */
  timers: Timers<"turn" | "setup">;
}

export function createState(config: TtrConfig): TtrState {
  return {
    config,
    ...emptySeating<TtrSeat>(SEAT_COUNT),
    phase: "lobby",
    game: 0,
    starter: null,
    players: [],
    deck: [],
    discard: [],
    faceUp: [],
    ticketDeck: [],
    turn: null,
    stage: "start",
    finalTurns: null,
    log: [],
    result: null,
    turnEndsAt: null,
    timers: {},
  };
}

// --- helpers ---------------------------------------------------------------

export const emptyHand = (): Hand => Object.fromEntries(CARD_COLORS.map((c) => [c, 0])) as Hand;
const handSize = (h: Hand) => CARD_COLORS.reduce((n, c) => n + h[c], 0);

const active = (state: TtrState) => state.players.filter((p) => !p.left);

export function playerOf(state: TtrState, playerId: string): TtrPlayer | undefined {
  return state.players.find((p) => p.playerId === playerId && !p.left);
}

export function currentPlayer(state: TtrState): TtrPlayer | undefined {
  return state.phase === "playing" ? active(state).find((p) => p.seat === state.turn) : undefined;
}

export function claimsOf(state: TtrState): Claims {
  const claims: Claims = {};
  for (const p of state.players) for (const id of p.routes) claims[id] = p.playerId;
  return claims;
}

/** Both tracks of double routes are used with 4 or more players dealt in. */
export const bothTracks = (state: TtrState) => bothTracksFor(state.players.length);

function logEvent(state: TtrState, e: TtrEvent) {
  state.log.push(e);
  if (state.log.length > LOG_KEEP) state.log.splice(0, state.log.length - LOG_KEEP);
}

/** The top card of the deck, reshuffling the discards into it when it runs out; null if there are none. */
function takeFromDeck(state: TtrState, ctx: GameContext): CardColor | null {
  if (state.deck.length === 0 && state.discard.length > 0) {
    state.deck = shuffle(state.discard, ctx.randomInt);
    state.discard = [];
  }
  return state.deck.pop() ?? null;
}

const locosUp = (state: TtrState) => state.faceUp.filter((c) => c === "loco").length;

/** Fill empty face-up slots; three locomotives showing means all five are discarded and dealt again. */
function refillFaceUp(state: TtrState, ctx: GameContext) {
  for (let i = 0; i < FACE_UP; i++) if (state.faceUp[i] == null) state.faceUp[i] = takeFromDeck(state, ctx);
  // Redealing only helps if there are enough other cards to come up; otherwise leave it.
  for (let guard = 0; guard < 20 && locosUp(state) >= 3; guard++) {
    const others = [...state.deck, ...state.discard].filter((c) => c !== "loco").length;
    if (others < 3) break;
    state.discard.push(...state.faceUp.filter((c): c is CardColor => c !== null));
    state.faceUp = Array.from({ length: FACE_UP }, () => takeFromDeck(state, ctx));
    logEvent(state, { type: "reset" });
  }
}

const cardsLeft = (state: TtrState) => state.deck.length + state.discard.length;

/** Whether `player` could draw a card now, as their first or second. */
function canDraw(state: TtrState, second: boolean): boolean {
  return cardsLeft(state) > 0 || state.faceUp.some((c) => c !== null && !(second && c === "loco"));
}

// --- claiming --------------------------------------------------------------

export interface Payment {
  /** The color paid (a train color), or "loco" when it's all locomotives. */
  color: CardColor;
  locos: number;
}

/** Why `p` can't pay for `route` that way, or null if they can. */
function paymentError(p: TtrPlayer, route: Route, pay: Payment): string | null {
  const n = route.length;
  if (!Number.isInteger(pay.locos) || pay.locos < 0 || pay.locos > n) return "That's not a way to pay for it.";
  if (pay.color === "loco") {
    if (pay.locos !== n) return "Paying with locomotives only takes one for every train.";
  } else {
    if (pay.locos === n) return "Paying with locomotives only? Choose the locomotive color.";
    if (route.color !== "gray" && pay.color !== route.color) return `That route needs ${route.color} cards.`;
    if (p.hand[pay.color] < n - pay.locos) return `You don't have ${n - pay.locos} ${pay.color} cards.`;
  }
  if (p.hand.loco < pay.locos) return `You don't have ${pay.locos} locomotives.`;
  return null;
}

/** Why `p` can't claim the route at all right now, or null. */
function claimError(state: TtrState, p: TtrPlayer, route: Route): string | null {
  if (!routeOpen(claimsOf(state), route, p.playerId, bothTracks(state))) {
    if (claimsOf(state)[route.id]) return "That route is taken.";
    return bothTracks(state) ? "You can't have both tracks of a double route." : "Only one track of a double route is used with 2–3 players.";
  }
  if (p.trains < route.length) return `You only have ${p.trains} trains left.`;
  return null;
}

/**
 * Ways `p` can pay for a route: for each color they could use, the fewest
 * locomotives (or all locomotives, when that's the only way).
 */
export function paymentsFor(p: { hand: Hand; trains: number }, route: Route): Payment[] {
  if (p.trains < route.length) return [];
  const colors: TrainColor[] = route.color === "gray" ? [...TRAIN_COLORS] : [route.color];
  const out: Payment[] = [];
  for (const color of colors) {
    if (p.hand[color] === 0) continue;
    const locos = Math.max(0, route.length - p.hand[color]);
    if (locos < route.length && locos <= p.hand.loco) out.push({ color, locos });
  }
  if (out.length === 0 && p.hand.loco >= route.length) out.push({ color: "loco", locos: route.length });
  return out;
}

/** Routes `playerId` could claim on their turn now, with ways to pay. */
export function claimOptions(state: TtrState, playerId: string): { route: string; pay: Payment[] }[] {
  const p = currentPlayer(state);
  if (!p || p.playerId !== playerId || state.stage !== "start") return [];
  const claims = claimsOf(state);
  return ROUTES.filter((r) => routeOpen(claims, r, p.playerId, bothTracks(state)))
    .map((r) => ({ route: r.id, pay: paymentsFor(p, r) }))
    .filter((o) => o.pay.length > 0);
}

function hasAnyMove(state: TtrState, p: TtrPlayer): boolean {
  if (canDraw(state, false) || state.ticketDeck.length > 0) return true;
  const claims = claimsOf(state);
  return ROUTES.some((r) => routeOpen(claims, r, p.playerId, bothTracks(state)) && paymentsFor(p, r).length > 0);
}

// --- seating ---------------------------------------------------------------

export function canStart(state: TtrState): boolean {
  return (state.phase === "lobby" || state.phase === "over") && seatsWhere(state, (s) => !s.sittingOut).length >= 2;
}

export function sit(state: TtrState, playerId: string, seat: number) {
  // Sitting down mid-game is fine: you're dealt in next game.
  sitDown(state, playerId, seat, () => ({ gamesWon: 0 }));
}

export function leave(state: TtrState, playerId: string, ctx: GameContext) {
  requireSeat(state, playerId);
  const p = playerOf(state, playerId);
  if ((state.phase === "choosing" || state.phase === "playing") && p) {
    p.left = true;
    for (const c of CARD_COLORS) for (let i = 0; i < p.hand[c]; i++) state.discard.push(c);
    p.hand = emptyHand();
    state.ticketDeck.unshift(...p.tickets, ...(p.offered ?? []));
    p.tickets = [];
    p.offered = null;
    logEvent(state, { type: "left", who: playerId });
    if (state.finalTurns) state.finalTurns = state.finalTurns.filter((id) => id !== playerId);
    if (active(state).length < 2) finish(state, ctx);
    else if (state.phase === "choosing") maybeStartPlaying(state, ctx);
    else if (state.turn === p.seat) nextTurn(state, ctx, p.seat);
    else if (state.finalTurns?.length === 0) finish(state, ctx);
  }
  standUp(state, playerId);
}

export function setSittingOut(state: TtrState, playerId: string, away: boolean, ctx: GameContext) {
  setSeatSittingOut(state, playerId, away);
  const p = playerOf(state, playerId);
  if (!p) return;
  // Away while choosing your first tickets: they're chosen for you.
  if (away && state.phase === "choosing" && p.offered) {
    autoKeep(state, p, ctx);
    return maybeStartPlaying(state, ctx);
  }
  // On your turn: away, it's played for you soon; back, you have what's left of your turn.
  if (currentPlayer(state)?.playerId === playerId) setTurnTimer(state, p, ctx);
}

// --- the game --------------------------------------------------------------

export function start(state: TtrState, actor: string, ctx: GameContext) {
  requireSeat(state, actor);
  if (state.phase === "choosing" || state.phase === "playing") throw new GameError("in_progress", "A game is already on.");
  const seats = seatsWhere(state, (s) => !s.sittingOut);
  if (seats.length < 2) throw new GameError("not_enough_players", "Need at least two players at the table.");

  state.deck = shuffle([...TRAIN_COLORS.flatMap((c) => Array<CardColor>(CARDS_PER_COLOR).fill(c)), ...Array<CardColor>(LOCOS).fill("loco")], ctx.randomInt);
  state.discard = [];
  state.ticketDeck = shuffle(
    TICKETS.map((t) => t.id),
    ctx.randomInt,
  );
  state.players = seats.map((seat) => ({
    seat,
    playerId: state.seats[seat]!.playerId,
    trains: TRAINS,
    hand: emptyHand(),
    tickets: [],
    offered: null,
    keepAtLeast: 2,
    routes: [],
    points: 0,
    left: false,
    drawn: [],
  }));
  for (const p of state.players) {
    for (let i = 0; i < STARTING_CARDS; i++) p.hand[state.deck.pop()!]++;
    p.offered = state.ticketDeck.splice(-3);
  }
  state.faceUp = [];
  refillFaceUp(state, ctx);
  state.starter = state.starter === null ? seats[ctx.randomInt(seats.length)]! : nextClockwise(state.players, state.starter)!.seat;
  state.game++;
  state.phase = "choosing";
  state.turn = null;
  state.stage = "start";
  state.finalTurns = null;
  state.log = [];
  state.result = null;
  state.turnEndsAt = null;
  setTimer(state.timers, "turn", null);
  const secs = state.config.turnSeconds;
  setTimer(state.timers, "setup", secs > 0 ? ctx.now + secs * 2000 : null);
}

/** Keep some of the tickets you were offered (your first ones, or ones drawn on your turn). */
export function keep(state: TtrState, actor: string, ids: number[], ctx: GameContext) {
  const p = playerOf(state, actor);
  if (!p || !p.offered) throw new GameError("no_tickets", "You have no tickets to choose from.");
  if (state.phase === "playing" && (currentPlayer(state) !== p || state.stage !== "tickets")) throw new GameError("not_your_turn", "It's not your turn.");
  if (new Set(ids).size !== ids.length || ids.some((id) => !p.offered!.includes(id))) throw new GameError("bad_tickets", "Pick from the tickets you drew.");
  if (ids.length < p.keepAtLeast) throw new GameError("keep_more", `Keep at least ${p.keepAtLeast} ${p.keepAtLeast === 1 ? "ticket" : "tickets"}.`);
  const drew = p.offered.length;
  p.tickets.push(...ids);
  state.ticketDeck.unshift(...p.offered.filter((id) => !ids.includes(id)));
  p.offered = null;
  logEvent(state, { type: "tickets", who: actor, drew, kept: ids.length });
  if (state.phase === "choosing") maybeStartPlaying(state, ctx);
  else endTurn(state, ctx);
}

function autoKeep(state: TtrState, p: TtrPlayer, ctx: GameContext) {
  // The cheapest tickets: the least to lose.
  const ids = [...p.offered!].sort((a, b) => ticketById.get(a)!.points - ticketById.get(b)!.points).slice(0, p.keepAtLeast);
  keep(state, p.playerId, ids, ctx);
}

function maybeStartPlaying(state: TtrState, ctx: GameContext) {
  if (state.phase !== "choosing" || active(state).some((p) => p.offered)) return;
  state.phase = "playing";
  setTimer(state.timers, "setup", null);
  const first = active(state).find((p) => p.seat === state.starter) ?? nextClockwise(active(state), state.starter!)!;
  beginTurn(state, ctx, first.seat);
}

/** Draw a train card: blind from the deck, or face-up slot 0–4. */
export function drawCard(state: TtrState, actor: string, from: "deck" | number, ctx: GameContext) {
  const p = myTurn(state, actor);
  if (state.stage === "tickets") throw new GameError("choose_tickets", "Choose which tickets to keep first.");
  const second = state.stage === "second";
  // A new draw: forget the cards from the deck last time.
  if (!second) p.drawn = [];
  let card: CardColor | null;
  if (from === "deck") {
    card = takeFromDeck(state, ctx);
    if (!card) throw new GameError("deck_empty", "There are no cards left in the deck.");
    p.drawn.push(card);
    logEvent(state, { type: "card", who: actor, card: null });
  } else {
    card = state.faceUp[from] ?? null;
    if (!card) throw new GameError("empty_slot", "There's no card there.");
    if (second && card === "loco") throw new GameError("loco_second", "A face-up locomotive can't be your second card.");
    state.faceUp[from] = null;
    logEvent(state, { type: "card", who: actor, card });
    refillFaceUp(state, ctx);
  }
  p.hand[card]++;
  // A face-up locomotive is the whole draw; so is a second card, or a first with nothing left to take.
  if (second || (from !== "deck" && card === "loco") || !canDraw(state, true)) return endTurn(state, ctx);
  state.stage = "second";
}

export function claim(state: TtrState, actor: string, routeId: string, pay: Payment, ctx: GameContext) {
  const p = myTurn(state, actor);
  if (state.stage !== "start") throw new GameError("mid_turn", state.stage === "second" ? "Draw your second card." : "Choose which tickets to keep first.");
  const route = routeById.get(routeId);
  if (!route) throw new GameError("bad_route", "No such route.");
  const err = claimError(state, p, route) ?? paymentError(p, route, pay);
  if (err) throw new GameError("cant_claim", err);
  const spent: CardColor[] = [...Array<CardColor>(route.length - pay.locos).fill(pay.color), ...Array<CardColor>(pay.locos).fill("loco")];
  for (const c of spent) p.hand[c]--;
  state.discard.push(...spent);
  p.trains -= route.length;
  p.routes.push(route.id);
  p.points += ROUTE_POINTS[route.length]!;
  logEvent(state, { type: "claim", who: actor, route: route.id, color: pay.color, locos: pay.locos });
  // Cards spent can be needed to refill an empty face-up row.
  refillFaceUp(state, ctx);
  endTurn(state, ctx);
}

export function drawTickets(state: TtrState, actor: string) {
  const p = myTurn(state, actor);
  if (state.stage !== "start") throw new GameError("mid_turn", state.stage === "second" ? "Draw your second card." : "Choose which tickets to keep first.");
  if (state.ticketDeck.length === 0) throw new GameError("no_tickets_left", "There are no tickets left.");
  p.offered = state.ticketDeck.splice(-3);
  p.keepAtLeast = 1;
  state.stage = "tickets";
}

function myTurn(state: TtrState, actor: string): TtrPlayer {
  const p = currentPlayer(state);
  if (!p) throw new GameError("not_playing", state.phase === "choosing" ? "Everyone's still choosing tickets." : "There's no game on.");
  if (p.playerId !== actor) throw new GameError("not_your_turn", "It's not your turn.");
  return p;
}

function endTurn(state: TtrState, ctx: GameContext) {
  const p = currentPlayer(state)!;
  if (state.finalTurns) {
    state.finalTurns = state.finalTurns.filter((id) => id !== p.playerId);
    if (state.finalTurns.length === 0) return finish(state, ctx);
  } else if (p.trains <= 2) {
    // Everyone gets one more turn, ending with this player.
    const order: string[] = [];
    for (let q = nextClockwise(active(state), p.seat)!; ; q = nextClockwise(active(state), q.seat)!) {
      order.push(q.playerId);
      if (q === p) break;
    }
    state.finalTurns = order;
    logEvent(state, { type: "lastRound", who: p.playerId });
    ctx.announce(`${ctx.nameOf(p.playerId)} has ${p.trains} ${p.trains === 1 ? "train" : "trains"} left: last round! Everyone gets one more turn.`);
  }
  nextTurn(state, ctx, p.seat);
}

function nextTurn(state: TtrState, ctx: GameContext, from: number) {
  const next = nextClockwise(active(state), from);
  if (!next) return finish(state, ctx);
  beginTurn(state, ctx, next.seat);
}

/** Hand the turn to `seat`, passing over anyone who can't do anything at all. */
function beginTurn(state: TtrState, ctx: GameContext, seat: number) {
  for (let skipped = 0; skipped < active(state).length; skipped++) {
    const p = active(state).find((x) => x.seat === seat)!;
    if (!state.finalTurns || state.finalTurns.includes(p.playerId)) {
      if (hasAnyMove(state, p)) {
        state.turn = seat;
        state.stage = "start";
        const secs = state.config.turnSeconds;
        state.turnEndsAt = secs > 0 ? ctx.now + secs * 1000 : null;
        setTurnTimer(state, p, ctx);
        return;
      }
      logEvent(state, { type: "pass", who: p.playerId });
      if (state.finalTurns) {
        state.finalTurns = state.finalTurns.filter((id) => id !== p.playerId);
        if (state.finalTurns.length === 0) return finish(state, ctx);
      }
    }
    seat = nextClockwise(active(state), seat)!.seat;
  }
  // Nobody can do anything: the game is over.
  finish(state, ctx);
}

/** The turn's deadline: the end of its clock, or soon for a player who's away. */
function setTurnTimer(state: TtrState, p: TtrPlayer, ctx: GameContext) {
  const away = state.seats[p.seat]?.sittingOut ?? true;
  const ends = state.turnEndsAt;
  setTimer(state.timers, "turn", away ? Math.min(ends ?? Infinity, ctx.now + AUTO_PLAY_DELAY_MS) : ends);
}

/** Play the rest of the turn for someone away or out of time: cards from the deck, or whatever's left. */
function autoPlay(state: TtrState, ctx: GameContext) {
  const p = currentPlayer(state)!;
  // Each step moves the turn along; it's over when it's back at "start" (maybe theirs again, on its own clock).
  do {
    if (state.stage === "tickets") {
      autoKeep(state, p, ctx);
    } else if (canDraw(state, state.stage === "second")) {
      const slots = state.faceUp.flatMap((c, i) => (c && !(state.stage === "second" && c === "loco") ? [i] : []));
      drawCard(state, p.playerId, cardsLeft(state) > 0 ? "deck" : slots[ctx.randomInt(slots.length)]!, ctx);
    } else if (state.stage === "second") {
      endTurn(state, ctx);
    } else {
      const option = claimOptions(state, p.playerId)[0];
      if (option) claim(state, p.playerId, option.route, option.pay[0]!, ctx);
      else drawTickets(state, p.playerId);
    }
  } while (currentPlayer(state) === p && state.stage !== "start");
}

function finish(state: TtrState, ctx: GameContext) {
  state.phase = "over";
  state.turn = null;
  state.stage = "start";
  state.turnEndsAt = null;
  state.finalTurns = null;
  setTimer(state.timers, "turn", null);
  setTimer(state.timers, "setup", null);
  for (const p of state.players) {
    if (!p.offered) continue;
    state.ticketDeck.unshift(...p.offered);
    p.offered = null;
  }

  const scores: PlayerScore[] = state.players.map((p) => {
    const tickets = p.tickets.map((id) => {
      const t = ticketById.get(id)!;
      return { id, done: connects(p.routes, t.a, t.b) };
    });
    const ticketPoints = tickets.reduce((n, t) => n + (t.done ? 1 : -1) * ticketById.get(t.id)!.points, 0);
    return { playerId: p.playerId, routePoints: p.points, tickets, ticketPoints, longest: longestPath(p.routes), bonus: 0, total: 0, left: p.left };
  });
  const contenders = scores.filter((s) => !s.left);
  const longest = Math.max(0, ...contenders.map((s) => s.longest));
  for (const s of scores) {
    if (!s.left && longest > 0 && s.longest === longest) s.bonus = LONGEST_BONUS;
    s.total = s.routePoints + s.ticketPoints + s.bonus;
  }
  // Ties: most tickets completed, then the longest path.
  const rank = (s: PlayerScore) => [s.total, s.tickets.filter((t) => t.done).length, s.longest];
  const better = (a: PlayerScore, b: PlayerScore) => {
    const [x, y] = [rank(a), rank(b)];
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i]! - y[i]!;
    return 0;
  };
  const best = contenders.reduce<PlayerScore | null>((top, s) => (!top || better(s, top) > 0 ? s : top), null);
  const winners = best ? contenders.filter((s) => better(s, best) === 0).map((s) => s.playerId) : [];
  state.result = { winners, scores };
  for (const id of winners) {
    const seat = state.seats[seatOf(state, id)];
    if (seat) seat.gamesWon++;
  }
  const names = winners.map((id) => ctx.nameOf(id));
  const pts = best ? `${best.total} points` : "";
  ctx.announce(
    names.length === 0
      ? `Game ${state.game} is over.`
      : names.length === 1
        ? `Game ${state.game}: ${names[0]} wins with ${pts}!`
        : `Game ${state.game}: ${names.join(" & ")} share the win with ${pts} each.`,
  );
}

// --- timers ----------------------------------------------------------------

export function nextDeadline(state: TtrState): number | null {
  return nextTimer(state.timers);
}

export function onDeadline(state: TtrState, ctx: GameContext) {
  const due = takeDueTimer(state.timers, ctx.now);
  if (due === "setup" && state.phase === "choosing") {
    for (const p of active(state)) {
      if (!p.offered) continue;
      markAway(state, p);
      autoKeep(state, p, ctx);
    }
    maybeStartPlaying(state, ctx);
  } else if (due === "turn") {
    const p = currentPlayer(state);
    if (!p) return;
    // Out of time: you're marked away, and your turns are played for you until you're back.
    markAway(state, p);
    autoPlay(state, ctx);
  }
}

function markAway(state: TtrState, p: TtrPlayer) {
  const seat = state.seats[p.seat];
  if (seat?.playerId === p.playerId) seat.sittingOut = true;
}

// --- what can be done --------------------------------------------------------

/** Card draws `playerId` can make now: "deck" and face-up slots. */
export function drawOptions(state: TtrState, playerId: string): ("deck" | number)[] {
  const p = currentPlayer(state);
  if (!p || p.playerId !== playerId || state.stage === "tickets") return [];
  const second = state.stage === "second";
  const out: ("deck" | number)[] = [];
  if (cardsLeft(state) > 0) out.push("deck");
  state.faceUp.forEach((c, i) => {
    if (c && !(second && c === "loco")) out.push(i);
  });
  return out;
}

export function canDrawTickets(state: TtrState, playerId: string): boolean {
  const p = currentPlayer(state);
  return !!p && p.playerId === playerId && state.stage === "start" && state.ticketDeck.length > 0;
}

/** Every way to choose from offered tickets: subsets of at least `keepAtLeast`. */
export function keepOptions(state: TtrState, playerId: string): number[][] {
  const p = playerOf(state, playerId);
  if (!p?.offered) return [];
  if (state.phase === "playing" && (currentPlayer(state) !== p || state.stage !== "tickets")) return [];
  const offered = p.offered;
  const out: number[][] = [];
  for (let mask = 1; mask < 1 << offered.length; mask++) {
    const ids = offered.filter((_, i) => mask & (1 << i));
    if (ids.length >= p.keepAtLeast) out.push(ids);
  }
  return out;
}

export function waitingOn(state: TtrState): string[] {
  if (state.phase === "choosing") return active(state).flatMap((p) => (p.offered ? [p.playerId] : []));
  const p = currentPlayer(state);
  return p ? [p.playerId] : [];
}

export function checkInvariants(state: TtrState) {
  if (state.phase === "lobby") return;
  const cards = state.deck.length + state.discard.length + state.faceUp.filter((c) => c !== null).length + state.players.reduce((n, p) => n + handSize(p.hand), 0);
  if (cards !== TRAIN_COLORS.length * CARDS_PER_COLOR + LOCOS) throw new Error(`${cards} train cards`);
  for (const p of state.players) for (const c of CARD_COLORS) if (p.hand[c] < 0) throw new Error("negative cards");
  const tickets = [...state.ticketDeck, ...state.players.flatMap((p) => [...p.tickets, ...(p.offered ?? [])])];
  if (tickets.length !== TICKETS.length || new Set(tickets).size !== TICKETS.length) throw new Error(`${tickets.length} tickets`);
  const claimed = state.players.flatMap((p) => p.routes);
  if (new Set(claimed).size !== claimed.length) throw new Error("a route claimed twice");
  for (const p of state.players) {
    const used = p.routes.reduce((n, id) => n + routeById.get(id)!.length, 0);
    if (p.trains !== TRAINS - used) throw new Error(`${p.playerId} has ${p.trains} trains but used ${used}`);
    if (p.points !== p.routes.reduce((n, id) => n + ROUTE_POINTS[routeById.get(id)!.length]!, 0)) throw new Error("route points don't add up");
    for (const id of p.routes) {
      const twin = routeById.get(id)!.twin;
      if (twin && p.routes.includes(twin)) throw new Error(`${p.playerId} has both tracks of ${id}`);
      if (twin && !bothTracks(state) && claimed.includes(twin)) throw new Error(`both tracks of ${id} used with ${state.players.length} players`);
    }
    if (p.left && (handSize(p.hand) || p.tickets.length || p.offered)) throw new Error("a player who left still holds cards");
  }
  if (state.phase === "choosing" && !active(state).some((p) => p.offered)) throw new Error("everyone has chosen but still choosing");
  if (state.phase === "playing") {
    const p = currentPlayer(state);
    if (!p) throw new Error("nobody's turn");
    if ((state.stage === "tickets") !== !!p.offered) throw new Error("tickets stage without tickets");
    if (active(state).some((q) => q !== p && q.offered)) throw new Error("someone else is choosing tickets");
    if (state.stage === "second" && !canDraw(state, true)) throw new Error("waiting for a second card that can't be drawn");
  }
}

// --- views -----------------------------------------------------------------

export interface TtrPlayerView {
  seat: number;
  playerId: string;
  trains: number;
  cards: number;
  tickets: number;
  /** Points from routes so far. */
  points: number;
  left: boolean;
  /** Still choosing tickets. */
  choosing: boolean;
}

export interface TicketView extends Ticket {
  /** Whether your routes complete it (your own tickets only). */
  done: boolean;
}

export interface TtrView {
  config: TtrConfig;
  seats: (TtrSeat | null)[];
  phase: TtrState["phase"];
  game: number;
  players: TtrPlayerView[];
  /** Route id → who claimed it. */
  claims: Claims;
  /** Both tracks of double routes are in use (4–5 players). */
  bothTracks: boolean;
  faceUp: (CardColor | null)[];
  deckCount: number;
  discardCount: number;
  ticketCount: number;
  turn: number | null;
  stage: TtrState["stage"] | null;
  turnDeadline: number | null;
  setupDeadline: number | null;
  /** Who still gets a last turn, once the last round has begun. */
  finalTurns: string[] | null;
  log: TtrEvent[];
  result: TtrResult | null;
  canStart: boolean;
  you: {
    seat: number | null;
    inGame: boolean;
    hand: Hand | null;
    tickets: TicketView[];
    offered: Ticket[] | null;
    keepAtLeast: number;
    /** Cards you drew blind this turn (or last turn). */
    drawn: CardColor[];
  };
}

const ticketOf = (id: number): Ticket => {
  const t = ticketById.get(id)!;
  return { id: t.id, a: t.a, b: t.b, points: t.points };
};

/** Built field by field: never spread from state, so hands, tickets and decks can't leak. */
export function viewFor(state: TtrState, viewer: string): TtrView {
  const seat = seatOf(state, viewer);
  const me = playerOf(state, viewer);
  return {
    config: { turnSeconds: state.config.turnSeconds },
    seats: state.seats.map((s) => (s ? { playerId: s.playerId, sittingOut: s.sittingOut, gamesWon: s.gamesWon } : null)),
    phase: state.phase,
    game: state.game,
    players: state.players.map((p) => ({
      seat: p.seat,
      playerId: p.playerId,
      trains: p.trains,
      cards: handSize(p.hand),
      tickets: p.tickets.length,
      points: p.points,
      left: p.left,
      choosing: !!p.offered,
    })),
    claims: claimsOf(state),
    bothTracks: bothTracks(state),
    faceUp: [...state.faceUp],
    deckCount: state.deck.length,
    discardCount: state.discard.length,
    ticketCount: state.ticketDeck.length,
    turn: state.phase === "playing" ? state.turn : null,
    stage: state.phase === "playing" ? state.stage : null,
    turnDeadline: state.phase === "playing" ? (state.timers.turn ?? null) : null,
    setupDeadline: state.phase === "choosing" ? (state.timers.setup ?? null) : null,
    finalTurns: state.finalTurns ? [...state.finalTurns] : null,
    log: state.log.map((e) => ({ ...e })),
    result: state.result
      ? {
          winners: [...state.result.winners],
          scores: state.result.scores.map((s) => ({ ...s, tickets: s.tickets.map((t) => ({ id: t.id, done: t.done })) })),
        }
      : null,
    canStart: canStart(state),
    you: {
      seat: seat < 0 ? null : seat,
      inGame: !!me,
      hand: me ? { ...me.hand } : null,
      tickets: me ? me.tickets.map((id) => ({ ...ticketOf(id), done: connects(me.routes, ticketById.get(id)!.a, ticketById.get(id)!.b) })) : [],
      offered: me?.offered ? me.offered.map(ticketOf) : null,
      keepAtLeast: me?.offered ? me.keepAtLeast : 0,
      drawn: me ? [...me.drawn] : [],
    },
  };
}

export { routeName, ticketName };
