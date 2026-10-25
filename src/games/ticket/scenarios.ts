import { type Policy, playUntil, type Scenario, scenarioContext } from "../kit/scenario";
import type { GameContext } from "../types";
import { ticketBot } from "./bot";
import { bothTracks, claimOptions, claimsOf, currentPlayer, playerOf, type TtrState, type TtrView } from "./engine";
import { routeOpen } from "./graph";
import { ROUTES, routeById, TRAIN_COLORS, type TrainColor } from "./map";
import { type TtrOp, ticketToRide as game } from "./index";

/** Trains you're left with when the scenario starts: one claim from the last round. */
const YOUR_TRAINS = 3;
const SEED = 14;

const length = (op: Extract<TtrOp, { type: "claim" }>) => routeById.get(op.route)!.length;

/**
 * Plays like the built-in bot until it's down to 20 trains. Then it greedily draws three
 * more tickets and keeps them all, and spends its trains fast: the longest route that
 * leaves at least `keep`, otherwise cards from the deck.
 */
const rusher =
  (keep: number): Policy<TtrView, TtrOp> =>
  (view, ops, rand) => {
    const me = view.players.find((p) => p.seat === view.you.seat)!;
    if (me.trains > 20 || view.phase === "choosing") return ticketBot.play(view, ops, rand);
    const keeps = ops.filter((op) => op.type === "keep");
    if (keeps.length) return keeps.reduce((most, op) => (op.tickets.length > most.tickets.length ? op : most));
    const tickets = ops.find((op) => op.type === "tickets");
    if (tickets && me.tickets < 4) return tickets;
    const claims = ops.filter((op) => op.type === "claim" && me.trains - length(op) >= keep) as Extract<TtrOp, { type: "claim" }>[];
    if (claims.length) return claims.reduce((best, op) => (length(op) > length(best) ? op : best));
    return ops.find((op) => op.type === "draw" && op.from === "deck") ?? ticketBot.play(view, ops, rand);
  };

/**
 * Three players well into a game (seeded, so it's the same map every time): your turn,
 * with 3 trains left and cards to claim a route with them, which starts the last round.
 * You played the built-in bot's game, then took on more tickets and rushed, so some of
 * yours aren't done.
 */
function lastRound(players: string[], ctx: GameContext): TtrState {
  const c = scenarioContext(ctx, SEED);
  const you = players[0]!;
  const state = game.create(game.configSchema.parse({}), c);
  players.forEach((id, seat) => game.apply(state, id, { type: "sit", seat }, c));
  game.apply(state, you, { type: "start" }, c);
  playUntil(game, state, c, (s) => currentPlayer(s)?.playerId === you && s.stage === "start" && playerOf(s, you)!.trains === YOUR_TRAINS, {
    policies: { [you]: rusher(YOUR_TRAINS) },
    seed: SEED,
  });
  if (state.finalTurns) throw new Error("the last round started early");
  holdCardsForLastClaim(state, you);
  return state;
}

/** Make sure `playerId` holds the cards for the longest open route their trains reach. */
function holdCardsForLastClaim(state: TtrState, playerId: string) {
  const p = playerOf(state, playerId)!;
  const claims = claimsOf(state);
  const route = ROUTES.filter((r) => r.length <= p.trains && routeOpen(claims, r, playerId, bothTracks(state))).sort((a, b) => b.length - a.length)[0];
  if (!route) throw new Error("no route left to claim");
  if (claimOptions(state, playerId).some((o) => o.route === route.id)) return;
  // Take them from the deck (or the discards), so every card is still somewhere.
  const color = route.color === "gray" ? TRAIN_COLORS.reduce((a, b) => (left(state, b) > left(state, a) ? b : a)) : route.color;
  for (let i = p.hand[color]; i < route.length; i++) {
    const pile = state.deck.includes(color) ? state.deck : state.discard;
    if (!pile.includes(color)) throw new Error(`no ${color} cards left`);
    pile.splice(pile.indexOf(color), 1);
    p.hand[color]++;
  }
}

/** Cards of a color in the deck and discards. */
const left = (state: TtrState, color: TrainColor) => [...state.deck, ...state.discard].filter((c) => c === color).length;

export const scenarios: Scenario<TtrState>[] = [
  {
    id: "last-round",
    name: "Last round",
    description: "Your turn with 3 trains left: claim a route with them and everyone gets one last turn.",
    bots: 2,
    build: lastRound,
  },
  {
    id: "game-over",
    name: "Game over",
    description: "The last round played out: the final scores, with tickets done and failed and the longest-path bonus.",
    bots: 2,
    build(players, ctx) {
      const state = lastRound(players, ctx);
      const c = scenarioContext(ctx, SEED);
      playUntil(game, state, c, (s) => s.phase === "over", { policies: { [players[0]!]: rusher(0) }, seed: SEED });
      return state;
    },
  },
];
