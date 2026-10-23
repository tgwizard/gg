/**
 * The Easy Ticket to Ride bot: keeps the tickets that are cheapest to finish, claims
 * routes on the cheapest path to its unfinished tickets, and otherwise draws cards,
 * preferring colors those routes need. With every ticket done it claims long routes
 * for points (and sometimes draws more tickets).
 */
import type { GameBot } from "../types";
import type { TtrView } from "./engine";
import { cheapestPath } from "./graph";
import { routeById, ticketById, type Route, type TrainColor } from "./map";
import type { TtrOp } from "./index";

export const ticketBot: GameBot<TtrView, TtrOp> = {
  easy(view, ops, rand) {
    const me = view.players.find((p) => p.seat === view.you.seat && !p.left);
    if (!me || !ops.length) return null;
    const pick = <T>(xs: T[]) => xs[rand(xs.length)]!;
    const plan = (a: string, b: string) => cheapestPath(view.claims, me.playerId, view.bothTracks, a, b);

    const keeps = ops.filter((op) => op.type === "keep");
    if (keeps.length) {
      // As few tickets as allowed, the cheapest to finish.
      const cost = (id: number) => {
        const t = ticketById.get(id)!;
        return plan(t.a, t.b)?.cost ?? 99;
      };
      const fewest = Math.min(...keeps.map((op) => op.tickets.length));
      const total = (ids: number[]) => ids.reduce((n, id) => n + cost(id), 0);
      return keeps.filter((op) => op.tickets.length === fewest).sort((a, b) => total(a.tickets) - total(b.tickets))[0]!;
    }

    // The routes still needed for unfinished tickets.
    const needed: Route[] = view.you.tickets.filter((t) => !t.done).flatMap((t) => plan(t.a, t.b)?.routes ?? []);
    const neededIds = new Set(needed.map((r) => r.id));
    const claims = ops.filter((op) => op.type === "claim");
    const length = (op: Extract<TtrOp, { type: "claim" }>) => routeById.get(op.route)!.length;
    const useful = claims.filter((op) => neededIds.has(op.route));
    if (useful.length) {
      const longest = Math.max(...useful.map(length));
      return pick(useful.filter((op) => length(op) === longest));
    }

    const draws = ops.filter((op) => op.type === "draw");
    const tickets = ops.find((op) => op.type === "tickets");
    if (!needed.length) {
      // Every ticket done (or out of reach): score with long routes, or try another ticket.
      if (tickets && me.trains > 15 && rand(3) === 0) return tickets;
      const long = claims.filter((op) => length(op) >= 3 || me.trains <= 6);
      if (long.length && (rand(2) === 0 || !draws.length)) return pick(long);
    }
    if (draws.length) {
      const wanted = new Set<string>(needed.map((r) => r.color).filter((c): c is TrainColor => c !== "gray"));
      const faceUp = draws.filter((op) => op.from !== "deck" && wanted.has(view.faceUp[op.from as number]!));
      if (faceUp.length) return pick(faceUp);
      const loco = draws.find((op) => op.from !== "deck" && view.faceUp[op.from as number] === "loco");
      if (loco && rand(3) === 0) return loco;
      return draws.find((op) => op.from === "deck") ?? pick(draws);
    }
    // No cards to draw: claim anything, or take tickets.
    if (claims.length) return pick(claims);
    return tickets ?? pick(ops);
  },
};
