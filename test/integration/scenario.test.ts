/** Practice rooms: only they take a set-up game (a /try scenario), and only from people in them. */
import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { scenarios } from "../../src/games/scenarios";
import type { TttView } from "../../src/games/tictactoe";
import { postRoom, randomIp, secret, TestClient } from "./client";

const BASE = "http://gg.test";
const winInOne = scenarios.tictactoe!.find((s) => s.id === "win-in-one")!;
const ctx = { now: Date.now(), randomInt: () => 0, nameOf: (id: string) => id, announce: () => {} };

async function room(practice?: unknown): Promise<string> {
  const res = await postRoom(randomIp(), practice === undefined ? {} : { practice });
  return ((await res.json()) as { id: string }).id;
}

function load(roomId: string, body: Record<string, unknown>) {
  return exports.default.fetch(`${BASE}/api/rooms/${roomId}/scenario`, {
    method: "POST",
    headers: { "CF-Connecting-IP": randomIp() },
    body: JSON.stringify({ gameId: "tictactoe", name: winInOne.name, ...body }),
  });
}

/** Alice and Bob in a room, and the win-in-one position for them. */
async function seated(roomId: string) {
  const { client: alice, welcome: a } = await TestClient.join(roomId, secret("alice"), "Alice");
  const { welcome: b } = await TestClient.join(roomId, secret("bob"), "Bob");
  return { alice, state: winInOne.build([a.you.id, b.you.id], ctx) };
}

describe("practice rooms", () => {
  it("don't exist outside local development", async () => {
    const PROD = "https://gg.tgwizard.com";
    const headers = { "CF-Connecting-IP": randomIp() };
    const res = await exports.default.fetch(`${PROD}/api/rooms`, { method: "POST", headers, body: JSON.stringify({ practice: true }) });
    const { id } = (await res.json()) as { id: string };
    const info = (await (await exports.default.fetch(`${PROD}/api/rooms/${id}`)).json()) as { practice?: boolean };
    expect(info.practice).toBeUndefined();
    const load = await exports.default.fetch(`${PROD}/api/rooms/${id}/scenario`, { method: "POST", headers, body: "{}" });
    expect(load.status).toBe(404);
  });

  it("are marked as such, and only when asked for exactly", async () => {
    const info = async (id: string) => (await (await exports.default.fetch(`${BASE}/api/rooms/${id}`)).json()) as { practice?: boolean };
    expect((await info(await room(true))).practice).toBe(true);
    expect((await info(await room("yes"))).practice).toBeUndefined();
    expect((await info(await room())).practice).toBeUndefined();
  });

  it("take a scenario's game, which everyone gets as a new game", async () => {
    const id = await room(true);
    const { alice, state } = await seated(id);
    const game = alice.next("game", (m) => m.game?.gameId === "tictactoe");
    const chat = alice.next("chat", (m) => m.messages.some((x) => x.text === "Alice set up Tic-tac-toe: Win in one."));
    const res = await load(id, { secret: secret("alice"), state });
    expect(res.status).toBe(200);
    const snapshot = (await game).game!;
    expect(snapshot.version).toBe(1);
    expect((snapshot.view as TttView).board).toEqual([0, 0, null, 1, 1, null, null, null, null]);
    expect(snapshot.waitingOn).toHaveLength(1);
    await chat;

    // Set up again: a fresh game replaces it.
    const again = alice.next("game", (m) => m.game?.instanceId !== snapshot.instanceId);
    expect((await load(id, { secret: secret("alice"), state })).status).toBe(200);
    expect((await again).game?.version).toBe(1);
  });

  it("are the only rooms that take one", async () => {
    const id = await room();
    const { alice, state } = await seated(id);
    const res = await load(id, { secret: secret("alice"), state });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "not_practice" });
    expect(alice.latestGame()).toBeNull();
  });

  it("refuse strangers, other people's games and broken states", async () => {
    const id = await room(true);
    const { alice, state } = await seated(id);
    expect((await load(id, { secret: secret("mallory"), state })).status).toBe(403);
    const strangers = winInOne.build(["0011223344556677", "8899aabbccddeeff"], ctx);
    expect(await (await load(id, { secret: secret("alice"), state: strangers })).json()).toEqual({ error: "bad_state" });
    const broken = { ...(state as object), board: [0, 0, 0, 0, null, null, null, null, null] };
    expect((await load(id, { secret: secret("alice"), state: broken })).status).toBe(400);
    expect((await load(id, { secret: secret("alice"), gameId: "nope", state })).status).toBe(400);
    expect((await load(id, { secret: "short", state })).status).toBe(400);
    expect((await load("0000000000", { secret: secret("alice"), state })).status).toBe(404);
    expect(alice.latestGame()).toBeNull();
  });
});
