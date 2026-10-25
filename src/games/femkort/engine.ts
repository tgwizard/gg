/**
 * Fem kort, the old Swedish last-trick game, as a pure state machine.
 *
 * Rules (the common modern Swedish version): 2–6 players, a 52-card deck, ace high, no
 * trumps. Everyone gets five cards (three, then two). The player left of the dealer
 * leads; the others must follow suit if they can and, with överstick (`mustBeat`, the
 * rule since the 1940s), beat the best card of that suit so far if they can. With none
 * of the suit led you may play anything. The highest card of the suit led wins the
 * trick, and its winner leads the next. Only the fifth trick counts: whoever takes it
 * wins the deal. The deal passes clockwise, and the first to win `dealsToWin` deals
 * (or, with `twoInARow`, two deals running) wins the game.
 *
 * Bättre kort (`betterCards`): the player about to lead a trick (not the last) may ask
 * once per deal for new cards; if everyone else agrees, the cards are dealt again.
 *
 * Hidden information: hands and the undealt cards. Played cards are public, as at a
 * real table where they stay face up in front of each player.
 */
import { type Card, newDeck, shuffle } from "../kit/cards";
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
import { femBot } from "./bot";
import { cardText, HAND_SIZE, ledSuit, type Play, playable, sortHand, winningPlay } from "./rules";

export const SEAT_COUNT = 6;
/** How fast an away player's turns are played for them. */
export const AUTO_PLAY_DELAY_MS = 2500;
/** The pause after the last trick, to see who took it, before the next deal. */
export const NEXT_DEAL_MS = 5000;
/** How long the others have to answer a call for better cards (no answer is a no). */
export const VOTE_MS = 30_000;
/** Events kept in state. */
export const LOG_KEEP = 40;

export interface FemConfig {
  /** Seconds to play a card before one is played for you (and you're marked away); 0 = no clock. */
  turnSeconds: number;
  /** Deals to win the game. */
  dealsToWin: number;
  /** Överstick: you must beat the best card of the suit led if you can (the older rule only asks you to follow suit). */
  mustBeat: boolean;
  /** Winning two deals in a row also wins the game. */
  twoInARow: boolean;
  /** Bättre kort: the player on lead may ask for a new deal, which happens if everyone agrees. */
  betterCards: boolean;
}

export type FemSeat = Seat & { gamesWon: number };

export interface FemPlayer {
  seat: number;
  playerId: string;
  hand: Card[];
  /** Deals won this game. */
  deals: number;
  /** The cards that took the deals they won, in order. */
  wonWith: Card[];
  /** Left mid-game: out of the deals, but shown in the results. */
  left: boolean;
}

export interface Trick {
  plays: Play[];
  /** Seat that took it. */
  winner: number;
}

export type FemEvent =
  /** One of the first four tricks, which win nothing but the next lead. */
  | { type: "trick"; deal: number; n: number; winner: string; card: Card }
  /** The fifth trick, and with it the deal. */
  | { type: "deal"; deal: number; winner: string; card: Card }
  | { type: "ask"; deal: number; who: string }
  /** The answer to a call for better cards: everyone agreed, or who said no (or didn't answer). */
  | { type: "vote"; deal: number; passed: boolean; against: string[] }
  | { type: "left"; deal: number; who: string; redeal: boolean };

export interface FemState extends Seating<FemSeat> {
  config: FemConfig;
  phase: "lobby" | "playing" | "over";
  game: number;
  /** Deals so far this game, the current one included. */
  deal: number;
  dealer: number | null;
  /** Everyone in the current (or last) game, by seat. New players join at the next deal. */
  players: FemPlayer[];
  /** The cards nobody was dealt. Secret, and unused. */
  stock: Card[];
  /** The trick on the table, in the order played. */
  trick: Play[];
  /** The tricks taken this deal. */
  tricks: Trick[];
  /** Seat to play. */
  turn: number | null;
  /** The last trick is in; the next deal comes after a pause. */
  dealOver: boolean;
  /** Who won the last deals in a row, and how many. */
  streak: { playerId: string; count: number } | null;
  /** A call for better cards, waiting on everyone else's answer. */
  vote: { by: string; yes: string[] } | null;
  /** Who has asked for better cards this deal (once each). */
  asked: string[];
  /** The most recent events (LOG_KEEP of them). */
  log: FemEvent[];
  /** Events so far this game, so a view can tell which are new once the log is full. */
  logged: number;
  result: { winners: string[]; deals: Record<string, number>; reason: "deals" | "streak" | "left" } | null;
  /** When the current turn's clock runs out (null: no clock), whatever happens to "turn". */
  turnEndsAt: number | null;
  /** turn: the current turn's deadline (sooner when away); nextDeal: the pause after a deal; vote: answers due. */
  timers: Timers<"turn" | "nextDeal" | "vote">;
}

export function createState(config: FemConfig): FemState {
  return {
    config,
    ...emptySeating<FemSeat>(SEAT_COUNT),
    phase: "lobby",
    game: 0,
    deal: 0,
    dealer: null,
    players: [],
    stock: [],
    trick: [],
    tricks: [],
    turn: null,
    dealOver: false,
    streak: null,
    vote: null,
    asked: [],
    log: [],
    logged: 0,
    result: null,
    turnEndsAt: null,
    timers: {},
  };
}

// --- helpers ---------------------------------------------------------------

export const active = (state: FemState) => state.players.filter((p) => !p.left).sort((a, b) => a.seat - b.seat);

export function playerOf(state: FemState, playerId: string): FemPlayer | undefined {
  return state.players.find((p) => p.playerId === playerId && !p.left);
}

/** Whose card it is, while a deal is being played (and nobody is answering a call for better cards). */
export function currentPlayer(state: FemState): FemPlayer | undefined {
  if (state.phase !== "playing" || state.dealOver) return undefined;
  return active(state).find((p) => p.seat === state.turn);
}

function logEvent(state: FemState, e: FemEvent) {
  state.log.push(e);
  state.logged++;
  if (state.log.length > LOG_KEEP) state.log.splice(0, state.log.length - LOG_KEEP);
}

export function canStart(state: FemState): boolean {
  return state.phase !== "playing" && seatsWhere(state, (s) => !s.sittingOut).length >= 2;
}

/** The cards `playerId` may play now, or null if it isn't their turn to play. */
export function playableFor(state: FemState, playerId: string): Card[] | null {
  const p = currentPlayer(state);
  if (!p || p.playerId !== playerId || state.vote) return null;
  return sortHand(playable(p.hand, state.trick, state.config.mustBeat));
}

/** Whether `playerId` may ask for better cards now: on lead, before the last trick, once a deal. */
export function canAsk(state: FemState, playerId: string): boolean {
  return (
    state.config.betterCards &&
    !!playableFor(state, playerId) &&
    state.trick.length === 0 &&
    state.tricks.length < HAND_SIZE - 1 &&
    !state.asked.includes(playerId)
  );
}

/** Who still has to answer the call for better cards. */
export function voters(state: FemState): string[] {
  const vote = state.vote;
  if (!vote) return [];
  return active(state)
    .map((p) => p.playerId)
    .filter((id) => id !== vote.by && !vote.yes.includes(id));
}

// --- seating ---------------------------------------------------------------

export function sit(state: FemState, playerId: string, seat: number) {
  // Sitting down mid-game is fine: you're dealt in from the next deal.
  sitDown(state, playerId, seat, () => ({ gamesWon: 0 }));
}

export function leave(state: FemState, playerId: string, ctx: GameContext) {
  requireSeat(state, playerId);
  const p = playerOf(state, playerId);
  standUp(state, playerId);
  if (state.phase !== "playing" || !p) return;
  p.left = true;
  state.stock.push(...p.hand);
  p.hand = [];
  // Whoever's still at the table plays on, including anyone waiting to be dealt in.
  const enough = seatsWhere(state).length >= 2;
  const redeal = enough && !state.dealOver;
  logEvent(state, { type: "left", deal: state.deal, who: playerId, redeal });
  if (!enough) return finish(state, ctx, active(state).map((o) => o.playerId), "left");
  // A deal can't go on with a hand missing: it's dealt again without them.
  if (redeal) {
    ctx.announce(`${ctx.nameOf(playerId)} left, so the cards are dealt again.`);
    newDeal(state, ctx);
  }
}

export function setSittingOut(state: FemState, playerId: string, away: boolean, ctx: GameContext) {
  setSeatSittingOut(state, playerId, away);
  // Away while others are answering a call for better cards: that's a no.
  if (away && voters(state).includes(playerId)) return endVote(state, ctx, false, [playerId]);
  // On your turn: away, it's played for you soon; back, you have what's left of your turn.
  const p = currentPlayer(state);
  if (p?.playerId === playerId && !state.vote) setTurnTimer(state, p, ctx);
}

// --- the game --------------------------------------------------------------

/** A new game, for players at the table. */
export function start(state: FemState, actor: string, ctx: GameContext) {
  requireSeat(state, actor);
  if (state.phase === "playing") throw new GameError("in_progress", "A game is already on.");
  const seats = seatsWhere(state, (s) => !s.sittingOut);
  if (seats.length < 2) throw new GameError("not_enough_players", "Need at least two players at the table.");
  state.players = seats.map((seat) => ({ seat, playerId: state.seats[seat]!.playerId, hand: [], deals: 0, wonWith: [], left: false }));
  state.game++;
  state.deal = 0;
  state.phase = "playing";
  state.streak = null;
  state.result = null;
  state.log = [];
  state.logged = 0;
  newDeal(state, ctx);
}

/**
 * Deal the next hand: whoever has sat down since joins in, the deal passes clockwise,
 * and five cards each go out, three then two, starting left of the dealer, who leads.
 */
function newDeal(state: FemState, ctx: GameContext) {
  // Someone who left without winning a deal has nothing left to show (and seat churn mustn't pile them up).
  state.players = state.players.filter((p) => !p.left || p.deals > 0);
  for (const [seat, s] of state.seats.entries()) {
    if (!s) continue;
    const known = state.players.find((p) => p.playerId === s.playerId);
    if (!known) state.players.push({ seat, playerId: s.playerId, hand: [], deals: 0, wonWith: [], left: false });
    else if (known.left) Object.assign(known, { left: false, seat });
  }
  const players = active(state);
  state.dealer = state.dealer === null ? players[ctx.randomInt(players.length)]!.seat : nextClockwise(players, state.dealer)!.seat;
  const deck = shuffle(newDeck(), ctx.randomInt);
  for (const p of state.players) p.hand = [];
  const order = [...players.filter((p) => p.seat > state.dealer!), ...players.filter((p) => p.seat <= state.dealer!)];
  for (const round of [3, 2]) for (const p of order) p.hand.push(...deck.splice(0, round));
  state.stock = deck;
  state.deal++;
  state.trick = [];
  state.tricks = [];
  state.dealOver = false;
  state.vote = null;
  state.asked = [];
  setTimer(state.timers, "nextDeal", null);
  setTimer(state.timers, "vote", null);
  beginTurn(state, ctx, order[0]!.seat);
}

export function playCard(state: FemState, actor: string, card: Card, ctx: GameContext) {
  if (state.phase !== "playing") throw new GameError("not_playing", "There's no game on.");
  if (state.dealOver) throw new GameError("deal_over", "The next deal is coming.");
  if (state.vote) throw new GameError("vote_pending", "Wait for the answer about better cards.");
  const p = currentPlayer(state);
  if (!p || p.playerId !== actor) throw new GameError("not_your_turn", "It's not your turn.");
  if (!p.hand.includes(card)) throw new GameError("not_in_hand", "You don't have that card.");
  if (!playable(p.hand, state.trick, state.config.mustBeat).includes(card)) {
    const followed = card[1] === ledSuit(state.trick);
    throw new GameError(followed ? "must_beat" : "must_follow", followed ? "You must beat the best card of that suit if you can." : "You must follow suit.");
  }
  p.hand = p.hand.filter((c) => c !== card);
  state.trick.push({ seat: p.seat, playerId: p.playerId, card });
  if (state.trick.length < active(state).length) return beginTurn(state, ctx, nextClockwise(active(state), p.seat)!.seat);

  // The trick is complete.
  const win = winningPlay(state.trick)!;
  state.tricks.push({ plays: state.trick, winner: win.seat });
  state.trick = [];
  if (state.tricks.length < HAND_SIZE) {
    logEvent(state, { type: "trick", deal: state.deal, n: state.tricks.length, winner: win.playerId, card: win.card });
    return beginTurn(state, ctx, win.seat);
  }
  winDeal(state, ctx, win);
}

/** The last trick decides the deal. */
function winDeal(state: FemState, ctx: GameContext, win: Play) {
  const p = playerOf(state, win.playerId)!;
  p.deals++;
  p.wonWith.push(win.card);
  state.streak = state.streak?.playerId === p.playerId ? { playerId: p.playerId, count: state.streak.count + 1 } : { playerId: p.playerId, count: 1 };
  logEvent(state, { type: "deal", deal: state.deal, winner: p.playerId, card: win.card });
  ctx.announce(`Deal ${state.deal}: ${ctx.nameOf(p.playerId)} takes the last trick with the ${cardText(win.card)}.`);
  if (p.deals >= state.config.dealsToWin) return finish(state, ctx, [p.playerId], "deals");
  if (state.config.twoInARow && state.streak.count >= 2) return finish(state, ctx, [p.playerId], "streak");
  state.dealOver = true;
  state.turn = null;
  state.turnEndsAt = null;
  setTimer(state.timers, "turn", null);
  setTimer(state.timers, "nextDeal", ctx.now + NEXT_DEAL_MS);
}

/** Ask for better cards: everyone else says yes or no. */
export function askBetter(state: FemState, actor: string, ctx: GameContext) {
  if (!state.config.betterCards) throw new GameError("not_allowed", "This table doesn't play with better cards.");
  if (state.vote) throw new GameError("vote_pending", "Someone already asked.");
  if (!canAsk(state, actor)) throw new GameError("cant_ask", "You can ask for better cards once a deal, when it's your lead, before the last trick.");
  state.vote = { by: actor, yes: [] };
  state.asked.push(actor);
  logEvent(state, { type: "ask", deal: state.deal, who: actor });
  // Anyone away can't answer, which is a no.
  const away = voters(state).filter((id) => state.seats[seatOf(state, id)]?.sittingOut !== false);
  if (away.length) return endVote(state, ctx, false, away);
  setTimer(state.timers, "turn", null);
  setTimer(state.timers, "vote", ctx.now + VOTE_MS);
}

export function vote(state: FemState, actor: string, yes: boolean, ctx: GameContext) {
  if (!state.vote) throw new GameError("no_vote", "Nobody asked for better cards.");
  if (!voters(state).includes(actor)) throw new GameError("not_voting", "It's not up to you.");
  if (!yes) return endVote(state, ctx, false, [actor]);
  state.vote.yes.push(actor);
  if (!voters(state).length) endVote(state, ctx, true, []);
}

function endVote(state: FemState, ctx: GameContext, passed: boolean, against: string[]) {
  logEvent(state, { type: "vote", deal: state.deal, passed, against });
  state.vote = null;
  setTimer(state.timers, "vote", null);
  if (passed) {
    ctx.announce("Everyone agreed to better cards: new deal.");
    return newDeal(state, ctx);
  }
  // Play on: the leader gets a fresh clock.
  beginTurn(state, ctx, state.turn!);
}

/** Hand the turn to `seat`, starting its clock. */
function beginTurn(state: FemState, ctx: GameContext, seat: number) {
  state.turn = seat;
  const secs = state.config.turnSeconds;
  state.turnEndsAt = secs > 0 ? ctx.now + secs * 1000 : null;
  setTurnTimer(state, currentPlayer(state)!, ctx);
}

/** The turn's deadline: the end of its clock, or soon for a player who's away. */
function setTurnTimer(state: FemState, p: FemPlayer, ctx: GameContext) {
  const away = state.seats[p.seat]?.playerId === p.playerId ? state.seats[p.seat]!.sittingOut : true;
  const ends = state.turnEndsAt;
  setTimer(state.timers, "turn", away ? Math.min(ends ?? Infinity, ctx.now + AUTO_PLAY_DELAY_MS) : ends);
}

function finish(state: FemState, ctx: GameContext, winners: string[], reason: "deals" | "streak" | "left") {
  state.phase = "over";
  state.turn = null;
  state.turnEndsAt = null;
  state.dealOver = false;
  state.vote = null;
  state.timers = {};
  state.result = { winners, deals: Object.fromEntries(state.players.map((p) => [p.playerId, p.deals])), reason };
  for (const id of winners) {
    const seat = state.seats[seatOf(state, id)];
    if (seat) seat.gamesWon++;
  }
  const names = winners.map((id) => ctx.nameOf(id)).join(" & ");
  const n = winners.length ? playerOf(state, winners[0]!)!.deals : 0;
  ctx.announce(
    reason === "left"
      ? `Fem kort game ${state.game}: ${names || "nobody"} ${winners.length === 1 ? "wins" : "win"}: everyone else left.`
      : `Fem kort game ${state.game}: ${names} wins with ${reason === "streak" ? "two deals in a row" : `${n} ${n === 1 ? "deal" : "deals"}`}!`,
  );
}

export function nextDeadline(state: FemState): number | null {
  return nextTimer(state.timers);
}

export function onDeadline(state: FemState, ctx: GameContext) {
  switch (takeDueTimer(state.timers, ctx.now)) {
    case "nextDeal":
      if (state.phase === "playing" && state.dealOver) newDeal(state, ctx);
      return;
    case "vote":
      if (state.vote) endVote(state, ctx, false, voters(state));
      return;
    case "turn": {
      const p = currentPlayer(state);
      if (!p || state.vote) return;
      // Out of time: you're marked away, and your cards are played for you until you're back.
      const seat = state.seats[p.seat];
      if (seat?.playerId === p.playerId && !seat.sittingOut) seat.sittingOut = true;
      autoPlay(state, ctx, p);
      return;
    }
  }
}

/** Play a card for someone who's away or out of time: what the built-in bot would. */
function autoPlay(state: FemState, ctx: GameContext, p: FemPlayer) {
  const ops = playableFor(state, p.playerId)!.map((card) => ({ type: "play" as const, card }));
  const op = femBot.play(viewFor(state, p.playerId), ops, ctx.randomInt);
  playCard(state, p.playerId, op?.type === "play" ? op.card : ops[0]!.card, ctx);
}

export function waitingOn(state: FemState): string[] {
  if (state.vote) return voters(state);
  const p = currentPlayer(state);
  return p ? [p.playerId] : [];
}

export function checkInvariants(state: FemState) {
  if (state.phase === "lobby") return;
  const players = active(state);
  const cards = [...state.stock, ...state.players.flatMap((p) => p.hand), ...state.trick.map((p) => p.card), ...state.tricks.flatMap((t) => t.plays.map((p) => p.card))];
  if (cards.length !== 52) throw new Error(`${cards.length} cards, not 52`);
  if (new Set(cards).size !== 52) throw new Error("duplicate card");
  for (const p of state.players) if (p.left && p.hand.length) throw new Error("a player who left still holds cards");
  if (state.phase !== "playing") return;
  if (state.tricks.length > HAND_SIZE) throw new Error("too many tricks");
  if (state.dealOver) {
    // Someone may have left since (the next deal is without them).
    if (state.tricks.length !== HAND_SIZE || state.timers.nextDeal === undefined) throw new Error("a finished deal with no next deal coming");
    if (players.some((p) => p.hand.length)) throw new Error("cards in hand after the last trick");
    return;
  }
  if (players.length < 2) throw new Error("a deal with fewer than two players");
  for (const t of state.tricks) if (t.plays.length !== players.length) throw new Error("a trick with the wrong number of cards");
  const inTrick = new Set(state.trick.map((p) => p.seat));
  if (inTrick.size !== state.trick.length) throw new Error("a player played twice to a trick");
  for (const p of players) {
    const expected = HAND_SIZE - state.tricks.length - (inTrick.has(p.seat) ? 1 : 0);
    if (p.hand.length !== expected) throw new Error(`seat ${p.seat} holds ${p.hand.length} cards, not ${expected}`);
  }
  const p = currentPlayer(state);
  if (!p) throw new Error("nobody to play");
  if (inTrick.has(p.seat)) throw new Error("the player to play has already played to this trick");
  if (state.vote && !voters(state).length) throw new Error("a vote with nobody to answer");
}

// --- views -----------------------------------------------------------------

export interface FemPlayerView {
  seat: number;
  playerId: string;
  cardCount: number;
  deals: number;
  wonWith: Card[];
  left: boolean;
  /** Only for the viewer's own player. */
  hand: Card[] | null;
}

export interface FemView {
  config: FemConfig;
  seats: (FemSeat | null)[];
  phase: FemState["phase"];
  game: number;
  deal: number;
  dealer: number | null;
  players: FemPlayerView[];
  /** The trick on the table, in the order played. */
  trick: Play[];
  /** The tricks taken this deal. */
  tricks: Trick[];
  /** The trick being played, 1 to 5 (5 is the one that counts). */
  trickNo: number;
  /** The suit led to the trick on the table. */
  led: string | null;
  turn: number | null;
  turnDeadline: number | null;
  dealOver: boolean;
  nextDealAt: number | null;
  streak: FemState["streak"];
  vote: { by: string; yes: string[]; waiting: string[]; deadline: number | null } | null;
  log: FemEvent[];
  logged: number;
  result: FemState["result"];
  canStart: boolean;
  you: { seat: number | null; inGame: boolean; playable: Card[] | null; canAsk: boolean; canVote: boolean };
}

const copyPlay = (p: Play): Play => ({ seat: p.seat, playerId: p.playerId, card: p.card });

/** Built field by field: never spread from state, so hands and the stock can't leak. */
export function viewFor(state: FemState, viewer: string): FemView {
  const seat = seatOf(state, viewer);
  const vote = state.vote;
  return {
    config: { ...state.config },
    seats: state.seats.map((s) => (s ? { playerId: s.playerId, sittingOut: s.sittingOut, gamesWon: s.gamesWon } : null)),
    phase: state.phase,
    game: state.game,
    deal: state.deal,
    dealer: state.dealer,
    players: state.players.map((p) => {
      const mine = p.playerId === viewer && !p.left;
      return {
        seat: p.seat,
        playerId: p.playerId,
        cardCount: p.hand.length,
        deals: p.deals,
        wonWith: [...p.wonWith],
        left: p.left,
        hand: mine ? sortHand(p.hand) : null,
      };
    }),
    trick: state.trick.map(copyPlay),
    tricks: state.tricks.map((t) => ({ plays: t.plays.map(copyPlay), winner: t.winner })),
    trickNo: Math.min(HAND_SIZE, state.tricks.length + 1),
    led: ledSuit(state.trick),
    turn: state.phase === "playing" && !state.dealOver ? state.turn : null,
    turnDeadline: state.phase === "playing" ? (state.timers.turn ?? null) : null,
    dealOver: state.dealOver,
    nextDealAt: state.timers.nextDeal ?? null,
    streak: state.streak ? { playerId: state.streak.playerId, count: state.streak.count } : null,
    vote: vote ? { by: vote.by, yes: [...vote.yes], waiting: voters(state), deadline: state.timers.vote ?? null } : null,
    log: state.log.map((e) => ({ ...e }) as FemEvent),
    logged: state.logged,
    result: state.result ? { winners: [...state.result.winners], deals: { ...state.result.deals }, reason: state.result.reason } : null,
    canStart: canStart(state),
    you: {
      seat: seat < 0 ? null : seat,
      inGame: !!playerOf(state, viewer),
      playable: playableFor(state, viewer),
      canAsk: canAsk(state, viewer) && !vote,
      canVote: voters(state).includes(viewer),
    },
  };
}
