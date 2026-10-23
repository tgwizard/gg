import { describe, expect, it } from "vitest";
import { games } from "../../../games/registry";
import type { ChatMessage } from "../../../shared/protocol";
import { actTool, describeMoves, gameMoves, instructions, parseAct, updateText } from "./prompt";

const fish = games.finnsisjon!;
const ttt = games.tictactoe!;

describe("actTool", () => {
  it("offers every game's own moves, but not table moves", () => {
    for (const def of Object.values(games)) {
      const op = (actTool(def).parameters.properties as { op: { anyOf: { properties: { type: { const: string } } }[] } }).op;
      const types = op.anyOf.map((o) => o.properties.type.const);
      expect(types.length).toBeGreaterThan(0);
      for (const t of ["sit", "leave", "sitOut", "sitIn", "start"]) expect(types).not.toContain(t);
    }
    const types = (actTool(fish).parameters.properties as { op: { anyOf: { properties: { type: { const: string } } }[] } }).op.anyOf.map(
      (o) => o.properties.type.const,
    );
    expect(types).toEqual(["ask"]);
  });

  it("stays byte-identical between calls, so it caches", () => {
    expect(JSON.stringify(actTool(ttt))).toBe(JSON.stringify(actTool(ttt)));
    expect(instructions(ttt, { name: "Robo" })).toBe(instructions(ttt, { name: "Robo" }));
  });
});

describe("instructions", () => {
  it("has the bot's name, its persona and the game's rules", () => {
    const text = instructions(ttt, { name: "Robo", persona: "A pirate." });
    expect(text).toContain("You are Robo");
    expect(text).toContain("A pirate.");
    expect(text).toContain(ttt.meta.rules);
    expect(text).toContain(ttt.meta.botNotes!);
  });
});

describe("parseAct", () => {
  it("accepts a valid move and trims chat", () => {
    expect(parseAct(ttt, { op: { type: "place", cell: 4 }, say: "  center!  " })).toEqual({ op: { type: "place", cell: 4 }, say: "center!" });
    expect(parseAct(ttt, {})).toEqual({ say: undefined });
    expect(parseAct(ttt, { say: "hi" })).toEqual({ say: "hi" });
  });

  it("explains moves it can't make", () => {
    expect(parseAct(ttt, { op: { type: "place", cell: 12 } }).error).toMatch(/isn't a valid move/);
    expect(parseAct(ttt, { op: { type: "leave" } }).error).toMatch(/handled for you/);
    expect(parseAct(ttt, { __invalid: "{oops" }).error).toMatch(/JSON/);
  });
});

describe("updateText", () => {
  const chat = (seq: number, kind: ChatMessage["kind"], text: string, playerId: string | null = null, name: string | null = null): ChatMessage => ({
    seq,
    ts: Date.UTC(2026, 9, 23, 18, 5),
    kind,
    playerId,
    name,
    text,
    cid: null,
  });

  it("lists news, the view and the legal moves", () => {
    const text = updateText({
      chat: [chat(1, "user", "your move, robot", "p1", "Adam"), chat(2, "game", "Round 1: a draw.")],
      view: { board: [null] },
      moves: [{ type: "place", cell: 0 }],
      names: new Map([
        ["p1", "Adam"],
        ["b1", "Robo"],
      ]),
      you: "b1",
    });
    expect(text).toMatch(/^Room chat and news since last time:\n\d\d:\d\d Adam: your move, robot\n\d\d:\d\d \(game\) Round 1: a draw\./);
    expect(text).toContain('player ids: p1 = Adam, b1 = Robo (you)):\n{"board":[null]}');
    expect(text).toContain('It\'s your move. Legal moves:\n{"type":"place","cell":0}');
  });

  it("says when it isn't your move", () => {
    expect(updateText({ chat: [], moves: [], names: new Map(), you: "b1" })).toBe("It isn't your move right now: you can say something or pass.");
  });

  it("writes many moves of one kind once, with the choices", () => {
    const points = ["A1", "B1", "C1", "D1", "E1", "F1", "G1", "H1", "J1", "A2", "B2"];
    const moves = [...points.map((point) => ({ type: "play", point })), { type: "pass" }, { type: "mark", point: "C3" }];
    expect(describeMoves(moves)).toEqual([`{"type":"play","point":"…"} with point one of: ${points.join(" ")}`, '{"type":"pass"}', '{"type":"mark","point":"C3"}']);
    // A few stay one per line.
    expect(describeMoves(moves.slice(-4))).toEqual(['{"type":"play","point":"A2"}', '{"type":"play","point":"B2"}', '{"type":"pass"}', '{"type":"mark","point":"C3"}']);
  });

  it("leaves table moves out of the legal moves", () => {
    expect(gameMoves([{ type: "leave" }, { type: "place", cell: 3 }, { type: "sitOut" }])).toEqual([{ type: "place", cell: 3 }]);
  });
});
