import { env, evictDurableObject, runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import type { PokerView } from "../../src/games/poker/engine";
import { CloseCode, MAX_OWNED_PER_PLAYER, PROTOCOL_VERSION } from "../../src/shared/protocol";
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

describe("bots", () => {
  it("joins bots for their owner, sends only them their legal moves, and lets them leave for good", async () => {
    const room = await createRoom();
    const { client: alice, welcome: aw } = await TestClient.join(room, secret("alice"), "Alice");
    const added = alice.next("chat", (c) => c.messages.some((m) => m.text === "Alice added a bot, Beep."));
    const { client: bot, welcome: bw } = await TestClient.join(room, secret("beep"), "Beep", null, 3, secret("alice"));
    expect(bw.you).toMatchObject({ kind: "bot", ownerId: aw.you.id });
    await added;

    const botGame = bot.next("game", (g) => g.game !== null);
    const aliceGame = alice.next("game", (g) => g.game !== null);
    expect((await alice.request({ type: "selectGame", gameId: "tictactoe", config: {} })).ok).toBe(true);
    const game = (await botGame).game!;
    expect(game.legalOps).toEqual([
      { type: "sit", seat: 0 },
      { type: "sit", seat: 1 },
    ]);
    expect((await aliceGame).game).not.toHaveProperty("legalOps");
    const seated = bot.next("game", (g) => g.game!.legalOps!.some((op) => (op as { type: string }).type === "leave"));
    expect((await bot.request({ type: "gameOp", instanceId: game.instanceId, op: { type: "sit", seat: 0 } })).ok).toBe(true);
    await seated;

    expect(await alice.request({ type: "leaveRoom" })).toMatchObject({ ok: false, error: { code: "not_a_bot" } });
    const gone = alice.next("members", (m) => m.members.every((x) => x.id !== bw.you.id));
    const removed = alice.next("chat", (c) => c.messages.some((m) => m.text === "Alice removed Beep."));
    // Leaving the room gives up its seat too, in the same step.
    const unseated = alice.next("game", (g) => !g.game!.players.includes(bw.you.id));
    expect((await bot.request({ type: "leaveRoom" })).ok).toBe(true);
    await Promise.all([gone, removed, unseated]);
    await sleep(20);
    expect(bot.closed?.code).toBe(CloseCode.Left);
    const { welcome: later } = await TestClient.join(room, secret("carol"), "Carol");
    expect(later.game!.players).toEqual([]);
  });

  it("only lets people in the room own bots: not bots, not strangers", async () => {
    const room = await createRoom();
    await TestClient.join(room, secret("alice"), "Alice");
    await TestClient.join(room, secret("beep"), "Beep", null, 0, secret("alice"));
    for (const owner of [secret("beep"), secret("nobody-here")]) {
      const c = await TestClient.connect(room);
      c.send({ type: "hello", protocol: PROTOCOL_VERSION, secret: secret(`child-of-${owner}`), name: "Child", chatCursor: null, owner });
      expect(await c.next("error")).toMatchObject({ code: "no_owner" });
    }
    // A person can't make themselves a bot by claiming an owner later.
    const { welcome } = await TestClient.join(room, secret("alice"), "Alice", null, 0, secret("beep"));
    expect(welcome.you).toMatchObject({ kind: "human" });
    expect(welcome.you).not.toHaveProperty("bot");
  });

  it("shows everyone what a member is up to, until they're done or gone", async () => {
    const room = await createRoom();
    const { client: alice } = await TestClient.join(room, secret("alice"), "Alice");
    const { client: bot, welcome: bw } = await TestClient.join(room, secret("beep"), "Beep", null, 0, secret("alice"));
    const activityOf = (m: { members: { id: string; activity?: string }[] }) => m.members.find((x) => x.id === bw.you.id)?.activity;

    const thinking = alice.next("members", (m) => activityOf(m) === "Thinking about its move");
    bot.send({ type: "activity", text: "  Thinking about\u200b its move  " });
    await thinking;
    const done = alice.next("members", (m) => activityOf(m) === undefined);
    bot.send({ type: "activity", text: null });
    await done;

    bot.send({ type: "activity", text: "x".repeat(100) });
    expect(activityOf(await alice.next("members", (m) => activityOf(m) !== undefined))).toHaveLength(40);
    const gone = alice.next("members", (m) => activityOf(m) === undefined);
    bot.close();
    await gone;
  });

  it("tells everyone how a bot plays, which only the bot can change", async () => {
    const room = await createRoom();
    const { client: alice, welcome: aw } = await TestClient.join(room, secret("alice"), "Alice");
    const bot = await TestClient.connect(room);
    const welcome = bot.next("welcome");
    bot.send({
      type: "hello",
      protocol: PROTOCOL_VERSION,
      secret: secret("luna"),
      name: "Luna",
      color: 2,
      chatCursor: null,
      owner: secret("alice"),
      bot: { level: "ai", model: "muse-spark-1.3", provider: "Meta", effort: "low" },
    });
    const luna = (await welcome).you;
    expect(luna.bot).toEqual({ level: "ai", model: "muse-spark-1.3", provider: "Meta", effort: "low" });

    const switched = alice.next("members", (m) => m.members.find((x) => x.id === luna.id)?.bot?.level === "easy");
    bot.send({ type: "setProfile", name: "Luna", color: 2, bot: { level: "easy" } });
    await switched;

    // People don't get bot info, whatever they send.
    alice.send({ type: "setProfile", name: "Alice", color: 0, bot: { level: "ai", model: "fake" } });
    alice.send({ type: "setProfile", name: "Alicia", color: 0 });
    const renamed = await alice.next("members", (m) => m.members.some((x) => x.name === "Alicia"));
    expect(renamed.members.find((x) => x.id === aw.you.id)).not.toHaveProperty("bot");
  });

  it("caps how many bots one player can add", async () => {
    const room = await createRoom();
    await TestClient.join(room, secret("alice"), "Alice");
    for (let i = 0; i < MAX_OWNED_PER_PLAYER; i++) await TestClient.join(room, secret(`bot${i}`), `Bot ${i}`, null, 0, secret("alice"));
    const extra = await TestClient.connect(room);
    extra.send({ type: "hello", protocol: PROTOCOL_VERSION, secret: secret("one-too-many"), name: "Extra", chatCursor: null, owner: secret("alice") });
    expect(await extra.next("error")).toMatchObject({ code: "rate_limited" });
  });

  it("joins a guest (hot seat) as a person on its owner's device, who can leave for good", async () => {
    const room = await createRoom();
    const { client: alice, welcome: aw } = await TestClient.join(room, secret("alice"), "Alice");
    const sam = await TestClient.connect(room);
    const joined = alice.next("chat", (c) => c.messages.some((m) => m.text === "Sam joined on Alice's device."));
    sam.send({ type: "hello", protocol: PROTOCOL_VERSION, secret: secret("sam"), name: "Sam", chatCursor: null, owner: secret("alice"), guest: true });
    const sw = await sam.next("welcome");
    expect(sw.you).toMatchObject({ kind: "guest", ownerId: aw.you.id });
    expect(sw.you).not.toHaveProperty("bot");
    await joined;
    // A guest plays like anyone: no legal moves are sent, as to a bot.
    const started = sam.next("game", (g) => g.game !== null);
    expect((await alice.request({ type: "selectGame", gameId: "tictactoe", config: {} })).ok).toBe(true);
    const { instanceId } = (await started).game!;
    const seated = sam.next("game", (g) => g.game?.players.includes(sw.you.id) ?? false);
    expect((await sam.request({ type: "gameOp", instanceId, op: { type: "sit", seat: 1 } })).ok).toBe(true);
    const snapshot = await seated;
    expect(snapshot.game).not.toHaveProperty("legalOps");
    // Taken out by its owner, it gives up its seat and the room forgets it.
    const gone = alice.next("members", (m) => !m.members.some((x) => x.id === sw.you.id));
    expect(await sam.request({ type: "leaveRoom" })).toMatchObject({ ok: true });
    await gone;
    // People can't leave that way.
    expect(await alice.request({ type: "leaveRoom" })).toMatchObject({ ok: false, error: { code: "not_a_bot" } });
  });

  it("upgrades rooms made before bots had owners", async () => {
    const room = await createRoom();
    const { client } = await TestClient.join(room, secret("alice"), "Alice");
    client.close();
    await runInDurableObject(stub(room), (_, state) => {
      state.storage.sql.exec(`ALTER TABLE members DROP COLUMN owner_id`);
    });
    await evictDurableObject(stub(room));
    const { welcome } = await TestClient.join(room, secret("beep"), "Beep", null, 0, secret("alice"));
    expect(welcome.members.map((m) => [m.name, m.kind, m.ownerId !== null])).toEqual([
      ["Alice", "human", false],
      ["Beep", "bot", true],
    ]);
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

  it("applies a deadline that has passed before a move, even if the alarm hasn't run yet", async () => {
    const { room, alice, bob, aliceId, game } = await headsUp({ turnSeconds: 30 });
    const late = alice.latestGame()!.waitingOn[0] === aliceId ? alice : bob;
    const version = late.latestGame()!.version;
    expect(late.latestGame()!.deadline).toBeGreaterThan(Date.now());
    // Pretend the clock ran out a moment ago, without the alarm having fired.
    await runInDurableObject(stub(room), (instance) => {
      const g = (instance as unknown as { game: { state: { timers: { turn?: number } } } }).game;
      g.state.timers.turn = Date.now() - 1;
    });
    const ack = await late.request({ type: "gameOp", instanceId: game.instanceId, op: { type: "fold" }, ifVersion: version });
    expect(ack).toMatchObject({ ok: false, error: { code: "stale" } });
    const view = late.latestGame()!.view as PokerView;
    expect(view.hand!.status).toBe("complete");
    expect(view.hand!.players.some((p) => p.lastAction?.endsWith("(timeout)"))).toBe(true);
  });

  it("lets Battleship players place their fleets at the same time", async () => {
    const room = await createRoom();
    const { client: alice } = await TestClient.join(room, secret("alice"), "Alice");
    const { client: bob } = await TestClient.join(room, secret("bob"), "Bob");
    const placing = bob.next("game", (g) => (g.game!.view as { phase: string }).phase === "placing");
    expect((await alice.request({ type: "selectGame", gameId: "battleship", config: {} })).ok).toBe(true);
    const { instanceId } = alice.latestGame() ?? (await alice.next("game", (g) => g.game !== null)).game!;
    const op = (c: TestClient, o: unknown, ifVersion?: number) => c.request({ type: "gameOp", instanceId, op: o, ifVersion });
    expect((await op(alice, { type: "sit", seat: 0 })).ok).toBe(true);
    expect((await op(bob, { type: "sit", seat: 1 })).ok).toBe(true);
    const seen = (await placing).game!.version;
    // Both place against the same version: neither is refused as stale.
    const carrier = { id: "carrier", row: 0, col: 0, vertical: false };
    expect((await op(alice, { type: "arrange", ships: [carrier] }, seen)).ok).toBe(true);
    expect((await op(bob, { type: "arrange", ships: [carrier] }, seen)).ok).toBe(true);
    // Other moves still are.
    expect(await op(bob, { type: "leave" }, seen)).toMatchObject({ ok: false, error: { code: "stale" } });
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
