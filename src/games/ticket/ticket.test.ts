import { describe, expect, it } from "vitest";
import { botMove } from "../kit/bot";
import { seededRandomInt } from "../kit/testing";
import type { GameContext } from "../types";
import {
  AUTO_PLAY_DELAY_MS,
  claim,
  createState,
  currentPlayer,
  drawCard,
  drawTickets,
  emptyHand,
  type Hand,
  keep,
  leave,
  nextDeadline,
  onDeadline,
  setSittingOut,
  sit,
  start,
  type TtrState,
  viewFor,
} from "./engine";
import { cheapestPath, connects, longestPath } from "./graph";
import { ticketToRide } from "./index";
import { ROUTES, TICKETS } from "./map";

function setup(n: number, opts: { seed?: number; turnSeconds?: number; choose?: boolean } = {}) {
  const announcements: string[] = [];
  const rand = seededRandomInt(opts.seed ?? 1);
  const ctx = (now = 0): GameContext => ({ now, randomInt: rand, nameOf: (id) => id, announce: (t) => announcements.push(t) });
  const state = createState({ turnSeconds: opts.turnSeconds ?? 60 });
  const ids = ["a", "b", "c", "d", "e"].slice(0, n);
  ids.forEach((id, i) => sit(state, id, i));
  state.starter = n - 1; // so "a" (seat 0) goes first
  start(state, "a", ctx());
  if (opts.choose !== false) for (const id of ids) keep(state, id, player(state, id).offered!.slice(0, 2), ctx());
  return { state, ctx, announcements, ids };
}

const player = (state: TtrState, id: string) => state.players.find((p) => p.playerId === id)!;
const turnOf = (state: TtrState) => currentPlayer(state)?.playerId;
const hand = (cards: Partial<Hand>): Hand => ({ ...emptyHand(), ...cards });

/** Give a player an exact hand, putting the cards they had back in the deck. */
function rigHand(state: TtrState, id: string, cards: Partial<Hand>) {
  const p = player(state, id);
  const want = hand(cards);
  for (const c of Object.keys(want) as (keyof Hand)[]) {
    for (; p.hand[c] > 0; p.hand[c]--) state.deck.push(c);
    for (; p.hand[c] < want[c]; p.hand[c]++) {
      const i = state.deck.lastIndexOf(c);
      if (i >= 0) state.deck.splice(i, 1);
      else state.discard.splice(state.discard.lastIndexOf(c), 1);
    }
  }
}

/** Put exact cards face up (taken from the deck), the old ones going back. */
function rigFaceUp(state: TtrState, cards: TtrState["faceUp"]) {
  state.deck.push(...state.faceUp.filter((c) => c !== null));
  state.faceUp = cards.map((c) => {
    if (c) state.deck.splice(state.deck.indexOf(c), 1);
    return c;
  });
}

/** The next cards drawn blind from the deck, first first. */
function rigDeck(state: TtrState, cards: TtrState["deck"]) {
  for (const c of cards) state.deck.splice(state.deck.indexOf(c), 1);
  state.deck.push(...[...cards].reverse());
}

describe("starting", () => {
  it("deals 4 cards and offers 3 tickets each, with 5 cards face up, and waits for everyone to choose", () => {
    const { state } = setup(3, { choose: false });
    expect(state.phase).toBe("choosing");
    for (const p of state.players) {
      expect(Object.values(p.hand).reduce((a, b) => a + b, 0)).toBe(4);
      expect(p.offered).toHaveLength(3);
      expect(p.trains).toBe(45);
    }
    expect(state.faceUp.filter(Boolean)).toHaveLength(5);
    expect(ticketToRide.waitingOn(state)).toEqual(["a", "b", "c"]);
  });

  it("needs at least 2 of the first tickets kept, then the first player starts", () => {
    const { state, ctx } = setup(2, { choose: false });
    const a = player(state, "a");
    expect(() => keep(state, "a", a.offered!.slice(0, 1), ctx())).toThrow(/at least 2/);
    keep(state, "a", a.offered!, ctx());
    expect(a.tickets).toHaveLength(3);
    expect(state.phase).toBe("choosing");
    keep(state, "b", player(state, "b").offered!.slice(1), ctx());
    expect(state.ticketDeck).toHaveLength(30 - 6 + 1);
    expect(state.phase).toBe("playing");
    expect(turnOf(state)).toBe("a");
  });

  it("chooses the cheapest tickets for anyone out of time, and marks them away", () => {
    const { state, ctx } = setup(2, { choose: false, turnSeconds: 30 });
    keep(state, "a", player(state, "a").offered!, ctx());
    const offered = player(state, "b").offered!.map((id) => TICKETS[id]!);
    expect(nextDeadline(state)).toBe(60_000);
    onDeadline(state, ctx(60_000));
    const cheapest = [...offered].sort((x, y) => x.points - y.points).slice(0, 2);
    expect(player(state, "b").tickets.sort()).toEqual(cheapest.map((t) => t.id).sort());
    expect(state.seats[1]!.sittingOut).toBe(true);
    expect(state.phase).toBe("playing");
  });
});

describe("drawing cards", () => {
  it("takes two cards, blind or face up, refilling the face-up row", () => {
    const { state, ctx } = setup(2);
    rigHand(state, "a", {});
    rigFaceUp(state, ["red", "blue", "green", "white", "black"]);
    rigDeck(state, ["pink", "orange"]);
    drawCard(state, "a", 0, ctx());
    expect(state.faceUp[0]).toBe("pink");
    expect(turnOf(state)).toBe("a");
    drawCard(state, "a", "deck", ctx());
    expect(player(state, "a").hand).toEqual(hand({ red: 1, orange: 1 }));
    expect(player(state, "a").drawn).toEqual(["orange"]);
    expect(turnOf(state)).toBe("b");
    expect(state.log.slice(-2)).toEqual([
      { type: "card", who: "a", card: "red" },
      { type: "card", who: "a", card: null },
    ]);
  });

  it("a face-up locomotive is the whole draw, and can't be the second card", () => {
    const { state, ctx } = setup(2);
    rigFaceUp(state, ["loco", "loco", "green", "white", "black"]);
    rigDeck(state, ["red", "blue", "pink"]);
    drawCard(state, "a", 2, ctx());
    expect(() => drawCard(state, "a", 0, ctx())).toThrow(/locomotive/);
    drawCard(state, "a", "deck", ctx());
    expect(turnOf(state)).toBe("b");
    drawCard(state, "b", 0, ctx());
    expect(turnOf(state)).toBe("a");
  });

  it("three face-up locomotives: all five are discarded and replaced", () => {
    const { state, ctx } = setup(2);
    rigFaceUp(state, ["loco", "loco", "green", "white", "black"]);
    rigDeck(state, ["loco", "red", "blue", "pink", "orange", "yellow"]);
    drawCard(state, "a", 2, ctx()); // a locomotive comes up: three
    expect(state.faceUp).toEqual(["red", "blue", "pink", "orange", "yellow"]);
    expect(state.discard).toEqual(expect.arrayContaining(["loco", "loco", "loco", "white", "black"]));
    expect(state.log.at(-1)).toEqual({ type: "reset" });
  });

  it("shuffles the discards into an empty deck", () => {
    const { state, ctx } = setup(2);
    state.discard.push(...state.deck.splice(0));
    drawCard(state, "a", "deck", ctx());
    expect(state.discard).toHaveLength(0);
    expect(state.deck.length).toBeGreaterThan(50);
  });
});

describe("claiming routes", () => {
  it("pays cards of the route's color, locomotives standing in, and scores it", () => {
    const { state, ctx } = setup(2);
    rigHand(state, "a", { yellow: 4, loco: 3 });
    claim(state, "a", "SEA-HEL", { color: "yellow", locos: 2 }, ctx());
    const a = player(state, "a");
    expect(a.hand).toEqual(hand({ yellow: 0, loco: 1 }));
    expect(a.trains).toBe(39);
    expect(a.points).toBe(15);
    expect(a.routes).toEqual(["SEA-HEL"]);
    expect(turnOf(state)).toBe("b");
  });

  it("refuses the wrong color, too few cards, and taken routes", () => {
    const { state, ctx } = setup(2);
    rigHand(state, "a", { red: 3, blue: 2 });
    expect(() => claim(state, "a", "SEA-HEL", { color: "red", locos: 0 }, ctx())).toThrow(/yellow/);
    expect(() => claim(state, "a", "VAN-CAL", { color: "blue", locos: 0 }, ctx())).toThrow(/3 blue/);
    claim(state, "a", "VAN-CAL", { color: "red", locos: 0 }, ctx()); // gray: any one color
    rigHand(state, "b", { red: 3 });
    expect(() => claim(state, "b", "VAN-CAL", { color: "red", locos: 0 }, ctx())).toThrow(/taken/);
  });

  it("can pay with locomotives only", () => {
    const { state, ctx } = setup(2);
    rigHand(state, "a", { loco: 2 });
    expect(() => claim(state, "a", "DUL-OMA/1", { color: "red", locos: 2 }, ctx())).toThrow(/locomotive color/);
    claim(state, "a", "DUL-OMA/1", { color: "loco", locos: 2 }, ctx());
    expect(player(state, "a").points).toBe(2);
  });

  it("uses one track of a double route with 2–3 players", () => {
    const { state, ctx } = setup(3);
    rigHand(state, "a", { red: 3 });
    claim(state, "a", "SLC-DEN/1", { color: "red", locos: 0 }, ctx());
    rigHand(state, "b", { yellow: 3 });
    expect(() => claim(state, "b", "SLC-DEN/2", { color: "yellow", locos: 0 }, ctx())).toThrow(/one track/);
  });

  it("uses both tracks with 4–5 players, but never both for one player", () => {
    const { state, ctx } = setup(4);
    rigHand(state, "a", { red: 3, yellow: 3 });
    claim(state, "a", "SLC-DEN/1", { color: "red", locos: 0 }, ctx());
    for (const id of ["b", "c", "d"]) drawCard(state, id, "deck", ctx()), drawCard(state, id, "deck", ctx());
    expect(() => claim(state, "a", "SLC-DEN/2", { color: "yellow", locos: 0 }, ctx())).toThrow(/both tracks/);
    drawCard(state, "a", "deck", ctx());
    drawCard(state, "a", "deck", ctx());
    rigHand(state, "b", { yellow: 3 });
    claim(state, "b", "SLC-DEN/2", { color: "yellow", locos: 0 }, ctx());
    expect(player(state, "b").routes).toEqual(["SLC-DEN/2"]);
  });

  it("needs enough trains", () => {
    const { state, ctx } = setup(2);
    rigHand(state, "a", { yellow: 6 });
    player(state, "a").trains = 5;
    player(state, "a").routes = []; // (the invariant isn't checked here)
    expect(() => claim(state, "a", "SEA-HEL", { color: "yellow", locos: 0 }, ctx())).toThrow(/5 trains/);
  });
});

describe("drawing tickets", () => {
  it("draws three, keeps at least one, and returns the rest under the pile", () => {
    const { state, ctx } = setup(2);
    const top = state.ticketDeck.slice(-3);
    drawTickets(state, "a");
    expect(player(state, "a").offered).toEqual(top);
    expect(() => drawCard(state, "a", "deck", ctx())).toThrow(/tickets/);
    expect(() => keep(state, "a", [], ctx())).toThrow(/at least 1/);
    keep(state, "a", [top[1]!], ctx());
    expect(state.ticketDeck.slice(0, 2)).toEqual([top[0], top[2]]);
    expect(player(state, "a").tickets).toContain(top[1]);
    expect(turnOf(state)).toBe("b");
  });

  it("keeps someone else's choice to themselves", () => {
    const { state } = setup(2);
    drawTickets(state, "a");
    const b = viewFor(state, "b");
    expect(b.you.offered).toBeNull();
    expect(b.players[0]!.choosing).toBe(true);
    expect(JSON.stringify(b)).not.toContain(JSON.stringify(player(state, "a").offered));
  });
});

describe("the end", () => {
  it("starts the last round at 2 trains or fewer: everyone gets one more turn", () => {
    const { state, ctx, announcements } = setup(3);
    player(state, "b").trains = 4; // as if it had used 41 already
    player(state, "b").routes = [];
    drawCard(state, "a", "deck", ctx());
    drawCard(state, "a", "deck", ctx());
    rigHand(state, "b", { red: 2 });
    claim(state, "b", "DUL-OMA/1", { color: "red", locos: 0 }, ctx());
    expect(state.finalTurns).toEqual(["c", "a", "b"]);
    expect(announcements.at(-1)).toMatch(/last round/);
    for (const id of ["c", "a", "b"]) {
      expect(state.phase).toBe("playing");
      drawCard(state, id, "deck", ctx());
      drawCard(state, id, "deck", ctx());
    }
    expect(state.phase).toBe("over");
  });

  it("scores routes, tickets (plus or minus) and the longest railway", () => {
    const { state, ctx } = setup(2);
    const a = player(state, "a");
    const b = player(state, "b");
    // a: Denver–El Paso (4 points) done via Santa Fe; b: Kansas City–Houston (5) not done.
    a.tickets = [TICKETS.findIndex((t) => t.a === "DEN" && t.b === "ELP")];
    b.tickets = [TICKETS.findIndex((t) => t.a === "KAN" && t.b === "HOU")];
    state.ticketDeck = TICKETS.map((t) => t.id).filter((id) => id !== a.tickets[0] && id !== b.tickets[0]);
    rigHand(state, "a", { red: 4 });
    claim(state, "a", "DEN-SAF", { color: "red", locos: 0 }, ctx());
    rigHand(state, "b", { blue: 2 });
    claim(state, "b", "KAN-OKC/1", { color: "blue", locos: 0 }, ctx());
    claim(state, "a", "SAF-ELP", { color: "red", locos: 0 }, ctx());
    leave(state, "b", ctx()); // b leaves, so the game is over: a wins alone
    expect(state.phase).toBe("over");
    const scores = state.result!.scores;
    expect(scores.find((s) => s.playerId === "a")).toMatchObject({ routePoints: 4, ticketPoints: 4, longest: 4, bonus: 10, total: 18 });
    expect(scores.find((s) => s.playerId === "b")).toMatchObject({ ticketPoints: 0, left: true, bonus: 0 });
    expect(state.result!.winners).toEqual(["a"]);
  });

  it("breaks ties on completed tickets", () => {
    const { state, ctx } = setup(2);
    const [a, b] = [player(state, "a"), player(state, "b")];
    a.tickets = [];
    b.tickets = [TICKETS.findIndex((t) => t.a === "DEN" && t.b === "ELP")];
    state.ticketDeck = TICKETS.map((t) => t.id).filter((id) => id !== b.tickets[0]);
    // a: 9 route points, longest 4 (Denver–Omaha), no tickets: 19.
    // b: 5 route points, longest 4 (Denver–Santa Fe–El Paso), Denver–El Paso done (4): 19.
    a.routes = ["SEA-POR/1", "VAN-SEA/1", "DEN-OMA"];
    a.trains = 45 - 6;
    a.points = 1 + 1 + 7;
    b.routes = ["DEN-SAF", "SAF-ELP"];
    b.trains = 45 - 4;
    b.points = 4;
    b.routes.push("OMA-KAN/1");
    b.trains -= 1;
    b.points += 1;
    state.finalTurns = ["a"];
    drawCard(state, "a", "deck", ctx());
    drawCard(state, "a", "deck", ctx());
    const s = state.result!.scores;
    expect(s.map((x) => x.total)).toEqual([19, 19]);
    expect(state.result!.winners).toEqual(["b"]);
  });
});

describe("the map as a graph", () => {
  it("finds the longest path through branches and loops, each route once", () => {
    // Denver–Kansas City (4), then round the loop of Kansas City–Omaha's two tracks (1 + 1).
    expect(longestPath(["OMA-KAN/1", "OMA-KAN/2", "DEN-KAN/1"])).toBe(6);
    // With Omaha–Duluth (2) as well, the loop can't be used both ways: Duluth–Omaha–Kansas City–Denver.
    expect(longestPath(["OMA-KAN/1", "OMA-KAN/2", "DEN-KAN/1", "DUL-OMA/1"])).toBe(7);
    expect(longestPath(["SEA-HEL", "CAL-HEL", "HEL-DEN"])).toBe(10);
    expect(longestPath([])).toBe(0);
  });

  it("connects cities through any path", () => {
    expect(connects(["DEN-SAF", "SAF-ELP"], "ELP", "DEN")).toBe(true);
    expect(connects(["DEN-SAF", "SAF-ELP"], "ELP", "OKC")).toBe(false);
  });

  it("plans around routes others have, using your own for free", () => {
    const path = cheapestPath({ "DEN-SAF": "me", "SAF-ELP": "you" }, "me", false, "DEN", "ELP")!;
    expect(path.routes.map((r) => r.id)).toEqual(["PHX-ELP", "PHX-SAF"]);
    expect(path.cost).toBe(6);
  });

  it("has the standard map", () => {
    expect(ROUTES).toHaveLength(100);
    expect(ROUTES.filter((r) => r.twin)).toHaveLength(44);
    expect(TICKETS).toHaveLength(30);
  });
});

describe("away and leaving", () => {
  it("plays your turn when the clock runs out (two cards from the deck) and marks you away", () => {
    const { state, ctx } = setup(2, { turnSeconds: 30 });
    const before = Object.values(player(state, "a").hand).reduce((x, y) => x + y, 0);
    expect(nextDeadline(state)).toBe(30_000);
    onDeadline(state, ctx(30_000));
    expect(Object.values(player(state, "a").hand).reduce((x, y) => x + y, 0)).toBe(before + 2);
    expect(state.seats[0]!.sittingOut).toBe(true);
    expect(turnOf(state)).toBe("b");
    drawCard(state, "b", "deck", ctx(31_000));
    drawCard(state, "b", "deck", ctx(31_000));
    // Away: played quickly.
    expect(nextDeadline(state)).toBe(31_000 + AUTO_PLAY_DELAY_MS);
    setSittingOut(state, "a", false, ctx(32_000));
    expect(nextDeadline(state)).toBe(61_000);
  });

  it("leaving puts your cards in the discards and your tickets back, and passes the turn", () => {
    const { state, ctx } = setup(3);
    const a = player(state, "a");
    const tickets = [...a.tickets];
    const discards = state.discard.length;
    leave(state, "a", ctx());
    expect(a.left).toBe(true);
    expect(state.discard).toHaveLength(discards + 4);
    expect(state.ticketDeck.slice(0, tickets.length)).toEqual(tickets);
    expect(turnOf(state)).toBe("b");
    leave(state, "c", ctx());
    expect(state.phase).toBe("over");
    expect(state.result!.winners).toEqual(["b"]);
  });
});

describe("views", () => {
  it("shows counts of others' cards and tickets, never the cards", () => {
    const { state } = setup(3);
    const v = viewFor(state, "b");
    expect(v.you.hand).toEqual(player(state, "b").hand);
    expect(v.players[0]).toMatchObject({ playerId: "a", cards: 4, tickets: 2, trains: 45 });
    // Someone else's hand and tickets changing doesn't change your view beyond the counts.
    const before = JSON.stringify(viewFor(state, "b"));
    const a = player(state, "a");
    rigHand(state, "a", { red: 2, blue: 2 });
    const swap = state.ticketDeck.splice(0, 2);
    state.ticketDeck.push(...a.tickets);
    a.tickets = swap;
    expect(JSON.stringify(viewFor(state, "b"))).toBe(before);
  });
});

describe("Easy bots", () => {
  it("play whole games to the end, completing tickets", () => {
    for (let seed = 1; seed <= 6; seed++) {
      const n = 2 + (seed % 4);
      const { state, ctx } = setup(n, { seed, choose: false });
      const rand = seededRandomInt(seed + 100);
      let steps = 0;
      while (state.phase !== "over" && steps++ < 2000) {
        const [id] = ticketToRide.waitingOn(state);
        const op = botMove(ticketToRide, viewFor(state, id!), ticketToRide.legalOps(state, id!), rand) as Parameters<typeof ticketToRide.apply>[2];
        ticketToRide.apply(state, id!, op, ctx());
        ticketToRide.checkInvariants!(state);
      }
      expect(state.phase).toBe("over");
      const done = state.result!.scores.flatMap((s) => s.tickets).filter((t) => t.done).length;
      expect(done).toBeGreaterThanOrEqual(n);
      expect(Math.max(...state.result!.scores.map((s) => s.total))).toBeGreaterThan(40);
    }
  });
});
