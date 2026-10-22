/**
 * HTTP entry point. Static assets (the SPA) are served by Workers Assets; only
 * /api/* reaches this code.
 *
 *   POST /api/rooms            -> { id, createdAt }   create a room (id is a room code)
 *   GET  /api/rooms/:code      -> { id, createdAt } | 404
 *   GET  /api/rooms/:code/ws   -> WebSocket into the room's Durable Object
 *
 * Codes are matched case-insensitively (see shared/roomCode.ts).
 */
import { RATE_LIMITED } from "../shared/protocol";
import { generateRoomCode, normalizeRoomCode } from "../shared/roomCode";
import { clientIp, rejectSocket } from "./limits";

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
      // A collision is astronomically unlikely, but cheap to rule out.
      for (let attempt = 0; attempt < 5; attempt++) {
        const id = generateRoomCode();
        const { created, info } = await roomStub(env, id).create(id);
        if (created) return Response.json(info, { status: 201 });
      }
      return Response.json({ error: "try_again" }, { status: 503 });
    }

    const m = path.match(/^\/api\/rooms\/([^/]+)(\/ws)?$/);
    if (m) {
      const id = normalizeRoomCode(decodeURIComponent(m[1]!));
      if (!id) return Response.json({ error: "not_found" }, { status: 404 });
      const stub = roomStub(env, id);
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

function roomStub(env: Env, id: string) {
  return env.ROOMS.get(env.ROOMS.idFromName(id));
}
