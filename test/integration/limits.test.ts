import { env, runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { CloseCode, RATE_LIMITED, ROOM_FULL } from "../../src/shared/protocol";
import { ROOM_IDLE_TTL_MS, ROOM_UNUSED_TTL_MS } from "../../src/worker/limits";
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

  it("keeps only a player's newest connections", async () => {
    const room = await createRoom();
    const tabs: TestClient[] = [];
    for (let i = 0; i < 7; i++) {
      tabs.push((await TestClient.join(room, secret("refresher"), "Refresher")).client);
      await sleep(2);
    }
    await sleep(20);
    expect(tabs[0]!.closed?.code).toBe(4001);
    expect(tabs.slice(1).every((t) => t.closed === null)).toBe(true);
  });

  it("refuses connections to a full room", async () => {
    const room = await createRoom();
    for (let i = 0; i < 100; i++) await TestClient.connect(room);
    const extra = await TestClient.connect(room);
    await sleep(10);
    expect(extra.received[0]).toMatchObject({ type: "error", code: ROOM_FULL });
    expect(extra.closed?.code).toBe(CloseCode.RateLimited);
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
  });

  it("never expires a room while someone is connected", async () => {
    const room = await createRoom();
    await TestClient.join(room, secret("here"), "Here");
    await age(room, ROOM_IDLE_TTL_MS * 2);
    await runDurableObjectAlarm(stub(room));
    expect(await exists(room)).toBe(true);
  });
});
