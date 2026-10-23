/**
 * HTTP entry point. Static assets (the SPA) are served by Workers Assets; only
 * /api/* reaches this code.
 *
 *   POST /api/rooms {name?, practice?} -> { id, createdAt, name, practice? }   create a room (id is a room code)
 *   GET  /api/rooms/:code              -> { id, createdAt, name, practice? } | 404
 *   GET  /api/rooms/:code/ws           -> WebSocket into the room's Durable Object
 *   POST /api/rooms/:code/scenario     -> set up a practice room's game (see LoadScenario)
 *
 * Practice rooms (and so /scenario) only exist when served locally: on localhost or
 * a .test host. Production is only reachable as gg.tgwizard.com, so never there.
 *
 * Codes are matched case-insensitively (see shared/roomCode.ts).
 */
import { playerIdFromSecret } from "../shared/playerId";
import { LoadScenario, RATE_LIMITED } from "../shared/protocol";
import { generateRoomCode, normalizeRoomCode } from "../shared/roomCode";
import { clientIp, MAX_BODY_BYTES, MAX_SCENARIO_BYTES, rejectSocket } from "./limits";

export { Room } from "./room";

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === "/api/rooms" && request.method === "POST") {
      const { success } = await env.CREATE_ROOM_LIMITER.limit({ key: clientIp(request) });
      if (!success) {
        return Response.json(
          {
            error: RATE_LIMITED,
            message: "You've made a lot of rooms in the last minute. Try again in a minute.",
            retryAfterMs: 60_000,
          },
          { status: 429, headers: { "Retry-After": "60" } },
        );
      }
      const options = await createOptions(request);
      const name = options.name;
      const practice = options.practice && servedLocally(request);
      // A collision is astronomically unlikely, but cheap to rule out.
      for (let attempt = 0; attempt < 5; attempt++) {
        const id = generateRoomCode();
        const { created, info } = await roomStub(env, id).create(id, name, practice);
        if (created) return Response.json(info, { status: 201 });
      }
      return Response.json({ error: "try_again" }, { status: 503 });
    }

    const m = path.match(/^\/api\/rooms\/([^/]+)(\/ws|\/scenario)?$/);
    if (m) {
      const id = normalizeRoomCode(decodeURIComponent(m[1]!));
      if (!id) return Response.json({ error: "not_found" }, { status: 404 });
      const stub = roomStub(env, id);
      if (m[2] === "/scenario") {
        if (!servedLocally(request)) return Response.json({ error: "not_found" }, { status: 404 });
        if (request.method !== "POST") return new Response(null, { status: 405 });
        if (!(await env.CONNECT_LIMITER.limit({ key: clientIp(request) })).success) {
          return Response.json({ error: RATE_LIMITED }, { status: 429, headers: { "Retry-After": "60" } });
        }
        const text = await readText(request, MAX_SCENARIO_BYTES).catch(() => null);
        if (text === null) return Response.json({ error: "too_large" }, { status: 413 });
        let body: LoadScenario;
        try {
          body = LoadScenario.parse(JSON.parse(text));
        } catch {
          return Response.json({ error: "bad_request" }, { status: 400 });
        }
        const { status, error } = await stub.loadScenario(await playerIdFromSecret(body.secret), body.gameId, body.state, body.name);
        return Response.json(error ? { error } : { ok: true }, { status });
      }
      if (m[2]) {
        if (request.headers.get("Upgrade") !== "websocket") return new Response("Expected a WebSocket upgrade", { status: 426 });
        const { success } = await env.CONNECT_LIMITER.limit({ key: clientIp(request) });
        if (!success) return rejectSocket(RATE_LIMITED, "Too many connection attempts from your network.", 20_000);
        return stub.fetch(request);
      }
      if (request.method !== "GET") return new Response(null, { status: 405 });
      if (!(await env.CONNECT_LIMITER.limit({ key: clientIp(request) })).success) {
        return Response.json({ error: RATE_LIMITED }, { status: 429, headers: { "Retry-After": "60" } });
      }
      const info = await stub.info();
      return info ? Response.json(info) : Response.json({ error: "not_found" }, { status: 404 });
    }

    if (path.startsWith("/api/")) return Response.json({ error: "not_found" }, { status: 404 });
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;

/** Running locally (the dev server, tests), where practice rooms are allowed. */
function servedLocally(request: Request): boolean {
  const host = new URL(request.url).hostname;
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host.endsWith(".test");
}

/**
 * The optional `{ "name": "...", "practice": true }` body of a create request. Anything
 * odd means no name, and a normal room.
 */
async function createOptions(request: Request): Promise<{ name: string | null; practice: boolean }> {
  const text = await readText(request, MAX_BODY_BYTES).catch(() => null);
  try {
    const body = JSON.parse(text || "{}") as { name?: unknown; practice?: unknown } | null;
    return { name: typeof body?.name === "string" ? body.name : null, practice: body?.practice === true };
  } catch {
    return { name: null, practice: false };
  }
}

/** The body as text, or null if it's longer than `maxBytes` (it stops reading there). */
async function readText(request: Request, maxBytes: number): Promise<string | null> {
  if (Number(request.headers.get("Content-Length") ?? 0) > maxBytes) return null;
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const c of chunks) {
    bytes.set(c, offset);
    offset += c.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

function roomStub(env: Env, id: string) {
  return env.ROOMS.get(env.ROOMS.idFromName(id));
}
