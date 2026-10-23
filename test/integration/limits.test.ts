import { env, runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { CloseCode, PROTOCOL_VERSION, RATE_LIMITED, ROOM_FULL } from "../../src/shared/protocol";
import { ROOM_IDLE_TTL_MS, ROOM_UNUSED_TTL_MS } from "../../src/worker/limits";
import { generateRoomCode } from "../../src/shared/roomCode";
import { createRoom, postRoom, randomIp, secret, TestClient } from "./client";

const BASE = "http://gg.test";
const stub = (roomId: string) => env.ROOMS.get(env.ROOMS.idFromName(roomId));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const exists = async (roomId: string) => (await exports.default.fetch(`${BASE}/api/rooms/${roomId}`)).status === 200;

describe("rate limits", () => {
  it("limits room creation per IP, with a message the UI can show", async () => {
    const ip = randomIp();
    for (let i = 0; i < 10; i++) expect((await postRoom(ip)).status).toBe(201);
    const limited = await postRoom(ip);
    expect(limited.status).toBe(429);
    expect(limited.headers.get("Retry-After")).toBe("60");
    expect(await limited.json()).toMatchObject({ error: RATE_LIMITED, message: expect.stringMatching(/minute/) });
    // Other people are unaffected.
    expect((await postRoom(randomIp())).status).toBe(201);
  });

  it("limits connection attempts per IP well above a refresh loop", async () => {
    const room = await createRoom();
    const ip = randomIp();
    // 60 = refreshing every second for a full minute: must still work.
    for (let i = 0; i < 60; i++) {
      const c = await TestClient.connect(room, ip);
      expect(c.closed).toBeNull();
      c.close();
    }
    let rejected: TestClient | null = null;
    for (let i = 0; i < 100 && !rejected; i++) {
      const c = await TestClient.connect(room, ip);
      await sleep(1);
      if (c.received.some((m) => m.type === "error")) rejected = c;
      else c.close();
    }
    expect(rejected).not.toBeNull();
    expect(rejected!.received[0]).toMatchObject({ type: "error", code: RATE_LIMITED, retryAfterMs: expect.any(Number) });
    await sleep(10);
    expect(rejected!.closed?.code).toBe(CloseCode.RateLimited);
  });

  it("lets a burst of queued chat through, then rejects with a readable ack", async () => {
    const room = await createRoom();
    const { client } = await TestClient.join(room, secret("chatty"), "Chatty");
    // A reconnect flushes everything typed while offline at once: 15 must pass.
    const acks = await Promise.all(Array.from({ length: 15 }, (_, i) => client.request({ type: "chat", text: `queued ${i}` })));
    expect(acks.every((a) => a.ok)).toBe(true);
    const limited = await client.request({ type: "chat", text: "one too many" });
    expect(limited).toMatchObject({ ok: false, error: { code: RATE_LIMITED } });
    // Refills at about one message a second.
    await sleep(1100);
    expect((await client.request({ type: "chat", text: "after a pause" })).ok).toBe(true);
    // Moves have their own, roomier budget.
    expect((await client.request({ type: "selectGame", gameId: "poker", config: {} })).ok).toBe(true);
  });

  it("disconnects a socket that keeps flooding, telling it when to come back", async () => {
    const room = await createRoom();
    const { client } = await TestClient.join(room, secret("flood"), "Flood");
    for (let i = 0; i < 120; i++) client.send({ type: "chat", cid: `f${i}`, text: "spam" });
    await sleep(50);
    expect(client.closed?.code).toBe(CloseCode.RateLimited);
    expect(client.received.some((m) => m.type === "error" && m.code === RATE_LIMITED && m.retryAfterMs! > 0)).toBe(true);
  });

  it("keeps only a player's newest connections, telling the old tab not to reconnect", async () => {
    const room = await createRoom();
    const tabs: TestClient[] = [];
    for (let i = 0; i < 7; i++) {
      tabs.push((await TestClient.join(room, secret("refresher"), "Refresher")).client);
      await sleep(2);
    }
    await sleep(20);
    expect(tabs[0]!.closed?.code).toBe(CloseCode.Replaced);
    expect(tabs.slice(1).every((t) => t.closed === null)).toBe(true);
  });
});

describe("griefing a room", () => {
  /** Move every socket's connect time into the past, as if they'd been open a while. */
  async function ageSockets(roomId: string, ms: number) {
    await runInDurableObject(stub(roomId), (_i, state) => {
      for (const ws of state.getWebSockets()) {
        const att = ws.deserializeAttachment() as { connectedAt: number };
        ws.serializeAttachment({ ...att, connectedAt: att.connectedAt - ms });
      }
    });
  }

  it("closes connections that never say hello, even if they keep pinging", async () => {
    const room = await createRoom();
    const { client: player } = await TestClient.join(room, secret("real"), "Real");
    const squatters = await Promise.all(Array.from({ length: 10 }, () => TestClient.connect(room)));
    for (const s of squatters) s.send("ping");
    await sleep(20);
    await ageSockets(room, 11_000);
    await runDurableObjectAlarm(stub(room));
    await sleep(20);
    expect(squatters.every((s) => s.closed !== null)).toBe(true);
    expect(player.closed).toBeNull();
  });

  it("caps connections per IP per room, and counts only joined players towards a full room", async () => {
    const room = await createRoom();
    const ip = randomIp();
    for (let i = 0; i < 20; i++) await TestClient.connect(room, ip);
    const extra = await TestClient.connect(room, ip);
    await sleep(10);
    expect(extra.received[0]).toMatchObject({ type: "error", code: RATE_LIMITED });
    // Those 20 squatters don't stop real players from joining.
    const { welcome } = await TestClient.join(room, secret("someone"), "Someone");
    expect(welcome.you.name).toBe("Someone");
  });

  it("refuses new players once 100 are connected", async () => {
    const room = await createRoom();
    for (let i = 0; i < 100; i++) await TestClient.join(room, secret(`p${i}`), `P${i}`);
    const extra = await TestClient.connect(room);
    await sleep(10);
    expect(extra.received[0]).toMatchObject({ type: "error", code: ROOM_FULL });
    expect(extra.closed?.code).toBe(CloseCode.RateLimited);
  });

  it("refuses oversized messages before reading them", async () => {
    const room = await createRoom();
    const { client: alice } = await TestClient.join(room, secret("alice"), "Alice");
    const { client: bob } = await TestClient.join(room, secret("bob"), "Bob");
    alice.send({ type: "chat", cid: "big", text: "hi", padding: "x".repeat(1_000_000) });
    expect(await alice.next("error")).toMatchObject({ code: "bad_message" });
    // A normal message right after goes through, and the big one never did.
    expect((await alice.request({ type: "chat", text: "hello" })).ok).toBe(true);
    await sleep(20);
    const texts = bob.received.flatMap((m) => (m.type === "chat" ? m.messages.map((x) => x.text) : []));
    expect(texts).toContain("hello");
    expect(texts).not.toContain("hi");
  });

  it("reads only so much of a new room's body", async () => {
    const res = await postRoom(randomIp(), { name: "Big", padding: "x".repeat(100_000) });
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ name: null });
  });

  it("allows one identity per connection", async () => {
    const room = await createRoom();
    const { client } = await TestClient.join(room, secret("first"), "First");
    client.send({ type: "hello", protocol: PROTOCOL_VERSION, secret: secret("second"), name: "Second", chatCursor: null });
    expect((await client.next("error")).code).toBe("already_joined");
    const { welcome } = await TestClient.join(room, secret("observer"), "Observer");
    expect(welcome.members.map((m) => m.name)).toEqual(["First", "Observer"]);
  });

  it("limits how fast one network can mint new identities", async () => {
    const room = await createRoom();
    const ip = randomIp();
    for (let i = 0; i < 6; i++) {
      const c = await TestClient.connect(room, ip);
      const welcome = c.next("welcome");
      c.send({ type: "hello", protocol: PROTOCOL_VERSION, secret: secret(`fresh${i}`), name: `Fresh${i}`, chatCursor: null });
      await welcome;
    }
    const c = await TestClient.connect(room, ip);
    c.send({ type: "hello", protocol: PROTOCOL_VERSION, secret: secret("fresh-too-many"), name: "Spam", chatCursor: null });
    expect(await c.next("error")).toMatchObject({ code: RATE_LIMITED, retryAfterMs: expect.any(Number) });
    await sleep(10);
    expect(c.closed?.code).toBe(CloseCode.RateLimited);
    // A returning player (known identity) from the same network is fine.
    const back = await TestClient.connect(room, ip);
    const welcome = back.next("welcome");
    back.send({ type: "hello", protocol: PROTOCOL_VERSION, secret: secret("fresh0"), name: "Fresh0", chatCursor: null });
    await welcome;
  });

  it("forgets the longest-gone members once the room has 200", async () => {
    const room = await createRoom();
    await TestClient.join(room, secret("seed"), "Seed");
    await runInDurableObject(stub(room), (_i, state) => {
      for (let i = 0; i < 199; i++) {
        state.storage.sql.exec(`INSERT INTO members (id, name, kind, joined_at, last_seen_at) VALUES (?, ?, 'human', ?, ?)`, `old${i}`, `Old${i}`, i, i);
      }
    });
    const { welcome } = await TestClient.join(room, secret("newcomer"), "Newcomer");
    expect(welcome.members).toHaveLength(200);
    expect(welcome.members.some((m) => m.id === "old0")).toBe(false);
    expect(welcome.members.some((m) => m.name === "Seed")).toBe(true); // online: never evicted
  });

  it("shares a budget across connections from one network, and refused moves write nothing", async () => {
    const room = await createRoom();
    const ip = randomIp();
    const clients: TestClient[] = [];
    for (let i = 0; i < 4; i++) {
      const c = await TestClient.connect(room, ip);
      const welcome = c.next("welcome");
      c.send({ type: "hello", protocol: PROTOCOL_VERSION, secret: secret(`house${i}`), name: `House${i}`, chatCursor: null });
      await welcome;
      clients.push(c);
    }
    // 4 x 15 bursts would pass per-connection limits; the network's shared budget stops it.
    const acks = await Promise.all(clients.flatMap((c) => Array.from({ length: 15 }, (_, i) => c.request({ type: "chat", text: `m${i}` }))));
    expect(acks.filter((a) => !a.ok).length).toBeGreaterThan(0);

    const opsRows = () => runInDurableObject(stub(room), (_i, state) => state.storage.sql.exec<{ n: number }>(`SELECT COUNT(*) AS n FROM ops`).one().n);
    const before = await opsRows();
    const { client: other } = await TestClient.join(room, secret("mover"), "Mover");
    for (let i = 0; i < 10; i++) await other.request({ type: "gameOp", instanceId: "nope", op: { type: "fold" } });
    expect(await opsRows()).toBe(before);
  });

  it("doesn't create storage for rooms that don't exist", async () => {
    const ghost = generateRoomCode();
    expect((await exports.default.fetch(`${BASE}/api/rooms/${ghost}`)).status).toBe(404);
    const c = await TestClient.connect(ghost);
    await c.next("error");
    const tables = await runInDurableObject(stub(ghost), (_i, state) =>
      state.storage.sql.exec<{ n: number }>(`SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table'`).one().n,
    );
    expect(tables).toBe(0);
  });

  it("wakes an idle room with connected players only every few minutes", async () => {
    const room = await createRoom();
    await TestClient.join(room, secret("idle"), "Idle");
    const alarm = await runInDurableObject(stub(room), (_i, state) => state.storage.getAlarm());
    expect(alarm! - Date.now()).toBeGreaterThan(4 * 60_000);
  });
});

describe("room expiry", () => {
  /** Pretend time has passed by moving the room's timestamps into the past. */
  async function age(roomId: string, ms: number) {
    await runInDurableObject(stub(roomId), (_instance, state) => {
      for (const key of ["room", "activity"]) {
        const row = state.storage.sql.exec<{ value: string }>(`SELECT value FROM kv WHERE key = ?`, key).toArray()[0];
        if (!row) continue;
        const value = JSON.parse(row.value);
        const aged = typeof value === "number" ? value - ms : { ...value, createdAt: value.createdAt - ms };
        state.storage.sql.exec(`UPDATE kv SET value = ? WHERE key = ?`, JSON.stringify(aged), key);
      }
    });
  }

  it("deletes rooms nobody ever joined after a day", async () => {
    const room = await createRoom();
    await age(room, ROOM_UNUSED_TTL_MS - 60_000);
    await runDurableObjectAlarm(stub(room));
    expect(await exists(room)).toBe(true);
    await age(room, 120_000);
    await runDurableObjectAlarm(stub(room));
    expect(await exists(room)).toBe(false);
  });

  it("deletes idle rooms after 30 days, with everything in them", async () => {
    const room = await createRoom();
    const { client } = await TestClient.join(room, secret("old"), "Old");
    await client.request({ type: "chat", text: "remember me" });
    client.close();
    await sleep(20);
    await age(room, ROOM_UNUSED_TTL_MS * 2); // a joined room outlives the unused TTL
    await runDurableObjectAlarm(stub(room));
    expect(await exists(room)).toBe(true);

    await age(room, ROOM_IDLE_TTL_MS);
    await runDurableObjectAlarm(stub(room));
    expect(await exists(room)).toBe(false);
    const c = await TestClient.connect(room);
    expect((await c.next("error")).code).toBe("room_not_found");
    // And nothing is left behind.
    const tables = await runInDurableObject(stub(room), (_i, state) =>
      state.storage.sql.exec<{ n: number }>(`SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table'`).one().n,
    );
    expect(tables).toBe(0);
  });

  it("never expires a room while someone is connected", async () => {
    const room = await createRoom();
    await TestClient.join(room, secret("here"), "Here");
    await age(room, ROOM_IDLE_TTL_MS * 2);
    await runDurableObjectAlarm(stub(room));
    expect(await exists(room)).toBe(true);
  });
});
