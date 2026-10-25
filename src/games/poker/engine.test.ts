import { describe, expect, it } from "vitest";
import { GameError } from "../types";
import {
  act,
  createState,
  legalActions,
  leave,
  nextDeadline,
  onDeadline,
  type PokerConfig,
  type PokerState,
  sit,
  start,
  viewFor,
} from "./engine";
import { poker } from "./index";
import { makeCtx, rig, totalChips } from "./testing";

const CONFIG: PokerConfig = { startingStack: 1000, smallBlind: 5, bigBlind: 10, turnSeconds: 30 };

/** Seats players a, b, c... in the given seats and deals the first hand with the button on `button`. */
function table(seats: number[], opts: { button: number; stacks?: number[]; config?: Partial<PokerConfig> }) {
  const { ctx, announcements } = makeCtx();
  const state = createState({ ...CONFIG, ...opts.config });
  seats.forEach((seat, i) => {
    sit(state, String.fromCharCode(97 + i), seat, ctx());
    if (opts.stacks) state.seats[seat]!.stack = opts.stacks[i]!;
  });
  // The button moves before each hand, so park it one seat earlier.
  const sorted = [...seats].sort((a, b) => a - b);
  state.button = sorted[(sorted.indexOf(opts.button) - 1 + sorted.length) % sorted.length]!;
  start(state, "a", ctx());
  return { state, ctx, announcements };
}

const toActId = (s: PokerState) => s.seats[s.hand!.toAct!]!.playerId;

describe("blinds and action order", () => {
  it("heads-up: button posts small blind and acts first preflop, last postflop", () => {
    const { state, ctx } = table([0, 1], { button: 0 });
    const hand = state.hand!;
    expect(hand.sb).toBe(0);
    expect(hand.bb).toBe(1);
    expect(state.seats[0]!.stack).toBe(995);
    expect(state.seats[1]!.stack).toBe(990);
    expect(hand.toAct).toBe(0);

    act(state, "a", { type: "call" }, ctx());
    expect(hand.toAct).toBe(1); // big blind's option
    act(state, "b", { type: "check" }, ctx());
    expect(hand.street).toBe("flop");
    expect(hand.board).toHaveLength(3);
    expect(hand.toAct).toBe(1);
  });

  it("three-handed: UTG acts first and the big blind gets an option", () => {
    const { state, ctx } = table([2, 5, 7], { button: 2 });
    const hand = state.hand!;
    expect([hand.sb, hand.bb]).toEqual([5, 7]);
    expect(hand.toAct).toBe(2);
    act(state, "a", { type: "call" }, ctx());
    act(state, "b", { type: "call" }, ctx());
    expect(hand.toAct).toBe(7);
    expect(legalActions(state, 7)).toMatchObject({ canCheck: true, canRaise: true, minRaiseTo: 20 });
    act(state, "c", { type: "check" }, ctx());
    expect(hand.street).toBe("flop");
    expect(hand.toAct).toBe(5); // first live seat after the button
  });

  it("rejects out-of-turn and illegal actions", () => {
    const { state, ctx } = table([0, 1, 2], { button: 0 });
    expect(() => act(state, "b", { type: "fold" }, ctx())).toThrow(GameError);
    expect(() => act(state, "a", { type: "check" }, ctx())).toThrow(/call 10/);
    expect(() => act(state, "a", { type: "raise", to: 15 }, ctx())).toThrow(/minimum is 20/);
    expect(() => act(state, "a", { type: "raise", to: 5000 }, ctx())).toThrow(GameError);
  });
});

describe("raising", () => {
  it("tracks the minimum raise increment", () => {
    const { state, ctx } = table([0, 1, 2], { button: 0 });
    act(state, "a", { type: "raise", to: 40 }, ctx()); // +30
    expect(legalActions(state, 1)!.minRaiseTo).toBe(70);
    act(state, "b", { type: "raise", to: 100 }, ctx()); // +60
    expect(legalActions(state, 2)!.minRaiseTo).toBe(160);
  });

  it("an incomplete all-in raise does not re-open betting for players who already acted", () => {
    const { state, ctx } = table([0, 1, 2], { button: 0, stacks: [1000, 1000, 125] });
    act(state, "a", { type: "raise", to: 100 }, ctx()); // full raise
    act(state, "b", { type: "call" }, ctx());
    act(state, "c", { type: "raise", to: 125 }, ctx()); // all-in for +25: not a full raise
    expect(state.hand!.toAct).toBe(0);
    expect(legalActions(state, 0)).toMatchObject({ canRaise: false, toCall: 25 });
    act(state, "a", { type: "call" }, ctx());
    expect(legalActions(state, 1)).toMatchObject({ canRaise: false });
  });
});

describe("short all-ins", () => {
  it("re-open betting when together they add up to a full raise", () => {
    // Flop: b bets 100; c and d go all-in for less than a full raise each, but +100 combined.
    const { state, ctx } = table([0, 1, 2, 3], { button: 0, stacks: [1000, 1000, 150, 210] });
    for (const id of ["d", "a", "b"]) act(state, id, { type: "call" }, ctx());
    act(state, "c", { type: "check" }, ctx());
    expect(state.hand!.street).toBe("flop");
    act(state, "b", { type: "raise", to: 100 }, ctx());
    act(state, "c", { type: "raise", to: 140 }, ctx()); // all-in, +40
    act(state, "d", { type: "raise", to: 200 }, ctx()); // all-in, +60
    act(state, "a", { type: "call" }, ctx()); // a live opponent, so raising means something
    expect(state.hand!.toAct).toBe(1);
    expect(legalActions(state, 1)).toMatchObject({ toCall: 100, canRaise: true, minRaiseTo: 300 });
  });
});

describe("short all-in blinds", () => {
  it("a covered short all-in big blind leaves nothing to decide: the excess comes back and the hand runs out", () => {
    // Heads-up 5/10: a (button) posts 5, b has only 3 and is all-in for it.
    const { state, ctx } = table([0, 1], { button: 0, stacks: [1000, 3] });
    const hand = state.hand!;
    expect(hand.toAct).toBeNull();
    expect(hand.status).toBe("runout");
    while (state.hand!.status === "runout") onDeadline(state, ctx(nextDeadline(state)!));
    // The pot was 3 + 3; a's other 2 were never at stake.
    expect(state.seats[0]!.stack + state.seats[1]!.stack).toBe(1003);
    expect(state.hand!.result!.pots.map((p) => p.amount)).toEqual([6]);
  });

  it("an uncovered short all-in big blind is called only for what it put in", () => {
    const { state } = table([0, 1], { button: 0, stacks: [1000, 8] });
    expect(state.hand!.toAct).toBe(0);
    expect(legalActions(state, 0)).toMatchObject({ canCheck: false, toCall: 3, canRaise: false });
  });

  it("multiway, the others still owe the full big blind", () => {
    const { state } = table([0, 1, 2], { button: 0, stacks: [1000, 1000, 3] });
    expect(state.hand!.toAct).toBe(0);
    expect(legalActions(state, 0)).toMatchObject({ toCall: 10, canRaise: true });
  });
});

describe("going heads-up", () => {
  for (const gone of ["a", "b", "c"]) {
    it(`never makes the big blind post it twice in a row (${gone} leaves)`, () => {
      const { state, ctx } = table([0, 2, 5], { button: 0 });
      const lastBb = state.hand!.bb;
      for (let i = 0; i < 2; i++) act(state, toActId(state), { type: "fold" }, ctx());
      expect(state.hand!.status).toBe("complete");
      leave(state, gone, ctx());
      onDeadline(state, ctx(nextDeadline(state)!));
      const hand = state.hand!;
      expect(hand.id).toBe(2);
      if (state.seats[lastBb]) expect(hand.bb).not.toBe(lastBb);
      expect(hand.sb).toBe(hand.button);
    });
  }
});

describe("who may deal", () => {
  it("only players at the table, not people watching", () => {
    const { ctx } = makeCtx();
    const state = createState(CONFIG);
    sit(state, "a", 0, ctx());
    sit(state, "b", 1, ctx());
    expect(() => start(state, "spectator", ctx())).toThrow(/not seated/);
    start(state, "a", ctx());
    expect(state.hand!.id).toBe(1);
  });
});

describe("players who left", () => {
  it("are forgotten after a while, taking their chips off the table", () => {
    const { state, ctx } = table([0, 1], { button: 0 });
    for (let i = 0; i < 50; i++) {
      sit(state, `p${i}`, 5, ctx());
      leave(state, `p${i}`, ctx());
    }
    expect(Object.keys(state.away)).toHaveLength(32);
    poker.checkInvariants!(state);
  });
});

describe("pots", () => {
  it("everyone folds to a raise: uncontested, uncalled bet returned", () => {
    const { state, ctx, announcements } = table([0, 1, 2], { button: 0 });
    act(state, "a", { type: "raise", to: 50 }, ctx());
    act(state, "b", { type: "fold" }, ctx());
    act(state, "c", { type: "fold" }, ctx());
    const hand = state.hand!;
    expect(hand.status).toBe("complete");
    expect(hand.result!.uncontested).toBe(true);
    expect(state.seats.slice(0, 3).map((s) => s!.stack)).toEqual([1015, 995, 990]);
    expect(announcements.at(-1)).toMatch(/a wins 25/);
    // Winner's cards stay hidden.
    expect(viewFor(state, "b").hand!.players.find((p) => p.seat === 0)!.cards).toBeNull();
  });

  it("builds side pots and pays each to the best eligible hand", () => {
    // a is short and has the best hand; c beats b for the side pot.
    const { state, ctx } = table([0, 1, 2], { button: 0, stacks: [100, 1000, 1000] });
    rig(state, { 0: ["As", "Ah"], 1: ["2c", "7d"], 2: ["Ks", "Kh"] }, ["Ad", "9c", "8h", "4s", "3d"]);
    act(state, "a", { type: "raise", to: 100 }, ctx()); // all-in
    act(state, "b", { type: "raise", to: 300 }, ctx());
    act(state, "c", { type: "call" }, ctx());
    // Flop onward: b and c check it down.
    for (let i = 0; i < 3; i++) {
      act(state, toActId(state), { type: "check" }, ctx());
      act(state, toActId(state), { type: "check" }, ctx());
    }
    const result = state.hand!.result!;
    expect(result.pots.map((p) => [p.amount, p.winners])).toEqual([
      [300, [0]],
      [400, [2]],
    ]);
    expect(state.seats[0]!.stack).toBe(300);
    expect(state.seats[1]!.stack).toBe(700);
    expect(state.seats[2]!.stack).toBe(1100);
    expect(result.hands[0]!.name).toBe("Three of a Kind, Aces");
  });

  it("splits a tied pot, odd chip to the first seat left of the button", () => {
    const { state, ctx } = table([0, 1, 2], { button: 0, config: { smallBlind: 5, bigBlind: 10 } });
    rig(state, { 0: ["2c", "3d"], 1: ["Kd", "4c"], 2: ["Kh", "4h"] }, ["As", "Ks", "Qs", "Js", "9d"]);
    act(state, "a", { type: "call" }, ctx());
    act(state, "b", { type: "raise", to: 21 }, ctx()); // odd total
    act(state, "c", { type: "call" }, ctx());
    act(state, "a", { type: "fold" }, ctx());
    for (let i = 0; i < 3; i++) {
      act(state, toActId(state), { type: "check" }, ctx());
      act(state, toActId(state), { type: "check" }, ctx());
    }
    const pot = state.hand!.result!.pots[0]!;
    expect(pot.amount).toBe(52);
    expect(pot.winners).toEqual([1, 2]);
    expect(state.seats[1]!.stack - 979).toBe(26);
    expect(state.seats[2]!.stack - 979).toBe(26);

    // Odd chip variant: re-run with an odd pot.
    const t = table([0, 1, 2], { button: 0 });
    rig(t.state, { 0: ["2c", "3d"], 1: ["Kd", "4c"], 2: ["Kh", "4h"] }, ["As", "Ks", "Qs", "Js", "9d"]);
    act(t.state, "a", { type: "call" }, t.ctx()); // 10
    act(t.state, "b", { type: "call" }, t.ctx()); // sb completes
    act(t.state, "c", { type: "check" }, t.ctx());
    act(t.state, "b", { type: "check" }, t.ctx());
    act(t.state, "c", { type: "raise", to: 15 }, t.ctx());
    act(t.state, "a", { type: "call" }, t.ctx());
    act(t.state, "b", { type: "call" }, t.ctx());
    // a folds later so the pot is odd: 30 + 45 = 75 split between b & c.
    act(t.state, "b", { type: "check" }, t.ctx());
    act(t.state, "c", { type: "check" }, t.ctx());
    act(t.state, "a", { type: "raise", to: 10 }, t.ctx());
    act(t.state, "b", { type: "call" }, t.ctx());
    act(t.state, "c", { type: "call" }, t.ctx());
    for (const id of ["b", "c", "a"]) act(t.state, id, { type: "check" }, t.ctx());
    const res = t.state.hand!.result!;
    expect(res.pots[0]!.winners).toEqual([1, 2]);
    const total = res.pots[0]!.amount;
    expect(total % 2).toBe(1);
    expect(res.payouts[1]).toBe(Math.ceil(total / 2)); // seat 1 is first left of the button
    expect(res.payouts[2]).toBe(Math.floor(total / 2));
  });
});

describe("runout and timers", () => {
  it("all-in preflop reveals hands and deals the board street by street", () => {
    const { state, ctx } = table([0, 1], { button: 0 });
    act(state, "a", { type: "raise", to: 1000 }, ctx(0));
    act(state, "b", { type: "call" }, ctx(0));
    const hand = state.hand!;
    expect(hand.status).toBe("runout");
    expect(viewFor(state, "a").hand!.players.every((p) => p.cards !== null)).toBe(true);

    let now = 0;
    const streets: number[] = [];
    while (state.hand!.status === "runout") {
      now = nextDeadline(state)!;
      onDeadline(state, ctx(now));
      streets.push(state.hand!.board.length);
    }
    expect(streets).toEqual([3, 4, 5]);
    expect(state.hand!.status).toBe("complete");
    expect(state.seats[0]!.stack + state.seats[1]!.stack).toBe(2000);
  });

  it("times out to a fold, sits the player out and deals the next hand", () => {
    const { state, ctx } = table([0, 1, 2], { button: 0 });
    expect(nextDeadline(state)).toBe(30_000);
    onDeadline(state, ctx(30_000));
    expect(state.hand!.players.find((p) => p.seat === 0)!.folded).toBe(true);
    expect(state.seats[0]!.sittingOut).toBe(true);
    act(state, "b", { type: "fold" }, ctx(31_000));
    expect(state.hand!.status).toBe("complete");
    const next = nextDeadline(state)!;
    onDeadline(state, ctx(next));
    expect(state.hand!.id).toBe(2);
    expect(state.hand!.players.map((p) => p.seat)).toEqual([1, 2]); // a sat out
  });

  it("standing up and sitting back down keeps your stack", () => {
    const { state, ctx } = table([0, 1, 2], { button: 0, stacks: [3, 1000, 1000] });
    act(state, "a", { type: "fold" }, ctx());
    leave(state, "a", ctx());
    sit(state, "a", 5, ctx());
    expect(state.seats[5]!.stack).toBe(3);
  });

  it("runs the hand out when someone leaving leaves the player to act nobody to bet against", () => {
    const { state, ctx } = table([0, 1, 2], { button: 0, stacks: [100, 1000, 1000] });
    act(state, "a", { type: "raise", to: 100 }, ctx());
    act(state, "b", { type: "call" }, ctx());
    act(state, "c", { type: "call" }, ctx());
    expect(state.hand!.street).toBe("flop");
    expect(toActId(state)).toBe("b");
    leave(state, "c", ctx());
    expect(state.hand!.status).toBe("runout");
    expect(state.hand!.toAct).toBeNull();
  });

  it("keeps the turn and its clock with the player to act when they still have a decision", () => {
    const { state, ctx } = table([0, 1, 2, 3], { button: 0 });
    act(state, "d", { type: "call" }, ctx());
    const deadline = nextDeadline(state);
    expect(toActId(state)).toBe("a");
    leave(state, "c", ctx(5_000));
    expect(toActId(state)).toBe("a");
    expect(nextDeadline(state)).toBe(deadline);
  });

  it("leaving mid-hand folds and frees the seat", () => {
    const { state, ctx } = table([0, 1], { button: 0 });
    leave(state, "b", ctx());
    expect(state.seats[1]).toBeNull();
    expect(state.hand!.status).toBe("complete");
    expect(state.seats[0]!.stack).toBe(1010);
  });
});

describe("view redaction", () => {
  it("never shows other players' hole cards or the deck", () => {
    const { state } = table([0, 1, 2], { button: 0 });
    const view = viewFor(state, "a");
    const json = JSON.stringify(view);
    expect(json).not.toContain("deck");
    for (const p of state.hand!.players) {
      const seen = view.hand!.players.find((x) => x.seat === p.seat)!.cards;
      if (p.playerId === "a") expect(seen).toEqual(p.cards);
      else {
        expect(seen).toBeNull();
        for (const c of p.cards) expect(json).not.toContain(`"${c}"`);
      }
    }
    // Spectators see no hole cards at all.
    expect(viewFor(state, "zed").hand!.players.every((p) => p.cards === null)).toBe(true);
  });
});

describe("fuzz", () => {
  it("random legal play never creates or destroys chips", () => {
    for (let seed = 1; seed <= 40; seed++) {
      const { ctx } = makeCtx({ seed });
      const rand = makeCtx({ seed: seed * 7919 }).ctx().randomInt;
      const state = createState({ ...CONFIG, startingStack: 200 });
      const players = 2 + (seed % 7);
      for (let i = 0; i < players; i++) sit(state, `p${i}`, i, ctx());
      const total = totalChips(state);
      start(state, "p0", ctx());
      let now = 0;
      for (let step = 0; step < 3000; step++) {
        const hand = state.hand!;
        if (hand.status === "betting" && hand.toAct !== null) {
          const legal = legalActions(state, hand.toAct)!;
          const id = state.seats[hand.toAct]!.playerId;
          const options: Parameters<typeof act>[2][] = [{ type: "fold" }];
          options.push(legal.canCheck ? { type: "check" } : { type: "call" });
          if (legal.canRaise) {
            const span = legal.maxRaiseTo - legal.minRaiseTo;
            options.push({ type: "raise", to: legal.minRaiseTo + rand(span + 1) });
            options.push({ type: "raise", to: legal.maxRaiseTo });
          }
          act(state, id, options[rand(options.length)]!, ctx(now));
        } else {
          const due = nextDeadline(state);
          if (due === null) break; // fewer than two players with chips
          now = Math.max(now, due);
          onDeadline(state, ctx(now));
        }
        expect(totalChips(state)).toBe(total);
        for (const s of state.seats) if (s) expect(s.stack).toBeGreaterThanOrEqual(0);
      }
    }
  });
});
