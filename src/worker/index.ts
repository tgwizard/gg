/**
 * HTTP entry point. Static assets (the SPA) are served by Workers Assets; only
 * /api/* reaches this code.
 *
 *   POST /api/rooms            -> { id }       create a room
 *   GET  /api/rooms/:id        -> { id, createdAt } | 404
 *   GET  /api/rooms/:id/ws     -> WebSocket into the room's Durable Object
 */
import { UUID_RE } from "../shared/protocol";

export { Room } from "./room";

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === "/api/rooms" && request.method === "POST") {
      const id = crypto.randomUUID();
      const info = await roomStub(env, id).create(id);
      return Response.json(info, { status: 201 });
    }

    const m = path.match(/^\/api\/rooms\/([^/]+)(\/ws)?$/);
    if (m) {
      const id = m[1]!.toLowerCase();
      if (!UUID_RE.test(id)) return Response.json({ error: "not_found" }, { status: 404 });
      const stub = roomStub(env, id);
      if (m[2]) return stub.fetch(request);
      if (request.method !== "GET") return new Response(null, { status: 405 });
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
