import { type Policy, playUntil, type Scenario, scenarioContext } from "../kit/scenario";
import type { GameContext } from "../types";
import { ticketBot } from "./bot";
import { bothTracks, claimOptions, claimsOf, currentPlayer, mapOf, playerOf, type TtrState, type TtrView } from "./engine";
import { routeOpen } from "./graph";
import { TRAIN_COLORS, type TrainColor } from "./map";
import { mapById, MAPS } from "./maps";
import { type TtrOp, ticketToRide as game } from "./index";

/** Trains you're left with when the scenario starts: one claim from the last round. */
const YOUR_TRAINS = 3;
const SEED = 14;


/**
 * Plays like the built-in bot until it's down to 20 trains. Then it greedily draws three
 * more tickets and keeps them all, and spends its trains fast: the longest route that
 * leaves at least `keep`, otherwise cards from the deck.
 */
const rusher =
  (keep: number): Policy<TtrView, TtrOp> =>
  (view, ops, rand) => {
    const me = view.players.find((p) => p.seat === view.you.seat)!;
    const length = (op: Extract<TtrOp, { type: "claim" }>) => mapById(view.config.map).routeById.get(op.route)!.length;
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
function lastRound(players: string[], ctx: GameContext, map: string): { state: TtrState; seed: number } {
  // Not every game gets there (someone else can end it first): the first seed from SEED that does.
  let failed: unknown;
  for (let seed = SEED; seed < SEED + 50; seed++) {
    try {
      const c = scenarioContext(ctx, seed);
      const you = players[0]!;
      const state = game.create(game.configSchema.parse({ map }), c);
      players.forEach((id, seat) => game.apply(state, id, { type: "sit", seat }, c));
      game.apply(state, you, { type: "start" }, c);
      playUntil(game, state, c, (s) => currentPlayer(s)?.playerId === you && s.stage === "start" && playerOf(s, you)!.trains === YOUR_TRAINS, {
        policies: { [you]: rusher(YOUR_TRAINS) },
        seed,
      });
      if (state.finalTurns) throw new Error("the last round started early");
      holdCardsForLastClaim(state, you);
      return { state, seed };
    } catch (e) {
      failed = e;
    }
  }
  throw failed;
}

/** Make sure `playerId` holds the cards for the longest open route their trains reach. */
function holdCardsForLastClaim(state: TtrState, playerId: string) {
  const p = playerOf(state, playerId)!;
  const claims = claimsOf(state);
  const route = mapOf(state).routes.filter((r) => r.length <= p.trains && !r.ferry && routeOpen(claims, r, playerId, bothTracks(state))).sort((a, b) => b.length - a.length)[0];
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

/** The same moments on every map (North America's keep their plain ids). */
export const scenarios: Scenario<TtrState>[] = MAPS.flatMap((m): Scenario<TtrState>[] => {
  const id = (s: string) => (m.id === "usa" ? s : `${m.id}-${s}`);
  const on = m.id === "usa" ? "" : ` (${m.name})`;
  return [
    {
      id: id("last-round"),
      name: `Last round${on}`,
      description: "Your turn with 3 trains left: claim a route with them and everyone gets one last turn.",
      bots: 2,
      build: (players, ctx) => lastRound(players, ctx, m.id).state,
    },
    {
      id: id("game-over"),
      name: `Game over${on}`,
      description: "The last round played out: the final scores, with tickets done and failed and the longest-path bonus.",
      bots: 2,
      build(players, ctx) {
        const { state, seed } = lastRound(players, ctx, m.id);
        const c = scenarioContext(ctx, seed);
        playUntil(game, state, c, (s) => s.phase === "over", { policies: { [players[0]!]: rusher(0) }, seed });
        return state;
      },
    },
  ];
});
