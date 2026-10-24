import { describe, expect, it } from "vitest";
import { newDeck } from "../kit/cards";
import { seededRandomInt } from "../kit/testing";
import type { GameContext } from "../types";
import { AUTO_PLAY_DELAY_MS, type FemConfig, type FemState, NEXT_DEAL_MS } from "./engine";
import { femKort as game } from "./index";
import { type Play, playable, winningPlay } from "./rules";

const plays = (...cards: string[]): Play[] => cards.map((card, seat) => ({ seat, playerId: `p${seat}`, card }));

describe("fem kort rules", () => {
  it("makes you follow suit, and beat the best card of it if you can (överstick)", () => {
    const hand = ["2h", "Th", "Kh", "As", "3c"];
    expect(playable(hand, [], true)).toEqual(hand);
    expect(playable(hand, plays("9h"), true)).toEqual(["Th", "Kh"]);
    expect(playable(hand, plays("9h", "Qh"), true)).toEqual(["Kh"]);
    expect(playable(hand, plays("9h", "Ah"), true)).toEqual(["2h", "Th", "Kh"]);
    // A higher card of another suit doesn't count: only the suit led.
    expect(playable(hand, plays("9h", "Ac"), true)).toEqual(["Th", "Kh"]);
    // The older rule: just follow suit.
    expect(playable(hand, plays("9h"), false)).toEqual(["2h", "Th", "Kh"]);
    // None of the suit led: anything goes.
    expect(playable(hand, plays("5d"), true)).toEqual(hand);
  });

  it("gives the trick to the highest card of the suit led, with no trumps", () => {
    expect(winningPlay(plays("9h", "As", "Th", "2h"))!.card).toBe("Th");
    expect(winningPlay(plays("3c", "Ah", "Kd"))!.card).toBe("3c");
  });
});

function setup(n = 3, config: Partial<FemConfig> = {}) {
  const announcements: string[] = [];
  let now = 1_000_000;
  const ctx = (): GameContext => ({ now, randomInt: seededRandomInt(7), nameOf: (id) => id, announce: (t) => announcements.push(t) });
  const ids = ["alice", "bob", "carol", "dave", "erin", "frank"].slice(0, n);
  const state = game.create(game.configSchema.parse(config), ctx());
  ids.forEach((id, seat) => game.apply(state, id, { type: "sit", seat }, ctx()));
  game.apply(state, "alice", { type: "start" }, ctx());
  return { state, ctx, ids, announcements, at: (t: number) => (now = t) };
}

/** Deal chosen hands (by seat), with seat `lead` leading. */
function deal(state: FemState, hands: string[][], lead = 0) {
  state.players.forEach((p, i) => (p.hand = [...hands[i]!]));
  state.stock = newDeck().filter((c) => !hands.flat().includes(c));
  state.trick = [];
  state.tricks = [];
  state.turn = lead;
}

/** Whoever's turn it is plays these, in order. */
function play(state: FemState, ctx: () => GameContext, ...cards: string[]) {
  for (const card of cards) game.apply(state, game.waitingOn(state)[0]!, { type: "play", card }, ctx());
}

describe("fem kort", () => {
  it("deals five cards each, three then two from the dealer's left, who leads", () => {
    const { state } = setup(4);
    expect(state.phase).toBe("playing");
    expect(state.players.map((p) => p.hand.length)).toEqual([5, 5, 5, 5]);
    expect(state.stock).toHaveLength(32);
    const forehand = (state.dealer! + 1) % 4;
    expect(state.turn).toBe(forehand);
    expect(game.waitingOn(state)).toEqual([state.players[forehand]!.playerId]);
    game.checkInvariants!(state);
  });

  it("plays tricks clockwise, the winner leading the next, and the last trick wins the deal", () => {
    const { state, ctx, announcements, at } = setup(3);
    deal(state, [
      ["2c", "Ah", "Kh", "As", "Ks"],
      ["3c", "4h", "5h", "6h", "7d"],
      ["4c", "8d", "9d", "Td", "Jd"],
    ]);
    expect(() => game.apply(state, "bob", { type: "play", card: "3c" }, ctx())).toThrow(/not your turn/);
    expect(() => game.apply(state, "alice", { type: "play", card: "3c" }, ctx())).toThrow(/don't have/);
    play(state, ctx, "2c");
    // Bob must follow clubs; Carol must beat the 3c with her 4c.
    expect(() => game.apply(state, "bob", { type: "play", card: "4h" }, ctx())).toThrow(/follow suit/);
    play(state, ctx, "3c", "4c");
    expect(state.tricks[0]).toMatchObject({ winner: 2 });
    expect(state.turn).toBe(2);
    expect(state.log.at(-1)).toEqual({ type: "trick", deal: 1, n: 1, winner: "carol", card: "4c" });
    // Carol leads diamonds: Alice has none, so she may play anything; Bob must follow.
    play(state, ctx, "8d", "As", "7d");
    play(state, ctx, "9d", "Ah", "4h");
    play(state, ctx, "Td", "Kh", "5h");
    expect(state.turn).toBe(2);
    expect(state.tricks.map((t) => t.winner)).toEqual([2, 2, 2, 2]);
    // The last trick: Carol leads the Jd and takes the deal with it.
    at(2_000_000);
    play(state, ctx, "Jd", "Ks", "6h");
    expect(state.dealOver).toBe(true);
    expect(state.players[2]).toMatchObject({ deals: 1, wonWith: ["Jd"] });
    expect(announcements.at(-1)).toBe("Deal 1: carol takes the last trick with the J♦.");
    expect(game.waitingOn(state)).toEqual([]);
    expect(game.nextDeadline!(state)).toBe(2_000_000 + NEXT_DEAL_MS);
    game.checkInvariants!(state);

    // After the pause the deal passes clockwise.
    const dealer = state.dealer!;
    at(2_000_000 + NEXT_DEAL_MS);
    game.onDeadline!(state, ctx());
    expect(state.deal).toBe(2);
    expect(state.dealer).toBe((dealer + 1) % 3);
    expect(state.turn).toBe((dealer + 2) % 3);
    expect(state.players.map((p) => p.hand.length)).toEqual([5, 5, 5]);
    game.checkInvariants!(state);
  });

  it("follows suit without beating under the older rule", () => {
    const { state, ctx } = setup(2, { mustBeat: false });
    deal(state, [
      ["9h", "2c", "3c", "4c", "5c"],
      ["Th", "2h", "3d", "4d", "5d"],
    ]);
    play(state, ctx, "9h");
    expect(game.legalOps(state, "bob").filter((op) => op.type === "play")).toEqual([
      { type: "play", card: "2h" },
      { type: "play", card: "Th" },
    ]);
    play(state, ctx, "2h");
    expect(state.tricks[0]!.winner).toBe(0);
  });

  it("ends the game at the deals to win, or two in a row when that's on", () => {
    const { state, ctx, announcements } = setup(2, { dealsToWin: 2 });
    for (let d = 0; d < 2; d++) {
      deal(state, [["Ah", "Ac", "Ad", "As", "Kh"], ["2h", "2c", "2d", "2s", "3h"]]);
      play(state, ctx, "Ah", "2h", "Ac", "2c", "Ad", "2d", "As", "2s", "Kh", "3h");
      if (d === 0) game.onDeadline!(state, { ...ctx(), now: game.nextDeadline!(state)! });
    }
    expect(state.phase).toBe("over");
    expect(state.result).toEqual({ winners: ["alice"], deals: { alice: 2, bob: 0 }, reason: "deals" });
    expect(state.seats[0]!.gamesWon).toBe(1);
    expect(announcements.at(-1)).toBe("Fem kort game 1: alice wins with 2 deals!");
    expect(game.legalOps(state, "bob")).toContainEqual({ type: "start" });
    game.apply(state, "bob", { type: "start" }, ctx());
    expect(state.game).toBe(2);
    expect(state.players.map((p) => p.deals)).toEqual([0, 0]);

    const streak = setup(2, { dealsToWin: 5, twoInARow: true });
    for (let d = 0; d < 2; d++) {
      deal(streak.state, [["Ah", "Ac", "Ad", "As", "Kh"], ["2h", "2c", "2d", "2s", "3h"]]);
      play(streak.state, streak.ctx, "Ah", "2h", "Ac", "2c", "Ad", "2d", "As", "2s", "Kh", "3h");
      if (d === 0) game.onDeadline!(streak.state, { ...streak.ctx(), now: game.nextDeadline!(streak.state)! });
    }
    expect(streak.state.result).toMatchObject({ winners: ["alice"], reason: "streak" });
  });

  it("keeps hands secret: views show only your own cards, and counts for the rest", () => {
    const { state, ctx } = setup(3);
    const alice = game.view(state, "alice");
    const spectator = game.view(state, "someone");
    expect(alice.players[0]!.hand).toHaveLength(5);
    expect(alice.players[1]!.hand).toBeNull();
    expect(alice.players[1]!.cardCount).toBe(5);
    expect(spectator.players.every((p) => p.hand === null)).toBe(true);
    const json = JSON.stringify(spectator);
    for (const c of [...state.stock, ...state.players.flatMap((p) => p.hand)]) expect(json).not.toContain(`"${c}"`);
    const bobJson = JSON.stringify(game.view(state, "bob"));
    for (const c of state.players[0]!.hand) expect(bobJson).not.toContain(`"${c}"`);
    // Played cards are public.
    const lead = game.waitingOn(state)[0]!;
    const card = game.legalOps(state, lead).find((op) => op.type === "play")!;
    game.apply(state, lead, card, ctx());
    expect(game.view(state, "someone").trick[0]!.card).toBe((card as { card: string }).card);
    expect(game.view(state, "someone").led).toBe((card as { card: string }).card[1]);
  });

  it("plays for you when your time runs out, and marks you away", () => {
    const { state, ctx, at } = setup(2, { turnSeconds: 20 });
    const lead = state.players.find((p) => p.seat === state.turn)!;
    expect(game.nextDeadline!(state)).toBe(1_000_000 + 20_000);
    at(1_020_000);
    game.onDeadline!(state, ctx());
    expect(lead.hand).toHaveLength(4);
    expect(state.seats[lead.seat]!.sittingOut).toBe(true);
    // Away: your next turn is played quickly.
    game.apply(state, game.waitingOn(state)[0]!, game.legalOps(state, game.waitingOn(state)[0]!).find((op) => op.type === "play")!, ctx());
    if (state.turn === lead.seat) expect(game.nextDeadline!(state)).toBe(1_020_000 + AUTO_PLAY_DELAY_MS);
    game.apply(state, lead.playerId, { type: "sitIn" }, ctx());
    expect(state.seats[lead.seat]!.sittingOut).toBe(false);
  });

  it("deals again without someone who leaves mid-deal, and ends the game when one is left", () => {
    const { state, ctx, announcements } = setup(3);
    const lead = game.waitingOn(state)[0]!;
    game.apply(state, lead, game.legalOps(state, lead).find((op) => op.type === "play")!, ctx());
    game.apply(state, "bob", { type: "leave" }, ctx());
    expect(state.deal).toBe(2);
    expect(state.players.filter((p) => !p.left).map((p) => p.hand.length)).toEqual([5, 5]);
    expect(announcements.at(-1)).toBe("bob left, so the cards are dealt again.");
    game.checkInvariants!(state);
    // Bob comes back: dealt in from the next deal, deals kept.
    game.apply(state, "bob", { type: "sit", seat: 4 }, ctx());
    expect(game.waitingOn(state)).not.toContain("bob");
    game.apply(state, "carol", { type: "leave" }, ctx());
    expect(state.players.filter((p) => !p.left).map((p) => p.playerId).sort()).toEqual(["alice", "bob"]);
    game.apply(state, "alice", { type: "leave" }, ctx());
    expect(state.phase).toBe("over");
    expect(state.result).toMatchObject({ winners: ["bob"], reason: "left" });
  });

  it("deals again for better cards when everyone agrees, and plays on when anyone says no", () => {
    const { state, ctx } = setup(3, { betterCards: true });
    const lead = game.waitingOn(state)[0]!;
    const others = ["alice", "bob", "carol"].filter((id) => id !== lead);
    expect(game.legalOps(state, lead)).toContainEqual({ type: "betterCards" });
    game.apply(state, lead, { type: "betterCards" }, ctx());
    expect(game.waitingOn(state).sort()).toEqual([...others].sort());
    expect(game.legalOps(state, lead)).not.toContainEqual({ type: "betterCards" });
    expect(() => game.apply(state, lead, { type: "play", card: state.players.find((p) => p.playerId === lead)!.hand[0]! }, ctx())).toThrow(/better cards/);
    expect(game.concurrentOp!({ type: "vote", yes: true })).toBe(true);
    game.apply(state, others[0]!, { type: "vote", yes: true }, ctx());
    game.apply(state, others[1]!, { type: "vote", yes: false }, ctx());
    expect(state.vote).toBeNull();
    expect(state.log.at(-1)).toEqual({ type: "vote", deal: 1, passed: false, against: [others[1]] });
    expect(game.waitingOn(state)).toEqual([lead]);
    // Once a deal each.
    expect(game.legalOps(state, lead)).not.toContainEqual({ type: "betterCards" });

    const again = setup(2, { betterCards: true });
    const asker = game.waitingOn(again.state)[0]!;
    const dealer = again.state.dealer;
    game.apply(again.state, asker, { type: "betterCards" }, again.ctx());
    game.apply(again.state, game.waitingOn(again.state)[0]!, { type: "vote", yes: true }, again.ctx());
    expect(again.state.deal).toBe(2);
    expect(again.state.dealer).not.toBe(dealer);
    game.checkInvariants!(again.state);
  });

  it("lets built-in bots play whole games", () => {
    const winners = new Set<string>();
    for (let seed = 1; seed <= 10; seed++) {
      const rand = seededRandomInt(seed);
      const { state, ctx, ids } = setup(2 + (seed % 5), { betterCards: seed % 2 === 0 });
      for (let i = 0; i < 2000 && state.phase === "playing"; i++) {
        const who = game.waitingOn(state)[0];
        if (!who) {
          game.onDeadline!(state, { ...ctx(), now: game.nextDeadline!(state)! });
          continue;
        }
        const ops = game.legalOps(state, who).filter((op) => !["sit", "leave", "sitOut", "sitIn", "start"].includes(op.type));
        game.apply(state, who, game.bot.easy(game.view(state, who), ops, rand)!, ctx());
        game.checkInvariants!(state);
      }
      expect(state.phase).toBe("over");
      expect(ids).toContain(state.result!.winners[0]);
      winners.add(state.result!.winners[0]!);
    }
    expect(winners.size).toBeGreaterThan(1);
  });

  it("bot: dumps low cards early, follows cheaply, and keeps its best card for the end", () => {
    const { state } = setup(2);
    const bot = (hand: string[], other: string[], lead: number) => {
      deal(state, [hand, other], lead);
      const me = state.players[lead === 0 ? 0 : 1]!.playerId;
      return game.bot.easy(game.view(state, me), game.legalOps(state, me).filter((op) => op.type === "play"), seededRandomInt(1));
    };
    // Leading the first trick: not the ace.
    expect(bot(["As", "2h", "7c", "9d", "Jh"], ["3s", "4s", "5s", "6s", "8s"], 0)).toEqual({ type: "play", card: "2h" });

    // Following, it beats as cheaply as it may and keeps the ace.
    deal(state, [["5h", "2c", "3c", "4c", "5c"], ["Ah", "7h", "9h", "2s", "2d"]], 0);
    game.apply(state, "alice", { type: "play", card: "5h" }, { now: 0, randomInt: seededRandomInt(1), nameOf: (id) => id, announce: () => {} });
    expect(game.bot.easy(game.view(state, "bob"), game.legalOps(state, "bob").filter((op) => op.type === "play"), seededRandomInt(1))).toEqual({ type: "play", card: "7h" });

    // The fourth trick, on lead with the K♠ (the A♠ gone) and a low heart: keep the king when hearts are out against it.
    deal(state, [["Ks", "4h"], ["8h", "2d"]], 0);
    state.tricks = [0, 1, 2].map((i) => ({ plays: [{ seat: 0, playerId: "alice", card: ["As", "2c", "3c"][i]! }, { seat: 1, playerId: "bob", card: ["5c", "6c", "7c"][i]! }], winner: 0 }));
    state.stock = newDeck().filter((c) => !["Ks", "4h", "8h", "2d", "As", "2c", "3c", "5c", "6c", "7c"].includes(c));
    const fourth = game.bot.easy(game.view(state, "alice"), game.legalOps(state, "alice").filter((op) => op.type === "play"), seededRandomInt(1));
    expect(fourth).toEqual({ type: "play", card: "4h" });
  });
});
