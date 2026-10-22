import { describe, expect, it } from "vitest";
import { TokenBucket } from "./token-bucket";

describe("TokenBucket", () => {
  it("allows a burst, then refills at the given rate", () => {
    const b = new TokenBucket(3, 2, 0);
    expect([b.take(0), b.take(0), b.take(0), b.take(0)]).toEqual([true, true, true, false]);
    expect(b.take(400)).toBe(false); // 0.8 tokens
    expect(b.take(500)).toBe(true); // 1.0
    expect(b.take(500)).toBe(false);
  });

  it("never exceeds capacity after a long idle", () => {
    const b = new TokenBucket(2, 1, 0);
    b.take(0);
    expect([b.take(60_000), b.take(60_000), b.take(60_000)]).toEqual([true, true, false]);
  });
});
