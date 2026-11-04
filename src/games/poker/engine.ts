/**
 * No-limit Texas Hold'em, as a pure state machine over PokerState.
 *
 * All functions mutate the state they are given (the room hands us a private copy)
 * and throw GameError on illegal moves. Secrets (deck, hole cards) live in the
 * state; `viewFor` is the only thing that ever leaves the server.
 */
import {
  clockwiseDistance,
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
import { GameError, type GameContext } from "../types";
import { type Card, newDeck, shuffle } from "../kit/cards";
import { bestHand, compareScores, type HandValue } from "./evaluator";

export const SEAT_COUNT = 9;
export const RUNOUT_DELAY_MS = 1500;
export const NEXT_HAND_DELAY_MS = 6000;
export const RESUME_DELAY_MS = 2000;

export interface PokerConfig {
  startingStack: number;
  smallBlind: number;
  bigBlind: number;
  /** Seconds a player has to act before auto check/fold; 0 disables the clock. */
  turnSeconds: number;
  /** The blinds go up a level (BLIND_LEVELS) every this many hands; 0 or unset: never. */
  blindsUpEvery?: number;
  /** Whether a player out of chips may buy back in; unset is yes. Without, once you're out you're out (a freezeout). */
  rebuys?: boolean;
}

/** The blinds at each level, as multiples of the starting ones: they double every two levels. */
export const BLIND_LEVELS = [1, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64, 96, 128];

export interface Blinds {
  small: number;
  big: number;
  /** Index into BLIND_LEVELS. */
  level: number;
}

/** The blinds for hand number `handNumber` (1 is the first). */
export function blindsAt(config: PokerConfig, handNumber: number): Blinds {
  const every = config.blindsUpEvery ?? 0;
  const level = every > 0 ? Math.min(BLIND_LEVELS.length - 1, Math.floor(Math.max(0, handNumber - 1) / every)) : 0;
  const m = BLIND_LEVELS[level]!;
  return { small: config.smallBlind * m, big: config.bigBlind * m, level };
}

export function rebuysAllowed(config: PokerConfig): boolean {
  return config.rebuys !== false;
}

export type PokerSeat = Seat & { stack: number };

export type Street = "preflop" | "flop" | "turn" | "river";

export interface HandPlayer {
  seat: number;
  playerId: string;
  cards: Card[];
  folded: boolean;
  allIn: boolean;
  /** Chips put in on the current street. */
  bet: number;
  /** Chips put in over the whole hand. */
  committed: number;
  /** Has acted since the last bet/raise on this street. */
  acted: boolean;
  /**
   * hand.currentBet when this player last acted this street (null: hasn't acted).
   * They may re-raise only if the bet has since grown by at least a full raise,
   * whether through one raise or several short all-ins adding up to one.
   */
  actedAtBet: number | null;
  /** Hole cards are public (showdown or all-in runout). */
  shown: boolean;
  lastAction: string | null;
}

export interface LogEntry {
  street: Street;
  seat: number;
  playerId: string;
  action: string;
}

export interface PotResult {
  amount: number;
  eligible: number[];
  winners: number[];
}

export interface HandResult {
  uncontested: boolean;
  pots: PotResult[];
  /** seat -> chips won */
  payouts: Record<number, number>;
  /** seat -> made hand, for players that reached showdown */
  hands: Record<number, { name: string; cards: Card[] }>;
}

export interface Hand {
  id: number;
  button: number;
  sb: number;
  bb: number;
  /** The blinds this hand was dealt at (missing in hands from before blind levels: the config's). */
  blinds?: Blinds;
  deck: Card[];
  board: Card[];
  street: Street;
  status: "betting" | "runout" | "complete";
  /** Seats dealt into this hand, ascending. */
  players: HandPlayer[];
  toAct: number | null;
  currentBet: number;
  /** Size of the last full bet/raise this street: the minimum raise increment. */
  minRaise: number;
  result: HandResult | null;
  log: LogEntry[];
}

/** turn: the player to act's clock; runout: next street of an all-in runout; nextHand: deal again. */
export type PokerTimer = "turn" | "runout" | "nextHand";

export interface PokerState extends Seating<PokerSeat> {
  config: PokerConfig;
  button: number | null;
  handCount: number;
  hand: Hand | null;
  /** Someone pressed "deal"; hands keep coming automatically after that. */
  started: boolean;
  timers: Timers<PokerTimer>;
  /** Every chip ever handed out (buy-ins, rebuys): what's on the table must add up to this. */
  chipsIssued: number;
  /** Chips each player has bought in for, sitting down and rebuying (missing in games from before it was kept). */
  buyIns?: Record<string, number>;
}

export type PokerAction =
  | { type: "fold" }
  | { type: "check" }
  | { type: "call" }
  /** Bet or raise to a total of `to` chips on this street. */
  | { type: "raise"; to: number };

export interface LegalActions {
  canFold: true;
  canCheck: boolean;
  /** Chips needed to call (capped by stack); 0 if checking is possible. */
  toCall: number;
  canRaise: boolean;
  minRaiseTo: number;
  maxRaiseTo: number;
}

export function createState(config: PokerConfig): PokerState {
  return {
    config,
    ...emptySeating<PokerSeat>(SEAT_COUNT),
    button: null,
    handCount: 0,
    hand: null,
    started: false,
    timers: {},
    chipsIssued: 0,
    buyIns: {},
  };
}

// --- helpers ---------------------------------------------------------------

export { seatOf };

export function handInProgress(state: PokerState): boolean {
  return !!state.hand && state.hand.status !== "complete";
}

export function inCurrentHand(state: PokerState, seat: number): HandPlayer | undefined {
  if (!handInProgress(state)) return undefined;
  return state.hand!.players.find((p) => p.seat === seat);
}

function eligibleSeats(state: PokerState): number[] {
  return seatsWhere(state, (s) => s.stack > 0 && !s.sittingOut);
}

/** The big blind of the hand being played (the minimum bet and raise). */
function bigBlindOf(state: PokerState, hand: Hand): number {
  return hand.blinds?.big ?? state.config.bigBlind;
}

/** How many players' buy-ins are remembered; the longest gone that aren't at the table are forgotten first. */
const BUY_INS_KEEP = 64;

function noteBuyIn(state: PokerState, playerId: string, chips: number) {
  const buyIns = (state.buyIns ??= {});
  const before = buyIns[playerId] ?? 0;
  delete buyIns[playerId]; // to the end: most recent last
  buyIns[playerId] = before + chips;
  const here = new Set([...state.seats.flatMap((s) => (s ? [s.playerId] : [])), ...Object.keys(state.away)]);
  for (const id of Object.keys(buyIns)) {
    if (Object.keys(buyIns).length <= BUY_INS_KEEP) break;
    if (!here.has(id)) delete buyIns[id];
  }
}

/** How many times a player has bought back in (every buy-in is the starting chips). */
function rebuysOf(state: PokerState, playerId: string): number {
  return Math.max(0, Math.round((state.buyIns?.[playerId] ?? 0) / state.config.startingStack) - 1);
}

function seatList(seats: number[]) {
  return seats.map((seat) => ({ seat }));
}

function stackOf(state: PokerState, seat: number): PokerSeat {
  const s = state.seats[seat];
  if (!s) throw new Error(`no player in seat ${seat}`);
  return s;
}

function putIn(state: PokerState, p: HandPlayer, amount: number) {
  const seat = stackOf(state, p.seat);
  const amt = Math.min(amount, seat.stack);
  seat.stack -= amt;
  p.bet += amt;
  p.committed += amt;
  if (seat.stack === 0) p.allIn = true;
  return amt;
}

/** Everyone else still in the hand is all-in: nobody is left to bet against. */
function othersAllIn(hand: Hand, p: HandPlayer): boolean {
  return hand.players.every((o) => o === p || o.folded || o.allIn);
}

/**
 * The bet `p` has to match: the current bet, or with everyone else all-in, only what
 * they actually put in (a short all-in big blind is less than the big blind).
 */
function betToMatch(hand: Hand, p: HandPlayer): number {
  if (!othersAllIn(hand, p)) return hand.currentBet;
  return Math.min(hand.currentBet, Math.max(0, ...hand.players.filter((o) => o !== p && !o.folded).map((o) => o.bet)));
}

function needsAction(hand: Hand, p: HandPlayer): boolean {
  if (p.folded || p.allIn) return false;
  // With everyone else all-in there's nothing to decide once you've matched them.
  if (othersAllIn(hand, p)) return p.bet < betToMatch(hand, p);
  return !p.acted || p.bet < hand.currentBet;
}

/** Hand history kept in state (views show the last 40). */
const LOG_KEEP = 100;

function log(hand: Hand, p: HandPlayer, action: string) {
  p.lastAction = action;
  hand.log.push({ street: hand.street, seat: p.seat, playerId: p.playerId, action });
  if (hand.log.length > LOG_KEEP) hand.log.splice(0, hand.log.length - LOG_KEEP);
}

function setToAct(state: PokerState, seat: number, ctx: GameContext) {
  const hand = state.hand!;
  hand.toAct = seat;
  const secs = state.config.turnSeconds;
  setTimer(state.timers, "turn", secs > 0 ? ctx.now + secs * 1000 : null);
}

// --- seating ---------------------------------------------------------------

export function sit(state: PokerState, playerId: string, seat: number, ctx: GameContext) {
  // Returning players get their old stack back (standing up must not top you up).
  sitDown(state, playerId, seat, () => {
    state.chipsIssued += state.config.startingStack;
    noteBuyIn(state, playerId, state.config.startingStack);
    return { stack: state.config.startingStack };
  });
  maybeScheduleNextHand(state, ctx);
}

export function leave(state: PokerState, playerId: string, ctx: GameContext) {
  const p = inCurrentHand(state, requireSeat(state, playerId));
  if (p && !p.folded) foldOutOfTurn(state, p, ctx);
  // Chips already committed stay in the pot; the hand keeps a record of the player. Players
  // gone so long they're forgotten take their chips with them.
  standUp(state, playerId, (gone) => (state.chipsIssued -= gone.stack));
}

export function setSittingOut(state: PokerState, playerId: string, sittingOut: boolean, ctx: GameContext) {
  setSeatSittingOut(state, playerId, sittingOut);
  if (!sittingOut) maybeScheduleNextHand(state, ctx);
}

export function rebuy(state: PokerState, playerId: string, ctx: GameContext) {
  const seat = requireSeat(state, playerId);
  if (!rebuysAllowed(state.config)) throw new GameError("no_rebuys", "There are no rebuys at this table: once you're out, you're out.");
  if (inCurrentHand(state, seat)) throw new GameError("in_hand", "Wait for the hand to finish.");
  const s = stackOf(state, seat);
  if (s.stack > 0) throw new GameError("has_chips", "You can only rebuy when you're out of chips.");
  s.stack = state.config.startingStack;
  state.chipsIssued += state.config.startingStack;
  noteBuyIn(state, playerId, state.config.startingStack);
  const n = rebuysOf(state, playerId);
  ctx.announce(`${ctx.nameOf(playerId)} buys back in for ${state.config.startingStack.toLocaleString("en-US")} (${n === 1 ? "first rebuy" : `rebuy #${n}`}).`);
  maybeScheduleNextHand(state, ctx);
}

export function canStart(state: PokerState): boolean {
  return !handInProgress(state) && eligibleSeats(state).length >= 2;
}

/** Deal (the first hand, or the next one early): for players at the table only. */
export function start(state: PokerState, actor: string, ctx: GameContext) {
  requireSeat(state, actor);
  if (handInProgress(state)) throw new GameError("in_progress", "A hand is already in progress.");
  if (eligibleSeats(state).length < 2)
    throw new GameError("not_enough_players", "Need at least two seated players with chips.");
  state.started = true;
  startHand(state, ctx);
}

/** After a seat change, resume dealing if the game was running and now has enough players. */
function maybeScheduleNextHand(state: PokerState, ctx: GameContext) {
  if (state.started && !handInProgress(state) && state.timers.nextHand === undefined && eligibleSeats(state).length >= 2) {
    setTimer(state.timers, "nextHand", ctx.now + RESUME_DELAY_MS);
  }
}

// --- hand lifecycle --------------------------------------------------------

export function startHand(state: PokerState, ctx: GameContext): boolean {
  setTimer(state.timers, "nextHand", null);
  const eligible = eligibleSeats(state);
  if (eligible.length < 2) return false;

  let button =
    state.button === null
      ? eligible[ctx.randomInt(eligible.length)]!
      : nextClockwise(seatList(eligible), state.button)!.seat;
  const headsUp = eligible.length === 2;
  // Heads-up, the button posts the small blind. Going heads-up from a bigger table, the
  // usual move could make last hand's big blind post it again: then they get the button.
  const lastBb = state.hand?.bb;
  if (headsUp && lastBb !== undefined && eligible.includes(lastBb) && button !== lastBb) button = lastBb;
  const sb = headsUp ? button : nextClockwise(seatList(eligible), button)!.seat;
  const bb = nextClockwise(seatList(eligible), sb)!.seat;

  const players: HandPlayer[] = eligible.map((seat) => ({
    seat,
    playerId: state.seats[seat]!.playerId,
    cards: [],
    folded: false,
    allIn: false,
    bet: 0,
    committed: 0,
    acted: false,
    actedAtBet: null,
    shown: false,
    lastAction: null,
  }));

  const blinds = blindsAt(state.config, state.handCount + 1);
  if (blinds.level > (state.hand?.blinds?.level ?? 0)) ctx.announce(`The blinds are up to ${blinds.small}/${blinds.big}.`);

  const deck = shuffle(newDeck(), ctx.randomInt);
  // Deal one card at a time, starting left of the button.
  const order = [...players].sort((a, b) => ((a.seat - button + SEAT_COUNT - 1) % SEAT_COUNT) - ((b.seat - button + SEAT_COUNT - 1) % SEAT_COUNT));
  for (let round = 0; round < 2; round++) for (const p of order) p.cards.push(deck.pop()!);

  const hand: Hand = {
    id: state.handCount + 1,
    button,
    sb,
    bb,
    blinds,
    deck,
    board: [],
    street: "preflop",
    status: "betting",
    players,
    toAct: null,
    currentBet: blinds.big,
    minRaise: blinds.big,
    result: null,
    log: [],
  };
  state.hand = hand;
  state.handCount = hand.id;
  state.button = button;

  const sbPlayer = players.find((p) => p.seat === sb)!;
  const bbPlayer = players.find((p) => p.seat === bb)!;
  log(hand, sbPlayer, `Small blind ${putIn(state, sbPlayer, blinds.small)}`);
  log(hand, bbPlayer, `Big blind ${putIn(state, bbPlayer, blinds.big)}`);

  advance(state, bb, ctx);
  return true;
}

export function legalActions(state: PokerState, seat: number): LegalActions | null {
  const hand = state.hand;
  if (!hand || hand.status !== "betting" || hand.toAct !== seat) return null;
  const p = hand.players.find((x) => x.seat === seat);
  const s = state.seats[seat];
  if (!p || !s) return null;
  const owed = Math.max(0, betToMatch(hand, p) - p.bet);
  const othersCanAct = !othersAllIn(hand, p);
  const maxRaiseTo = p.bet + s.stack;
  return {
    canFold: true,
    canCheck: owed === 0,
    toCall: Math.min(owed, s.stack),
    canRaise: s.stack > owed && othersCanAct && (p.actedAtBet === null || hand.currentBet - p.actedAtBet >= hand.minRaise),
    minRaiseTo: Math.min(hand.currentBet + hand.minRaise, maxRaiseTo),
    maxRaiseTo,
  };
}

export function act(state: PokerState, playerId: string, action: PokerAction, ctx: GameContext) {
  const hand = state.hand;
  if (!hand || hand.status !== "betting") throw new GameError("no_betting", "There's no betting right now.");
  const seat = seatOf(state, playerId);
  if (seat < 0 || hand.toAct !== seat) throw new GameError("not_your_turn", "It's not your turn.");
  const legal = legalActions(state, seat)!;
  const p = hand.players.find((x) => x.seat === seat)!;

  switch (action.type) {
    case "fold":
      p.folded = true;
      log(hand, p, "Fold");
      break;
    case "check":
      if (!legal.canCheck) throw new GameError("cannot_check", `You must call ${legal.toCall} or fold.`);
      log(hand, p, "Check");
      break;
    case "call": {
      if (legal.canCheck) throw new GameError("nothing_to_call", "There's nothing to call.");
      const amt = putIn(state, p, legal.toCall);
      log(hand, p, p.allIn ? `Call ${amt} (all-in)` : `Call ${amt}`);
      break;
    }
    case "raise": {
      const to = action.to;
      if (!legal.canRaise) throw new GameError("cannot_raise", "You can't raise right now.");
      if (!Number.isInteger(to) || to > legal.maxRaiseTo) throw new GameError("bad_amount", "You don't have that many chips.");
      if (to < legal.minRaiseTo) throw new GameError("bad_amount", `The minimum is ${legal.minRaiseTo}.`);
      const wasBet = hand.currentBet === 0;
      putIn(state, p, to - p.bet);
      const increment = to - hand.currentBet;
      // A full raise sets the new minimum increment; a short all-in leaves it alone.
      if (increment >= hand.minRaise) hand.minRaise = increment;
      hand.currentBet = to;
      for (const o of hand.players) if (o !== p && !o.folded && !o.allIn) o.acted = false;
      log(hand, p, p.allIn ? `All-in ${to}` : wasBet ? `Bet ${to}` : `Raise to ${to}`);
      break;
    }
  }
  p.acted = true;
  p.actedAtBet = hand.currentBet;
  advance(state, seat, ctx);
}

/** Fold a player regardless of whose turn it is (leaving the table mid-hand). */
function foldOutOfTurn(state: PokerState, p: HandPlayer, ctx: GameContext) {
  const hand = state.hand!;
  p.folded = true;
  log(hand, p, "Fold (left)");
  const live = hand.players.filter((x) => !x.folded);
  if (live.length === 1) return finishUncontested(state, live[0]!, ctx);
  if (hand.status !== "betting" || hand.toAct === null) return;
  // Play moves on from them, or from whoever's to act if this leaves them nothing to decide
  // (everyone they were betting against is all-in); otherwise their turn and clock stand.
  const current = hand.players.find((x) => x.seat === hand.toAct)!;
  if (current === p || !needsAction(hand, current)) advance(state, hand.toAct, ctx);
}

function advance(state: PokerState, from: number, ctx: GameContext) {
  const hand = state.hand!;
  const live = hand.players.filter((p) => !p.folded);
  if (live.length === 1) return finishUncontested(state, live[0]!, ctx);

  const next = nextClockwise(hand.players, from, (p) => needsAction(hand, p));
  if (next) return setToAct(state, next.seat, ctx);
  endStreet(state, ctx);
}

function endStreet(state: PokerState, ctx: GameContext) {
  const hand = state.hand!;
  hand.toAct = null;
  setTimer(state.timers, "turn", null);
  for (const p of hand.players) {
    p.bet = 0;
    p.acted = false;
    p.actedAtBet = null;
  }
  hand.currentBet = 0;
  hand.minRaise = bigBlindOf(state, hand);

  if (hand.street === "river") return showdown(state, ctx);

  const live = hand.players.filter((p) => !p.folded);
  if (live.filter((p) => !p.allIn).length <= 1) {
    // Nobody left to bet against: reveal and deal out the rest, a street at a time.
    hand.status = "runout";
    for (const p of live) p.shown = true;
    setTimer(state.timers, "runout", ctx.now + RUNOUT_DELAY_MS);
    return;
  }

  dealStreet(hand);
  const first = nextClockwise(hand.players, hand.button, (p) => needsAction(hand, p));
  if (first) setToAct(state, first.seat, ctx);
  else endStreet(state, ctx);
}

function dealStreet(hand: Hand) {
  hand.deck.pop(); // burn
  if (hand.street === "preflop") {
    hand.board.push(hand.deck.pop()!, hand.deck.pop()!, hand.deck.pop()!);
    hand.street = "flop";
  } else if (hand.street === "flop") {
    hand.board.push(hand.deck.pop()!);
    hand.street = "turn";
  } else {
    hand.board.push(hand.deck.pop()!);
    hand.street = "river";
  }
}

/** Give back the part of the biggest bet nobody could match. */
function returnUncalled(state: PokerState, hand: Hand) {
  const sorted = [...hand.players].sort((a, b) => b.committed - a.committed);
  const [top, second] = sorted;
  // A folded player's chips (e.g. a blind left behind by someone who stood up) are dead money.
  if (!top || !second || top.folded) return;
  const excess = top.committed - second.committed;
  if (excess > 0) {
    top.committed -= excess;
    const seat = state.seats[top.seat];
    if (seat && seat.playerId === top.playerId) seat.stack += excess;
  }
}

export function buildPots(players: HandPlayer[]): PotResult[] {
  const levels = [...new Set(players.filter((p) => !p.folded && p.committed > 0).map((p) => p.committed))].sort(
    (a, b) => a - b,
  );
  const pots: PotResult[] = [];
  let prev = 0;
  for (const level of levels) {
    let amount = 0;
    for (const p of players) amount += Math.max(0, Math.min(p.committed, level) - prev);
    const eligible = players.filter((p) => !p.folded && p.committed >= level).map((p) => p.seat);
    if (amount > 0) pots.push({ amount, eligible, winners: [] });
    prev = level;
  }
  // Folded chips above the highest live commitment (can't normally happen) go to the last pot.
  const total = players.reduce((n, p) => n + p.committed, 0);
  const counted = pots.reduce((n, p) => n + p.amount, 0);
  if (pots.length && total > counted) pots[pots.length - 1]!.amount += total - counted;
  return pots;
}

function pay(state: PokerState, hand: Hand, seat: number, amount: number, payouts: Record<number, number>) {
  payouts[seat] = (payouts[seat] ?? 0) + amount;
  const p = hand.players.find((x) => x.seat === seat)!;
  const s = state.seats[seat];
  // A player who left mid-hand forfeits; only pay whoever still holds the seat.
  if (s && s.playerId === p.playerId) s.stack += amount;
}

function completeHand(state: PokerState, ctx: GameContext) {
  const hand = state.hand!;
  hand.status = "complete";
  hand.toAct = null;
  setTimer(state.timers, "turn", null);
  setTimer(state.timers, "runout", null);
  setTimer(state.timers, "nextHand", state.started ? ctx.now + NEXT_HAND_DELAY_MS : null);
  for (const p of hand.players) {
    const s = state.seats[p.seat];
    if (s && s.playerId === p.playerId && s.stack === 0)
      ctx.announce(`${ctx.nameOf(p.playerId)} is out of chips${rebuysAllowed(state.config) ? "." : ", and out of the game: no rebuys at this table."}`);
  }
}

function finishUncontested(state: PokerState, winner: HandPlayer, ctx: GameContext) {
  const hand = state.hand!;
  returnUncalled(state, hand);
  const amount = hand.players.reduce((n, p) => n + p.committed, 0);
  const payouts: Record<number, number> = {};
  pay(state, hand, winner.seat, amount, payouts);
  hand.result = {
    uncontested: true,
    pots: [{ amount, eligible: [winner.seat], winners: [winner.seat] }],
    payouts,
    hands: {},
  };
  ctx.announce(`Hand #${hand.id}: ${ctx.nameOf(winner.playerId)} wins ${amount}.`);
  completeHand(state, ctx);
}

function showdown(state: PokerState, ctx: GameContext) {
  const hand = state.hand!;
  returnUncalled(state, hand);
  const live = hand.players.filter((p) => !p.folded);
  const values = new Map<number, HandValue>();
  for (const p of live) {
    p.shown = true;
    values.set(p.seat, bestHand([...p.cards, ...hand.board]));
  }

  const pots = buildPots(hand.players);
  const payouts: Record<number, number> = {};
  // Odd chips go to the first winner clockwise from the button.
  const clockwise = (seat: number) => clockwiseDistance(hand.button, seat, SEAT_COUNT);
  pots.forEach((pot, i) => {
    let best: HandValue | null = null;
    let winners: number[] = [];
    for (const seat of pot.eligible) {
      const v = values.get(seat)!;
      const cmp = best ? compareScores(v.score, best.score) : 1;
      if (cmp > 0) {
        best = v;
        winners = [seat];
      } else if (cmp === 0) winners.push(seat);
    }
    winners.sort((a, b) => clockwise(a) - clockwise(b));
    pot.winners = winners;
    const share = Math.floor(pot.amount / winners.length);
    let remainder = pot.amount - share * winners.length;
    for (const seat of winners) {
      pay(state, hand, seat, share + (remainder > 0 ? 1 : 0), payouts);
      remainder--;
    }
    const label = pots.length === 1 ? "" : i === 0 ? " (main pot)" : ` (side pot ${i})`;
    const names = winners.map((s) => ctx.nameOf(hand.players.find((p) => p.seat === s)!.playerId));
    const verb = winners.length > 1 ? `split ${pot.amount}` : `wins ${pot.amount}`;
    ctx.announce(`Hand #${hand.id}: ${names.join(" & ")} ${verb}${label} with ${best!.name}.`);
  });

  hand.result = {
    uncontested: false,
    pots,
    payouts,
    hands: Object.fromEntries([...values].map(([seat, v]) => [seat, { name: v.name, cards: v.cards }])),
  };
  completeHand(state, ctx);
}

// --- timers ----------------------------------------------------------------

export function nextDeadline(state: PokerState): number | null {
  return nextTimer(state.timers);
}

export function onDeadline(state: PokerState, ctx: GameContext) {
  const hand = state.hand;
  const due = takeDueTimer(state.timers, ctx.now);
  if (due === "turn" && hand?.status === "betting" && hand.toAct !== null) {
    // Out of time: check if free, otherwise fold, and sit the player out until they're back.
    const seat = hand.toAct;
    const legal = legalActions(state, seat)!;
    const playerId = state.seats[seat]!.playerId;
    act(state, playerId, legal.canCheck ? { type: "check" } : { type: "fold" }, ctx);
    const s = state.seats[seat];
    if (s) s.sittingOut = true;
    const p = hand.players.find((x) => x.seat === seat)!;
    p.lastAction = `${p.lastAction} (timeout)`;
    return;
  }
  if (due === "runout" && hand?.status === "runout") {
    dealStreet(hand);
    if (hand.street === "river") showdown(state, ctx);
    else setTimer(state.timers, "runout", ctx.now + RUNOUT_DELAY_MS);
    return;
  }
  if (due === "nextHand") startHand(state, ctx);
}

// --- views -----------------------------------------------------------------

export interface HandPlayerView {
  seat: number;
  playerId: string;
  /** Null when hidden from the viewer. */
  cards: Card[] | null;
  folded: boolean;
  allIn: boolean;
  bet: number;
  committed: number;
  lastAction: string | null;
}

export interface HandView {
  id: number;
  button: number;
  sb: number;
  bb: number;
  blinds: Blinds;
  board: Card[];
  street: Street;
  status: Hand["status"];
  toAct: number | null;
  currentBet: number;
  actionDeadline: number | null;
  /** All chips committed this hand, including current-street bets. */
  pot: number;
  players: HandPlayerView[];
  result: HandResult | null;
  log: LogEntry[];
}

export interface LedgerLine {
  playerId: string;
  /** Chips bought in for, all told. */
  boughtIn: number;
  /** Times they've bought back in after running out. */
  rebuys: number;
  /** Chips they have now: their stack, and what they've put in the hand being played. */
  chips: number;
}

export interface PokerView {
  config: PokerConfig;
  seats: (PokerSeat | null)[];
  started: boolean;
  nextHandAt: number | null;
  hand: HandView | null;
  /** The blinds now: the hand's, or between hands the next one's. */
  blinds: Blinds;
  /** When the blinds go up next (a hand number), and to what; null if they don't. */
  nextBlinds: (Blinds & { atHand: number }) | null;
  /** Who's bought in for how much, and what they have now, most recent first. */
  ledger: LedgerLine[];
  you: { seat: number | null; actions: LegalActions | null };
}

/**
 * Redacted view for one player. Built field by field (never spread from state) so
 * new secret fields can't leak by accident.
 */
export function viewFor(state: PokerState, viewer: string): PokerView {
  const hand = state.hand;
  const seat = seatOf(state, viewer);
  const live = handInProgress(state);
  // Between hands, the blinds the next one will be dealt at.
  const handNumber = live ? state.handCount : state.handCount + 1;
  const blinds = live && hand!.blinds ? hand!.blinds : blindsAt(state.config, handNumber);
  const every = state.config.blindsUpEvery ?? 0;
  const atHand = (blinds.level + 1) * every + 1;
  const nextBlinds = every > 0 && blinds.level < BLIND_LEVELS.length - 1 ? { ...blindsAt(state.config, atHand), atHand } : null;
  const chipsOf = (playerId: string) => {
    const at = seatOf(state, playerId);
    const inHand = live ? (hand!.players.find((p) => p.playerId === playerId && !p.folded)?.committed ?? 0) : 0;
    return (at >= 0 ? state.seats[at]!.stack : (state.away[playerId]?.stack ?? 0)) + inHand;
  };
  return {
    config: {
      startingStack: state.config.startingStack,
      smallBlind: state.config.smallBlind,
      bigBlind: state.config.bigBlind,
      turnSeconds: state.config.turnSeconds,
      blindsUpEvery: every,
      rebuys: rebuysAllowed(state.config),
    },
    seats: state.seats.map((s) => (s ? { playerId: s.playerId, stack: s.stack, sittingOut: s.sittingOut } : null)),
    started: state.started,
    nextHandAt: state.timers.nextHand ?? null,
    hand: hand && {
      id: hand.id,
      button: hand.button,
      sb: hand.sb,
      bb: hand.bb,
      blinds: hand.blinds ? { ...hand.blinds } : { small: state.config.smallBlind, big: state.config.bigBlind, level: 0 },
      board: [...hand.board],
      street: hand.street,
      status: hand.status,
      toAct: hand.toAct,
      currentBet: hand.currentBet,
      actionDeadline: hand.status === "betting" ? (state.timers.turn ?? null) : null,
      pot: hand.players.reduce((n, p) => n + p.committed, 0),
      players: hand.players.map((p) => ({
        seat: p.seat,
        playerId: p.playerId,
        cards: p.playerId === viewer || p.shown ? [...p.cards] : null,
        folded: p.folded,
        allIn: p.allIn,
        bet: p.bet,
        committed: p.committed,
        lastAction: p.lastAction,
      })),
      result: hand.result,
      log: hand.log.slice(-40),
    },
    blinds: { ...blinds },
    nextBlinds,
    ledger: Object.entries(state.buyIns ?? {})
      .reverse()
      .map(([playerId, boughtIn]) => ({ playerId, boughtIn, rebuys: rebuysOf(state, playerId), chips: chipsOf(playerId) })),
    you: { seat: seat >= 0 ? seat : null, actions: seat >= 0 ? legalActions(state, seat) : null },
  };
}
