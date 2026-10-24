import { describe, expect, it } from "vitest";
import { URGENT_MS } from "../ui/urgency";
import { heartbeatStep } from "./heartbeat";

describe("heartbeat", () => {
  it("waits quietly until the last 10 seconds", () => {
    expect(heartbeatStep(25_000)).toEqual({ beat: false, nextMs: 25_000 - URGENT_MS });
  });
  it("beats once a second, then quicker at the very end, and stops at zero", () => {
    expect(heartbeatStep(9_000)).toEqual({ beat: true, nextMs: 1000 });
    expect(heartbeatStep(3_000)).toEqual({ beat: true, nextMs: 600 });
    expect(heartbeatStep(0)).toBeNull();
    expect(heartbeatStep(-50)).toBeNull();
  });
});
