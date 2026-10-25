import { beforeEach, describe, expect, it, vi } from "vitest";
import { storage } from "../storage";

// The store tells the page about changes with window events.
vi.stubGlobal("window", new EventTarget());
vi.spyOn(console, "warn").mockImplementation(() => {});
const store = await import("./store");

const setup = { name: "Marvin", color: 3, level: "builtin" as const, strength: "easy" as const };

describe("your bots", () => {
  beforeEach(() => storage.set("gg.bots", "[]"));

  it("are one player each, in as many rooms as you invite them to", async () => {
    const bot = (await store.createBot(setup))!;
    expect(bot.playerId).toMatch(/^[0-9a-f]{16}$/);
    expect(store.inviteBot(bot.id, "ROOM1")).toBe(true);
    expect(store.inviteBot(bot.id, "ROOM2")).toBe(true);
    expect(Object.keys(store.getBots()[0]!.rooms)).toEqual(["ROOM1", "ROOM2"]);
    expect(store.playingIn("ROOM1").map((b) => b.playerId)).toEqual([bot.playerId]);
  });

  it("leave one room when taken out of it, and stay yours", async () => {
    const bot = (await store.createBot(setup))!;
    store.inviteBot(bot.id, "ROOM1");
    store.removeFromRoom(bot.id, "ROOM1");
    expect(store.playingIn("ROOM1")).toEqual([]);
    expect(store.botsIn("ROOM1")).toHaveLength(1); // still to leave
    store.leftRoom(bot.id, "ROOM1");
    expect(store.getBots()).toMatchObject([{ id: bot.id, rooms: {} }]);
  });

  it("are forgotten once deleted and out of every room", async () => {
    const bot = (await store.createBot(setup))!;
    store.inviteBot(bot.id, "ROOM1");
    store.inviteBot(bot.id, "ROOM2");
    store.deleteBot(bot.id);
    expect(store.getBots()[0]).toMatchObject({ deleted: true, rooms: { ROOM1: { removing: true }, ROOM2: { removing: true } } });
    expect(store.inviteBot(bot.id, "ROOM3") && Object.keys(store.getBots()[0]!.rooms)).toEqual(["ROOM1", "ROOM2"]);
    store.leftRoom(bot.id, "ROOM1");
    expect(store.getBots()).toHaveLength(1);
    store.leftRoom(bot.id, "ROOM2");
    expect(store.getBots()).toEqual([]);

    const unused = (await store.createBot(setup))!;
    store.deleteBot(unused.id);
    expect(store.getBots()).toEqual([]);
  });

  it("keep their personality whether or not they play with AI, and lose AI with its key", async () => {
    const bot = (await store.createBot({ ...setup, level: "ai", connectionId: "k1", model: "m", persona: "  Gloomy.  " }))!;
    expect(store.getBots()[0]).toMatchObject({ level: "ai", connectionId: "k1", effort: "low", persona: "Gloomy." });
    store.dropConnection("k1");
    expect(store.getBots()[0]).toMatchObject({ id: bot.id, level: "builtin", strength: "hard", persona: "Gloomy." });
    expect(store.getBots()[0]!.connectionId).toBeUndefined();
  });

  it("from before there was a choice of strength play hard, as they did", () => {
    const old = { id: "x", name: "Old", color: 1, level: "easy", secret: "a".repeat(32), playerId: "a".repeat(16), createdAt: "2026-10-20T10:00:00Z", rooms: {} };
    storage.set("gg.bots", JSON.stringify([old]));
    expect(store.getBots()[0]).toMatchObject({ level: "builtin" });
    expect(store.getBots()[0]!.strength ?? "hard").toBe("hard");
  });

  it("come from the old per-room bots, one per name", () => {
    const old = (name: string, roomId: string, secret: string) => ({ id: secret, name, color: 1, level: "easy", roomId, secret, playerId: secret.slice(0, 16), addedAt: "2026-10-20T10:00:00Z" });
    storage.set("gg.bots", JSON.stringify([old("Beep", "R1", "a".repeat(32)), old("beep", "R2", "b".repeat(32)), old("Boop", "R2", "c".repeat(32))]));
    expect(store.getBots().map((b) => [b.name, b.secret[0], Object.keys(b.rooms)])).toEqual([
      ["Beep", "a", ["R1"]],
      ["Boop", "c", ["R2"]],
    ]);
  });
});
