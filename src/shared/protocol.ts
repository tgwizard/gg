/**
 * Wire protocol between browser clients and the Room durable object.
 *
 * Everything the client sends is validated with zod on the server; everything the
 * server sends is plain typed JSON. Bump PROTOCOL_VERSION on breaking changes so
 * stale tabs are told to reload instead of misbehaving.
 */
import { z } from "zod";

export const PROTOCOL_VERSION = 1;

export const MAX_NAME_LENGTH = 24;
export const MAX_CHAT_LENGTH = 500;

/** Heartbeat literals, answered by the DO's auto-response without waking it up. */
export const PING = "ping";
export const PONG = "pong";

/** WebSocket close codes with special meaning to the client (no auto-reconnect). */
export const CloseCode = {
  RoomNotFound: 4404,
  Outdated: 4426,
} as const;

export type MemberKind = "human" | "bot";

export interface Member {
  id: string;
  name: string;
  kind: MemberKind;
  online: boolean;
  joinedAt: number;
  lastSeenAt: number;
}

export type ChatKind = "user" | "system" | "game";

export interface ChatMessage {
  /** Monotonic per-room sequence number; clients use it as a catch-up cursor. */
  seq: number;
  ts: number;
  kind: ChatKind;
  playerId: string | null;
  /** Sender's name at the time the message was sent. */
  name: string | null;
  text: string;
  /** Client-generated id, used to dedupe resends and reconcile optimistic messages. */
  cid: string | null;
}

export interface GameSnapshot<V = unknown> {
  instanceId: string;
  gameId: string;
  /** Bumped on every state change. */
  version: number;
  startedAt: number;
  startedBy: string;
  /** The game state as seen by the receiving player (secrets redacted server-side). */
  view: V;
  /** Player ids the game is currently waiting on. */
  waitingOn: string[];
}

export interface AckError {
  code: string;
  message: string;
}

const cid = z.string().min(1).max(64);

export const ClientMessage = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("hello"),
    protocol: z.number(),
    /** Per-browser secret; the server derives the public player id from it. */
    secret: z.string().min(16).max(128),
    name: z.string().max(200),
    /** Highest chat seq the client has; null on first load. */
    chatCursor: z.number().int().nullable(),
  }),
  z.object({ type: z.literal("setName"), name: z.string().max(200) }),
  z.object({ type: z.literal("chat"), cid, text: z.string().max(4 * MAX_CHAT_LENGTH) }),
  z.object({ type: z.literal("selectGame"), cid, gameId: z.string().max(64), config: z.unknown() }),
  z.object({ type: z.literal("endGame"), cid, instanceId: z.string().max(64) }),
  z.object({
    type: z.literal("gameOp"),
    cid,
    instanceId: z.string().max(64),
    op: z.unknown(),
    /**
     * Only set when resending after a reconnect: the op is rejected as stale unless
     * the game is still at this version, so an old click is never applied to a
     * situation the player hasn't seen.
     */
    ifVersion: z.number().int().optional(),
  }),
]);
export type ClientMessage = z.infer<typeof ClientMessage>;

export type ServerMessage =
  | {
      type: "welcome";
      roomId: string;
      you: Member;
      members: Member[];
      chat: ChatMessage[];
      /** True if `chat` replaces the client's history rather than extending it. */
      chatReset: boolean;
      game: GameSnapshot | null;
      serverTime: number;
    }
  | { type: "members"; members: Member[] }
  | { type: "chat"; messages: ChatMessage[] }
  | { type: "game"; game: GameSnapshot | null }
  | { type: "ack"; cid: string; ok: true }
  | { type: "ack"; cid: string; ok: false; error: AckError }
  | { type: "error"; code: string; message: string };

export function sanitizeName(raw: string): string {
  const name = raw.replace(/\s+/g, " ").trim().slice(0, MAX_NAME_LENGTH);
  return name || "Anonymous";
}

export function sanitizeChat(raw: string): string {
  return raw.trim().slice(0, MAX_CHAT_LENGTH);
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
