import { describe, expect, it } from "vitest";
import type { Card } from "../kit/cards";
import { seededRandomInt } from "../kit/testing";
import type { GameContext } from "../types";
import {
  AUTO_PLAY_DELAY_MS,
  ask,
  askOptions,
  createState,
  currentPlayer,
  type FishState,
  leave,
  nextDeadline,
  onDeadline,
  LOG_KEEP,
  setSittingOut,
  sit,
  start,
  viewFor,
} from "./engine";
import { finnsISjon } from "./index";

function setup(n: number, opts: { seed?: number; turnSeconds?: number } = {}) {
  const announcements: string[] = [];
  const rand = seededRandomInt(opts.seed ?? 1);
  const ctx = (now = 0): GameContext => ({ now, randomInt: rand, nameOf: (id) => id, announce: (t) => announcements.push(t) });
  const state = createState({ turnSeconds: opts.turnSeconds ?? 30 });
  const ids = ["a", "b", "c", "d", "e", "f"].slice(0, n);
  ids.forEach((id, i) => sit(state, id, i));
  start(state, "a", ctx());
  return { state, ctx, announcements, ids };
}

/** Give players exact hands and the lake exact contents (drawn from the end), and set whose turn it is. */
function rig(state: FishState, hands: Record<string, Card[]>, lake: Card[], turn: string) {
  for (const p of state.players) p.hand = hands[p.playerId] ?? [];
  for (const p of state.players) p.books = [];
  state.lake = [...lake];
  state.turn = state.players.find((p) => p.playerId === turn)!.seat;
}

const hand = (state: FishState, id: string) => state.players.find((p) => p.playerId === id)!.hand;
const turnOf = (state: FishState) => currentPlayer(state)?.playerId;

describe("dealing", () => {
  it("deals 7 cards to 2–3 players and 5 to more, the rest is the lake", () => {
    const three = setup(3).state;
    expect(three.players.map((p) => p.hand.length + p.books.length * 4)).toEqual([7, 7, 7]);
    expect(three.lake).toHaveLength(52 - 21);
    const five = setup(5).state;
    expect(five.players.map((p) => p.hand.length + p.books.length * 4)).toEqual([5, 5, 5, 5, 5]);
  });

  it("needs two players who aren't away", () => {
    const state = createState({ turnSeconds: 30 });
    sit(state, "a", 0);
    expect(() => start(state, "a", setup(2).ctx())).toThrow(/two players/);
  });
});

describe("asking", () => {
  it("hands over every card of the rank, and you go again", () => {
    const { state, ctx } = setup(3);
    rig(state, { a: ["7h", "2c"], b: ["7s", "7d", "9c"], c: ["Kc"] }, ["3c", "4c"], "a");
    ask(state, "a", "b", "7", ctx());
    expect(hand(state, "a").sort()).toEqual(["2c", "7d", "7h", "7s"]);
    expect(hand(state, "b")).toEqual(["9c"]);
    expect(turnOf(state)).toBe("a");
    expect(state.log.at(-1)).toEqual({ type: "ask", from: "a", to: "b", rank: "7", got: 2, cards: ["7s", "7d"] });
  });

  it("Finns i sjön: draws, and play passes unless you catch what you asked for", () => {
    const { state, ctx } = setup(3);
    rig(state, { a: ["7h"], b: ["9c"], c: ["Kc"] }, ["4c", "7c", "2d"], "a");
    ask(state, "a", "b", "7", ctx()); // draws 2d: unlucky
    expect(state.log.slice(-2)).toEqual([
      { type: "ask", from: "a", to: "b", rank: "7", got: 0, cards: [] },
      { type: "fish", who: "a", rank: "7", lucky: false, card: null },
    ]);
    expect(turnOf(state)).toBe("b");

    rig(state, { a: ["7h"], b: ["9c"], c: ["Kc"] }, ["4c", "7c"], "a");
    ask(state, "a", "c", "7", ctx()); // draws 7c: lucky, shown, goes again
    expect(state.log.at(-1)).toEqual({ type: "fish", who: "a", rank: "7", lucky: true, card: "7c" });
    expect(turnOf(state)).toBe("a");
  });

  it("refuses asking out of turn, for ranks you don't hold, or people without cards", () => {
    const { state, ctx } = setup(3);
    rig(state, { a: ["7h"], b: ["9c"], c: [] }, ["4c"], "a");
    expect(() => ask(state, "b", "a", "9", ctx())).toThrow(/not your turn/);
    expect(() => ask(state, "a", "b", "9", ctx())).toThrow(/rank you hold/);
    expect(() => ask(state, "a", "c", "7", ctx())).toThrow(/no cards/);
    expect(() => ask(state, "a", "a", "7", ctx())).toThrow(/another player/);
    expect(askOptions(state, "a")).toEqual({ targets: ["b"], ranks: ["7"] });
  });

  it("lays down fours at once and announces them", () => {
    const { state, ctx, announcements } = setup(2);
    rig(state, { a: ["Kh", "Kd", "Kc", "2c"], b: ["Ks", "3c"] }, ["4c"], "a");
    ask(state, "a", "b", "K", ctx());
    expect(state.players[0]!.books).toEqual(["K"]);
    expect(hand(state, "a")).toEqual(["2c"]);
    expect(announcements.at(-1)).toBe("a lays down four Kings.");
  });

  it("draws into an empty hand at the start of a turn", () => {
    const { state, ctx } = setup(2);
    // a completes a book with their last cards and goes again with an empty hand.
    rig(state, { a: ["Kh", "Kd", "Kc"], b: ["Ks", "3c"] }, ["5d", "4c"], "a");
    ask(state, "a", "b", "K", ctx());
    expect(hand(state, "a")).toEqual(["4c"]);
    expect(state.log.at(-1)).toEqual({ type: "draw", who: "a" });
    expect(turnOf(state)).toBe("a");
  });
});

describe("away players and leaving", () => {
  it("plays your turn when time runs out, marks you away, and plays quickly until you're back", () => {
    const { state, ctx } = setup(2, { turnSeconds: 10 });
    rig(state, { a: ["7h", "7d", "2c"], b: ["9c"] }, ["4c", "5c", "6c", "8c"], "a");
    state.timers.turn = 10_000;
    onDeadline(state, ctx(10_000));
    expect(state.seats[0]!.sittingOut).toBe(true);
    expect(state.log.find((e) => e.type === "ask")).toMatchObject({ from: "a", to: "b", rank: "7" });
    // b plays, then a's turn comes round again: it's played after a short delay.
    ask(state, "b", "a", "9", ctx(11_000));
    expect(turnOf(state)).toBe("a");
    expect(nextDeadline(state)).toBe(11_000 + AUTO_PLAY_DELAY_MS);
    // Back: what's left of the turn, which began at 11s.
    setSittingOut(state, "a", false, ctx(12_000));
    expect(nextDeadline(state)).toBe(11_000 + 10_000);
  });

  it("never extends a turn by going away and coming back", () => {
    const { state, ctx } = setup(2, { turnSeconds: 45 });
    const a = turnOf(state)!;
    const ends = nextDeadline(state)!;
    expect(() => setSittingOut(state, a, false, ctx(44_000))).toThrow(/already/);
    for (let t = 1_000; t < 40_000; t += 2_000) {
      setSittingOut(state, a, true, ctx(t));
      expect(nextDeadline(state)).toBe(t + AUTO_PLAY_DELAY_MS);
      setSittingOut(state, a, false, ctx(t + 1_000));
      expect(nextDeadline(state)).toBe(ends);
    }
  });

  it("only lets players at the table deal", () => {
    const state = createState({ turnSeconds: 30 });
    sit(state, "a", 0);
    sit(state, "b", 1);
    expect(() => start(state, "spectator", setup(2).ctx())).toThrow(/not seated/);
    start(state, "a", setup(2).ctx());
    expect(state.phase).toBe("playing");
  });

  it("keeps a bounded history however long play goes round in circles", () => {
    const { state, ctx } = setup(3);
    // Ten ranks are booked already; nobody holds what's asked for, and the lake is empty.
    rig(state, { a: ["Ah", "Ad", "Kh", "Kd"], b: ["As", "Ac", "Qh", "Qd"], c: ["Ks", "Kc", "Qs", "Qc"] }, [], "a");
    state.players[0]!.books = ["2", "3", "4", "5", "6", "7", "8", "9", "T", "J"];
    for (let i = 0; i < 700; i++) {
      ask(state, "a", "c", "A", ctx());
      ask(state, "b", "a", "Q", ctx());
      ask(state, "c", "b", "K", ctx());
    }
    expect(turnOf(state)).toBe("a");
    expect(state.log).toHaveLength(LOG_KEEP);
  });

  it("returns a leaver's hand to the lake, and ends a two-player game", () => {
    const { state, ctx } = setup(3);
    rig(state, { a: ["7h"], b: ["9c", "9d"], c: ["Kc"] }, ["4c"], "a");
    leave(state, "b", ctx());
    expect(state.lake).toHaveLength(3);
    expect(state.players.find((p) => p.playerId === "b")!.left).toBe(true);
    expect(state.phase).toBe("playing");
    leave(state, "c", ctx());
    expect(state.phase).toBe("over");
    expect(state.result!.winners).toEqual(["a"]);
  });

  it("moves play on when someone leaves who was the only one left to ask", () => {
    const { state, ctx } = setup(3, { turnSeconds: 10 });
    // a is to play; only b has cards, and c's hand is empty.
    rig(state, { a: ["7h", "8h"], b: ["9c"], c: [] }, ["2c", "3c", "4c", "5c"], "a");
    leave(state, "b", ctx());
    // a has nobody to ask: draws and passes, and c draws into an empty hand and asks a.
    expect(turnOf(state)).toBe("c");
    expect(askOptions(state, "c")?.targets).toEqual(["a"]);
    // The clock still plays the turn rather than failing.
    onDeadline(state, ctx(nextDeadline(state)!));
    expect(state.phase).toBe("playing");
  });
});

describe("secrets", () => {
  it("shows everyone which cards changed hands, as at a real table", () => {
    const { state, ctx } = setup(3);
    rig(state, { a: ["7h"], b: ["7s", "7d", "9c"], c: ["Kc"] }, ["4c"], "a");
    ask(state, "a", "b", "7", ctx());
    for (const viewer of ["a", "b", "c", "spectator"]) {
      expect(viewFor(state, viewer).log.find((e) => e.type === "ask")).toMatchObject({ got: 2, cards: ["7s", "7d"] });
    }
    // The rest of b's hand stays private.
    expect(JSON.stringify(viewFor(state, "c"))).not.toContain('"9c"');
  });

  it("shows you only your own hand and draws", () => {
    const { state, ctx } = setup(3);
    rig(state, { a: ["7h"], b: ["9c", "9d"], c: ["Kc"] }, ["4c", "2d"], "a");
    ask(state, "a", "b", "7", ctx());
    const json = JSON.stringify(viewFor(state, "b"));
    for (const c of ["7h", "2d", "Kc", "4c"]) expect(json).not.toContain(`"${c}"`);
    expect(viewFor(state, "a").players[0]!.lastDrawn).toBe("2d");
    expect(viewFor(state, "b").players[0]!.lastDrawn).toBeNull();
    expect(json).not.toContain("lake\"");
  });
});

describe("full games", () => {
  it("always finish with all 13 books down and a winner", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const n = 2 + (seed % 5);
      const { state, ctx } = setup(n, { seed });
      const rand = seededRandomInt(seed * 13);
      let now = 0;
      for (let step = 0; step < 2000 && state.phase === "playing"; step++) {
        const ops = finnsISjon.legalOps(state, turnOf(state)!).filter((o) => o.type === "ask");
        if (rand(10) === 0) {
          now = nextDeadline(state)!; // sometimes let the clock play for them
          onDeadline(state, ctx(now));
        } else finnsISjon.apply(state, turnOf(state)!, ops[rand(ops.length)]!, ctx(now));
        finnsISjon.checkInvariants!(state);
      }
      expect(state.phase).toBe("over");
      expect(state.players.reduce((n, p) => n + p.books.length, 0)).toBe(13);
      expect(state.result!.winners.length).toBeGreaterThan(0);
    }
  });
});
