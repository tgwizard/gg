/**
 * Abuse limits. All are sized so normal play never hits them (including a
 * frustrated Cmd+R loop on a bad connection, or a household sharing one IP);
 * they exist to stop scripts. See "Limits" in docs/ARCHITECTURE.md.
 */
import { CloseCode, MAX_OWNED_PER_PLAYER, ROOM_IDLE_TTL_MS, type ServerMessage } from "../shared/protocol";
import { ipKey } from "../shared/ip";
import { TokenBucket } from "../shared/token-bucket";

/** Per connection: chat and renames. A burst of 15 covers flushing chat queued while offline. */
export const chatBucket = () => new TokenBucket(15, 1);
/** Per connection: game moves and everything else. Far above human click speed. */
export const opsBucket = () => new TokenBucket(30, 5);
/** Per IP within a room, shared by all its connections (a household plays from one IP). */
export const ipChatBucket = () => new TokenBucket(40, 3);
export const ipOpsBucket = () => new TokenBucket(80, 12);
/** New identities (fresh browsers) per IP within a room: a few at once, then one a minute. */
export const newMemberBucket = () => new TokenBucket(6, 1 / 60);
/** New bots per owner: all of them at once, then one every half minute (removing and re-adding). */
export const newBotBucket = () => new TokenBucket(MAX_OWNED_PER_PLAYER, 1 / 30);
/**
 * Longest message a client may send, checked before parsing. The longest real one
 * (a chat message at its limit, all emoji) is well under this.
 */
export const MAX_MESSAGE_LENGTH = 16_384;
/** Request bodies (a new room's name) are read up to this many bytes. */
export const MAX_BODY_BYTES = 2_048;
/** A scenario's game state (a late Coast to Coast game is about 15 KB). */
export const MAX_SCENARIO_BYTES = 128 * 1024;
/** Refused messages after which a flooding socket is disconnected; forgiven at 1 per second. */
export const MAX_VIOLATIONS = 50;
export const FLOOD_RETRY_MS = 30_000;

/** Refreshing on a bad connection can leave dead sockets behind: keep the newest few per player. */
export const MAX_SOCKETS_PER_PLAYER = 6;
/** Joined connections per room. */
export const MAX_SOCKETS_PER_ROOM = 100;
/** All connections (joined or not) from one IP to one room. */
export const MAX_SOCKETS_PER_IP = 20;
/** A connection must say hello within this long, or it is closed. */
export const HELLO_TIMEOUT_MS = 10_000;
/** Members remembered per room; the longest-gone offline ones are forgotten first. */
export const MAX_MEMBERS = 200;

export { ROOM_IDLE_TTL_MS };
/** Rooms nobody ever joined go away sooner. */
export const ROOM_UNUSED_TTL_MS = 24 * 60 * 60 * 1000;

/** On Cloudflare this header is set by the edge and can't be spoofed by clients. */
export function clientIp(request: Request): string {
  return ipKey(request.headers.get("CF-Connecting-IP") ?? "unknown");
}

/**
 * Refuse a WebSocket in a way the browser can read. A plain HTTP error on the upgrade
 * just looks like a network error to the client; an accepted socket that sends an
 * error and closes with a known code lets it explain itself and back off properly.
 * The socket is not hibernatable and never touches room storage.
 */
export function rejectSocket(
  code: string,
  message: string,
  retryAfterMs: number | undefined,
  closeCode: number = CloseCode.RateLimited,
): Response {
  const { 0: client, 1: server } = new WebSocketPair();
  server.accept();
  const msg: ServerMessage = { type: "error", code, message, ...(retryAfterMs === undefined ? {} : { retryAfterMs }) };
  server.send(JSON.stringify(msg));
  server.close(closeCode, code);
  return new Response(null, { status: 101, webSocket: client });
}
