import { describe, expect, it } from "vitest";
import { bestHand, compareScores, evaluate5 } from "./evaluator";

const score = (hand: string) => evaluate5(hand.split(" "));
const best = (cards: string) => bestHand(cards.split(" "));

describe("evaluate5", () => {
  it("orders categories", () => {
    const ladder = [
      "As Kd 9h 7c 3s", // high card
      "As Ad 9h 7c 3s", // pair
      "As Ad 9h 9c 3s", // two pair
      "As Ad Ah 7c 3s", // trips
      "5s 4d 3h 2c As", // wheel straight
      "6s 5d 4h 3c 2s", // six-high straight beats the wheel
      "As Ks 9s 7s 3s", // flush
      "As Ad Ah 7c 7s", // full house
      "As Ad Ah Ac 3s", // quads
      "5h 4h 3h 2h Ah", // steel wheel
      "As Ks Qs Js Ts", // royal
    ].map(score);
    for (let i = 1; i < ladder.length; i++) expect(compareScores(ladder[i]!, ladder[i - 1]!)).toBeGreaterThan(0);
  });

  it("uses kickers", () => {
    expect(compareScores(score("As Ad Kh 7c 3s"), score("Ah Ac Qh Jc Ts"))).toBeGreaterThan(0);
    expect(compareScores(score("As Ad Kh 7c 3s"), score("Ah Ac Kc 7d 3h"))).toBe(0);
    expect(compareScores(score("Ks Kd 2h 2c As"), score("Qh Qc Jh Jc Ad"))).toBeGreaterThan(0);
  });
});

describe("bestHand", () => {
  it("finds the best five of seven and names it", () => {
    expect(best("As Ks Qs Js 2d 3c Ts").name).toBe("Royal Flush");
    expect(best("Kh Kd 5s 5c 5h 2d 9c").name).toBe("Full House, Fives full of Kings");
    expect(best("Ah 2d 3c 4s 5h Kd Kc").name).toBe("Straight, Five high");
    expect(best("9h 9d 4c 4s Jh Jd 2c").name).toBe("Two Pair, Jacks and Nines");
  });

  it("plays the board when it is best", () => {
    const a = best("2c 3d As Ks Qs Js Ts");
    const b = best("7h 8h As Ks Qs Js Ts");
    expect(compareScores(a.score, b.score)).toBe(0);
  });
});
