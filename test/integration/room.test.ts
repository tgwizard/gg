import { env, evictDurableObject, runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import type { PokerView } from "../../src/games/poker/engine";
import { CloseCode, PROTOCOL_VERSION } from "../../src/shared/protocol";
import { generateRoomCode } from "../../src/shared/roomCode";
import { createRoom, secret, TestClient } from "./client";

const BASE = "http://gg.test";
const stub = (roomId: string) => env.ROOMS.get(env.ROOMS.idFromName(roomId));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function startPoker(c: TestClient, config: Record<string, unknown> = {}) {
  const game = c.next("game", (g) => g.game !== null);
  const ack = await c.request({ type: "selectGame", gameId: "poker", config });
  expect(ack.ok).toBe(true);
  return (await game).game!;
}

describe("HTTP API", () => {
  it("creates rooms and reports unknown ones as 404", async () => {
    const id = await createRoom();
    const info = await exports.default.fetch(`${BASE}/api/rooms/${id}`);
    expect(info.status).toBe(200);
    expect(await info.json()).toMatchObject({ id });

    expect((await exports.default.fetch(`${BASE}/api/rooms/${id.toLowerCase()}`)).status).toBe(200);
    expect(id).toMatch(/^[0-9A-Z]{10}$/);
    const missing = await exports.default.fetch(`${BASE}/api/rooms/${generateRoomCode()}`);
    expect(missing.status).toBe(404);
    const bogus = await exports.default.fetch(`${BASE}/api/rooms/not-a-code`);
    expect(bogus.status).toBe(404);
  });

  it("closes sockets to rooms that don't exist", async () => {
    const c = await TestClient.connect(generateRoomCode());
    await c.next("error");
    await sleep(20);
    expect(c.closed?.code).toBe(CloseCode.RoomNotFound);
  });
});

describe("joining", () => {
  it("derives a stable player id from the secret and broadcasts presence", async () => {
    const room = await createRoom();
    const { client: alice, welcome } = await TestClient.join(room, secret("alice"), "  Alice   Smith ");
    expect(welcome.you.name).toBe("Alice Smith");
    expect(welcome.you.id).toMatch(/^[0-9a-f]{16}$/);
    expect(welcome.chat.map((m) => m.text)).toEqual(["Alice Smith joined the room."]);

    const membersSeen = alice.next("members", (m) => m.members.length === 2);
    const { client: bob, welcome: bw } = await TestClient.join(room, secret("bob"), "Bob");
    const members = (await membersSeen).members;
    expect(members.map((m) => [m.name, m.online])).toEqual([
      ["Alice Smith", true],
      ["Bob", true],
    ]);

    // Same secret again (another tab / a refresh) is the same player.
    const { welcome: again } = await TestClient.join(room, secret("alice"), "Alice Smith");
    expect(again.you.id).toBe(welcome.you.id);
    expect(again.members).toHaveLength(2);

    const offline = alice.next("members", (m) => m.members.find((x) => x.id === bw.you.id)?.online === false);
    bob.close();
    await offline;
  });

  it("rejects old clients and messages before hello", async () => {
    const room = await createRoom();
    const c = await TestClient.connect(room);
    c.send({ type: "chat", cid: "x", text: "hi" });
    expect((await c.next("error")).code).toBe("not_joined");
    c.send("{not json");
    expect((await c.next("error")).code).toBe("bad_message");
    c.send({ type: "hello", protocol: PROTOCOL_VERSION - 1, secret: secret("old"), name: "Old", chatCursor: null });
    expect((await c.next("error")).code).toBe("outdated");
    await sleep(20);
    expect(c.closed?.code).toBe(CloseCode.Outdated);
  });
});

describe("chat", () => {
  it("broadcasts, dedupes resends and catches up after a disconnect", async () => {
    const room = await createRoom();
    const { client: alice } = await TestClient.join(room, secret("alice"), "Alice");
    const { client: bob, welcome } = await TestClient.join(room, secret("bob"), "Bob");

    const seen = bob.next("chat", (m) => m.messages.some((x) => x.text === "hello"));
    await alice.request({ type: "chat", text: "hello" }, "cid-1");
    await seen;
    // A resend with the same cid (e.g. the ack was lost) is not duplicated.
    expect((await alice.request({ type: "chat", text: "hello" }, "cid-1")).ok).toBe(true);

    // Bob drops; Alice keeps talking.
    const cursor = Math.max(...welcome.chat.map((m) => m.seq), ...bob.received.flatMap((m) => (m.type === "chat" ? m.messages.map((x) => x.seq) : [])));
    bob.close();
    await alice.request({ type: "chat", text: "are you there?" });
    await alice.request({ type: "chat", text: "  " }).then((a) => expect(a.ok).toBe(false));

    const { welcome: back } = await TestClient.join(room, secret("bob"), "Bob", cursor);
    expect(back.chatReset).toBe(false);
    expect(back.chat.map((m) => m.text)).toEqual(["are you there?"]);

    const { welcome: fresh } = await TestClient.join(room, secret("carol"), "Carol");
    expect(fresh.chatReset).toBe(true);
    expect(fresh.chat.filter((m) => m.text === "hello")).toHaveLength(1);
  });

  it("announces renames", async () => {
    const room = await createRoom();
    const { client: alice } = await TestClient.join(room, secret("alice"), "Alice");
    const msg = alice.next("chat", (m) => m.messages.some((x) => x.text.includes("now known as")));
    alice.send({ type: "setProfile", name: "Alicia", color: 0 });
    expect((await msg).messages[0]!.text).toBe("Alice is now known as Alicia.");
  });
});

describe("profiles and room names", () => {
  it("gives the first member a color, and the next one the next free color", async () => {
    const room = await createRoom();
    const { client: alice } = await TestClient.join(room, secret("alice"), "Alice", null, 5);
    const { welcome } = await TestClient.join(room, secret("bob"), "Bob", null, 5);
    const colorOf = (members: { name: string; color: number }[], name: string) => members.find((m) => m.name === name)!.color;
    expect(colorOf(welcome.members, "Alice")).toBe(5);
    expect(welcome.you.color).toBe(6);

    // Alice moves on, so Bob gets the color he asked for.
    const update = alice.next("members", (m) => colorOf(m.members, "Bob") === 5);
    alice.send({ type: "setProfile", name: "Alice", color: 9 });
    expect(colorOf((await update).members, "Alice")).toBe(9);
  });

  it("names rooms at creation and lets anyone in them rename it", async () => {
    const room = await createRoom("  Friday   poker ");
    const { client: alice, welcome } = await TestClient.join(room, secret("alice"), "Alice");
    expect(welcome.roomName).toBe("Friday poker");

    const renamed = alice.next("room");
    const announced = alice.next("chat", (m) => m.messages.some((x) => x.text.includes("named the room")));
    expect((await alice.request({ type: "renameRoom", name: "Taco night" })).ok).toBe(true);
    expect((await renamed).name).toBe("Taco night");
    expect((await announced).messages[0]!.text).toBe("Alice named the room “Taco night”.");

    const { welcome: later } = await TestClient.join(room, secret("bob"), "Bob");
    expect(later.roomName).toBe("Taco night");
    expect(((await (await exports.default.fetch(`http://gg.test/api/rooms/${room}`)).json()) as { name: string }).name).toBe("Taco night");
  });
});

describe("games", () => {
  async function headsUp(config: Record<string, unknown> = {}) {
    const room = await createRoom();
    const { client: alice, welcome: aw } = await TestClient.join(room, secret("alice"), "Alice");
    const { client: bob, welcome: bw } = await TestClient.join(room, secret("bob"), "Bob");
    const game = await startPoker(alice, config);
    const op = (c: TestClient, o: unknown) => c.request({ type: "gameOp", instanceId: game.instanceId, op: o });
    expect((await op(alice, { type: "sit", seat: 0 })).ok).toBe(true);
    expect((await op(bob, { type: "sit", seat: 4 })).ok).toBe(true);
    const dealt = bob.next("game", (g) => (g.game!.view as PokerView).hand !== null);
    expect((await op(alice, { type: "start" })).ok).toBe(true);
    await dealt;
    return { room, alice, bob, game, op, aliceId: aw.you.id, bobId: bw.you.id };
  }

  it("rejects unknown games, bad config and a second game", async () => {
    const room = await createRoom();
    const { client } = await TestClient.join(room, secret("a"), "A");
    expect(await client.request({ type: "selectGame", gameId: "nope", config: {} })).toMatchObject({ ok: false, error: { code: "unknown_game" } });
    expect(await client.request({ type: "selectGame", gameId: "poker", config: { bigBlind: -1 } })).toMatchObject({ ok: false, error: { code: "bad_config" } });
    await startPoker(client);
    expect(await client.request({ type: "selectGame", gameId: "poker", config: {} })).toMatchObject({ ok: false, error: { code: "game_in_progress" } });
  });

  it("only ever sends each player their own hole cards", async () => {
    const { room, alice, bob } = await headsUp();
    const { client: carol } = await TestClient.join(room, secret("carol"), "Carol");
    const aView = alice.latestGame()!.view as PokerView;
    const bView = bob.latestGame()!.view as PokerView;
    const aCards = aView.hand!.players.find((p) => p.seat === 0)!.cards!;
    const bCards = bView.hand!.players.find((p) => p.seat === 4)!.cards!;
    expect(aCards).toHaveLength(2);
    expect(bCards).toHaveLength(2);
    // Check every byte each client received, not just the latest view.
    for (const card of bCards) expect(alice.raw.join("")).not.toContain(`"${card}"`);
    for (const card of aCards) expect(bob.raw.join("")).not.toContain(`"${card}"`);
    for (const card of [...aCards, ...bCards]) expect(carol.raw.join("")).not.toContain(`"${card}"`);
    expect((carol.latestGame()!.view as PokerView).hand!.players.every((p) => p.cards === null)).toBe(true);
    expect(alice.raw.join("")).not.toContain("deck");
  });

  it("applies an op once even if it is resent, and rejects stale resends", async () => {
    const { alice, bob, game } = await headsUp();
    const before = alice.latestGame()!.version;
    const toAct = [alice, bob].find((c) => (c.latestGame()!.view as PokerView).you.actions)!;
    const msg = { type: "gameOp", instanceId: game.instanceId, op: { type: "call" } };
    expect((await toAct.request(msg, "resend-me")).ok).toBe(true);
    // Same cid again, as the client does after reconnecting without an ack.
    expect((await toAct.request(msg, "resend-me")).ok).toBe(true);
    await sleep(20);
    expect(toAct.latestGame()!.version).toBe(before + 1);

    // A resend carrying an outdated version is refused rather than applied blind.
    const stale = await toAct.request({ ...msg, op: { type: "sitOut" }, ifVersion: before });
    expect(stale).toMatchObject({ ok: false, error: { code: "stale" } });
  });

  it("restores the full game on reconnect, with your own cards", async () => {
    const { room, alice, game } = await headsUp();
    const mine = (alice.latestGame()!.view as PokerView).hand!.players.find((p) => p.seat === 0)!.cards;
    alice.close();
    const { welcome } = await TestClient.join(room, secret("alice"), "Alice");
    expect(welcome.game!.instanceId).toBe(game.instanceId);
    const view = welcome.game!.view as PokerView;
    expect(view.you.seat).toBe(0);
    expect(view.hand!.players.find((p) => p.seat === 0)!.cards).toEqual(mine);
  });

  it("survives the Durable Object being evicted from memory", async () => {
    const { room, alice, game } = await headsUp();
    const version = alice.latestGame()!.version;
    await evictDurableObject(stub(room));
    const { welcome } = await TestClient.join(room, secret("alice"), "Alice");
    expect(welcome.game).toMatchObject({ instanceId: game.instanceId, version });
    expect(welcome.chat.some((m) => m.text === "Alice started Texas Hold'em.")).toBe(true);
  });

  it("runs turn timers off the alarm", async () => {
    const { room, alice, bob, aliceId } = await headsUp({ turnSeconds: 1 });
    const waitingOn = alice.latestGame()!.waitingOn;
    expect(waitingOn).toHaveLength(1);
    const timedOut = waitingOn[0] === aliceId ? 0 : 4;
    // The real alarm (scheduled for the turn deadline) fires and auto-folds.
    const update = await bob.next("game", (g) => (g.game!.view as PokerView).seats[timedOut]!.sittingOut, 4000);
    expect((update.game!.view as PokerView).hand!.status).toBe("complete");
    // And the next alarm is already queued (sweep or next hand).
    expect(await runDurableObjectAlarm(stub(room))).toBe(true);
  });

  it("drops a game that no longer exists after a deploy, instead of wedging the room", async () => {
    const { room } = await headsUp();
    await runInDurableObject(stub(room), (_i, state) => {
      const row = state.storage.sql.exec<{ value: string }>(`SELECT value FROM kv WHERE key = 'game'`).one();
      state.storage.sql.exec(`UPDATE kv SET value = ? WHERE key = 'game'`, JSON.stringify({ ...JSON.parse(row.value), gameId: "retired" }));
    });
    await evictDurableObject(stub(room));
    const { welcome } = await TestClient.join(room, secret("alice"), "Alice");
    expect(welcome.game).toBeNull();
    expect(welcome.chat.at(-1)!.text).toMatch(/no longer available/);
  });

  it("only lets players (or the starter) end a game while players are around", async () => {
    const { room, alice, bob, game } = await headsUp();
    const { client: carol } = await TestClient.join(room, secret("carol"), "Carol");
    expect(await carol.request({ type: "endGame", instanceId: game.instanceId })).toMatchObject({ ok: false, error: { code: "not_a_player" } });
    // Once the players have all left the room, anyone can clean up.
    alice.close();
    bob.close();
    await sleep(30);
    expect((await carol.request({ type: "endGame", instanceId: game.instanceId })).ok).toBe(true);
  });

  it("ends games, and refuses ops for an ended game", async () => {
    const { alice, bob, game, op } = await headsUp();
    const cleared = bob.next("game", (g) => g.game === null);
    expect((await alice.request({ type: "endGame", instanceId: game.instanceId })).ok).toBe(true);
    await cleared;
    expect(await op(bob, { type: "fold" })).toMatchObject({ ok: false, error: { code: "no_such_game" } });
  });
});
