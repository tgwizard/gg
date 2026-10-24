import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { games } from "../../../games/registry";
import { LLMError, type LLMRequest, type LLMResult } from "../../llm/types";
import type { RoomSnapshot } from "../../net/RoomClient";
import { AiBrain, type BrainHost, type GameAt } from "./AiBrain";

// The model: each test decides how it answers.
let generate: (req: LLMRequest) => Promise<LLMResult>;
vi.mock("../../llm/connections", () => ({
  getConnection: () => ({ id: "c1", provider: "meta", label: "Fake", model: "fake-model" }),
  clientFor: async () => ({ listModels: async () => [], generate: (req: LLMRequest) => generate(req) }),
}));

let calls = 0;
function act(input: Record<string, unknown>): LLMResult {
  const id = `call${++calls}`;
  return { text: "", toolCalls: [{ id, name: "act", input }], message: { role: "assistant", content: [{ type: "tool_call", id, name: "act", input }] } };
}

/** An answer only when the call is cancelled (the model "never answers"). */
function never(req: LLMRequest): Promise<LLMResult> {
  return new Promise((_, reject) => req.signal?.addEventListener("abort", () => reject(new LLMError("cancelled", "Cancelled."))));
}

function snapshot(instanceId: string, version: number, deadline: number | null = null): RoomSnapshot {
  return {
    status: "connected",
    attempt: 0,
    nextRetryAt: null,
    joined: true,
    you: { id: "bot", name: "Robo", kind: "bot", ownerId: "me", color: 0, online: true, joinedAt: 0, lastSeenAt: 0 },
    members: [],
    roomName: null,
    chat: [],
    pendingChat: [],
    game: {
      instanceId,
      gameId: "tictactoe",
      version,
      startedAt: 0,
      startedBy: "me",
      view: { board: Array(9).fill(null), you: { seat: 1 } },
      players: ["me", "bot"],
      waitingOn: ["bot"],
      legalOps: [{ type: "leave" }, { type: "place", cell: 4 }],
      deadline,
    },
    clockOffset: 0,
    notice: null,
  };
}

function setup(first: RoomSnapshot) {
  let snap = first;
  const sent: { op: unknown; at: GameAt }[] = [];
  const standIns: string[] = [];
  const host: BrainHost = {
    snapshot: () => snap,
    sendOp: async (op, at) => void sent.push({ op, at }),
    say: () => {},
    easyMove: () => ({ type: "place", cell: 4 }),
    usage: () => {},
    error: () => {},
    activity: () => {},
    standIn: (why) => void standIns.push(why),
    log: () => {},
  };
  const brain = new AiBrain({ name: "Robo", connectionId: "c1" }, games, host);
  return {
    brain,
    sent,
    standIns,
    set(next: RoomSnapshot) {
      snap = next;
      brain.observe();
    },
  };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("AiBrain", () => {
  it("waits a moment after the game changed before moving, however quick the model", async () => {
    generate = () => Promise.resolve(act({ op: { type: "place", cell: 4 } }));
    const t = setup(snapshot("A", 3));
    t.brain.observe();
    await vi.advanceTimersByTimeAsync(900);
    expect(t.sent).toEqual([]);
    await vi.advanceTimersByTimeAsync(200);
    expect(t.sent.map((s) => s.op)).toEqual([{ type: "place", cell: 4 }]);
  });

  it("never plays an answer into a game that started after the question", async () => {
    let answerA!: (r: LLMResult) => void;
    let calledB = false;
    generate = (req) => {
      if (!calledB && req.messages.length === 1 && !answerA) return new Promise((resolve) => (answerA = resolve));
      calledB = true;
      return Promise.resolve(act({}));
    };
    const t = setup(snapshot("A", 3));
    t.brain.observe();
    await vi.advanceTimersByTimeAsync(0);
    expect(answerA).toBeDefined();
    // A new game, at the same version number, while the model is still thinking about A.
    t.set(snapshot("B", 3));
    answerA(act({ op: { type: "place", cell: 4 } }));
    await vi.advanceTimersByTimeAsync(5_000);
    expect(t.sent.filter((s) => s.at.instanceId === "A")).toEqual([]);
    t.brain.stop();
  });

  it("treats chatting instead of moving as passing: one nudge, then the built-in bot moves", async () => {
    const requests: LLMRequest[] = [];
    generate = async (req) => {
      requests.push(req);
      return act({ say: "Thinking!" });
    };
    const t = setup(snapshot("A", 3));
    t.brain.observe();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(requests).toHaveLength(2);
    expect(t.standIns).toEqual(["the model passed on its own move"]);
    expect(t.sent).toEqual([{ op: { type: "place", cell: 4 }, at: { instanceId: "A", version: 3 } }]);
    t.brain.stop();
  });

  it("gives up on a model that doesn't answer before its clock runs out", async () => {
    generate = never;
    const t = setup(snapshot("A", 3, Date.now() + 10_000));
    t.brain.observe();
    await vi.advanceTimersByTimeAsync(6_000);
    expect(t.standIns).toEqual([]);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(t.standIns).toEqual(["the model took too long"]);
    expect(t.sent).toEqual([{ op: { type: "place", cell: 4 }, at: { instanceId: "A", version: 3 } }]);
    t.brain.stop();
  });

  it("doesn't stand in once the game has moved on", async () => {
    generate = never;
    const t = setup(snapshot("A", 3, Date.now() + 10_000));
    t.brain.observe();
    await vi.advanceTimersByTimeAsync(7_100);
    expect(t.standIns).toHaveLength(1);
    t.set({ ...snapshot("A", 4), game: { ...snapshot("A", 4).game!, waitingOn: [], legalOps: [{ type: "leave" }] } });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(t.sent).toEqual([]);
    t.brain.stop();
  });
});
