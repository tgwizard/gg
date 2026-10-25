/**
 * Wire protocol between browser clients and the Room durable object.
 *
 * Everything the client sends is validated with zod on the server; everything the
 * server sends is plain typed JSON. Bump PROTOCOL_VERSION on breaking changes so
 * stale tabs are told to reload instead of misbehaving.
 */
import { z } from "zod";
import { COLOR_COUNT } from "./colors";

export const PROTOCOL_VERSION = 3;

export const MAX_NAME_LENGTH = 24;
export const MAX_ROOM_NAME_LENGTH = 40;
export const MAX_CHAT_LENGTH = 500;
/** Bots and players on their device (hot seat) one person can bring into a room. */
export const MAX_OWNED_PER_PLAYER = 4;

/** Heartbeat literals, answered by the DO's auto-response without waking it up. */
export const PING = "ping";
export const PONG = "pong";

/** WebSocket close codes with special meaning to the client. */
export const CloseCode = {
  RoomNotFound: 4404,
  Outdated: 4426,
  /** Too many connections or messages; reconnect after the error's retryAfterMs. */
  RateLimited: 4429,
  /**
   * This player opened the room in too many tabs and this one is the oldest. Not
   * retried automatically: two tabs taking turns kicking each other out would loop.
   */
  Replaced: 4409,
  /** A bot was removed from the room; it must not come back. */
  Left: 4410,
} as const;

/** Error codes for limits; the message is meant to be shown to the user as-is. */
export const RATE_LIMITED = "rate_limited";
export const ROOM_FULL = "room_full";

/** A person; a bot; or a guest: a person playing on someone else's device (hot seat). */
export type MemberKind = "human" | "bot" | "guest";

/** What a bot says about itself, for everyone to see. */
export const BotInfo = z.object({
  level: z.enum(["easy", "ai"]),
  /** For AI bots: the model, e.g. "muse-spark-1.3-contributor", and its provider. */
  model: z.string().max(80).optional(),
  provider: z.string().max(40).optional(),
  effort: z.enum(["low", "medium", "high"]).optional(),
  /** How it talks and plays, as its owner put it. */
  persona: z.string().max(300).optional(),
});
export type BotInfo = z.infer<typeof BotInfo>;

export interface Member {
  id: string;
  name: string;
  kind: MemberKind;
  /** For bots and guests: the person whose browser runs it. */
  ownerId: string | null;
  /** For bots: how it plays. */
  bot?: BotInfo;
  /** Index into PLAYER_COLORS: their preference, unless someone who joined earlier has it. */
  color: number;
  online: boolean;
  /** What they're up to right now, e.g. a bot "Thinking about its move". Not stored. */
  activity?: string;
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
  /** Player ids taking part (e.g. seated). */
  players: string[];
  /** Player ids the game is currently waiting on. */
  waitingOn: string[];
  /** When the game's next timer runs out (server time), e.g. the current turn's clock; null if none. */
  deadline: number | null;
  /** Only sent to bots: the ops they can make right now (the game's `legalOps`). */
  legalOps?: unknown[];
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
    /**
     * Preferred color (index into PLAYER_COLORS). Optional so that old clients still
     * get as far as the version check and are told to reload.
     */
    color: z.number().int().min(0).max(COLOR_COUNT - 1).optional(),
    /** Highest chat seq the client has; null on first load. */
    chatCursor: z.number().int().nullable(),
    /** Set when a bot or guest connects: its owner's secret (it has its own). */
    owner: z.string().min(16).max(128).optional(),
    /** With `owner`: a person playing on the owner's device (hot seat), not a bot. */
    guest: z.literal(true).optional(),
    bot: BotInfo.optional(),
  }),
  z.object({
    type: z.literal("setProfile"),
    name: z.string().max(200),
    color: z.number().int().min(0).max(COLOR_COUNT - 1),
    /** Bots: how it plays now. */
    bot: BotInfo.optional(),
  }),
  z.object({ type: z.literal("renameRoom"), cid, name: z.string().max(200) }),
  /** What you're up to right now (null when done); shown to everyone. */
  z.object({ type: z.literal("activity"), text: z.string().max(200).nullable() }),
  /** A bot or guest leaving for good (its owner removed it). */
  z.object({ type: z.literal("leaveRoom"), cid }),
  z.object({ type: z.literal("chat"), cid, text: z.string().max(4 * MAX_CHAT_LENGTH) }),
  z.object({ type: z.literal("selectGame"), cid, gameId: z.string().max(64), config: z.unknown() }),
  z.object({ type: z.literal("endGame"), cid, instanceId: z.string().max(64) }),
  z.object({
    type: z.literal("gameOp"),
    cid,
    instanceId: z.string().max(64),
    op: z.unknown(),
    /**
     * The game version the player was looking at. The op is rejected as stale unless
     * the game is still at this version, so a click is never applied to a situation
     * the player hasn't seen (e.g. one made just before a reconnect). Browsers always
     * send it; server-side actors (future bots) may omit it.
     */
    ifVersion: z.number().int().optional(),
  }),
]);
export type ClientMessage = z.infer<typeof ClientMessage>;

/**
 * `POST /api/rooms/:code/scenario`: replace a practice room's game with a set-up
 * position (a scenario from /try). Only practice rooms accept it, and only from a
 * person in the room.
 */
export const LoadScenario = z.object({
  secret: z.string().min(16).max(128),
  gameId: z.string().max(64),
  /** The scenario's name, for the chat. */
  name: z.string().max(80),
  /** The whole game state, built by the scenario in the browser. */
  state: z.unknown(),
});
export type LoadScenario = z.infer<typeof LoadScenario>;

export type ServerMessage =
  | {
      type: "welcome";
      roomId: string;
      roomName: string | null;
      you: Member;
      members: Member[];
      chat: ChatMessage[];
      /** True if `chat` replaces the client's history rather than extending it. */
      chatReset: boolean;
      game: GameSnapshot | null;
      serverTime: number;
    }
  | { type: "members"; members: Member[] }
  | { type: "room"; name: string | null }
  | { type: "chat"; messages: ChatMessage[] }
  | { type: "game"; game: GameSnapshot | null }
  | { type: "ack"; cid: string; ok: true }
  | { type: "ack"; cid: string; ok: false; error: AckError }
  | { type: "error"; code: string; message: string; retryAfterMs?: number };

/**
 * Control characters, zero-width characters and bidi overrides: invisible, and
 * useful for impersonating someone or reversing text in chat.
 */
const INVISIBLE = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u00ad\u061c\u180e\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff\ufff9-\ufffb]/g;

export function sanitizeName(raw: string): string {
  const name = raw.normalize("NFC").replace(INVISIBLE, "").replace(/\s+/g, " ").trim().slice(0, MAX_NAME_LENGTH);
  return name || "Anonymous";
}

/** A room's display name; empty means unnamed. */
export function sanitizeRoomName(raw: string): string | null {
  return raw.normalize("NFC").replace(INVISIBLE, "").replace(/\s+/g, " ").trim().slice(0, MAX_ROOM_NAME_LENGTH) || null;
}

export const MAX_ACTIVITY_LENGTH = 40;

export function sanitizeActivity(raw: string): string {
  return raw.normalize("NFC").replace(INVISIBLE, "").replace(/\s+/g, " ").trim().slice(0, MAX_ACTIVITY_LENGTH);
}

export function sanitizeChat(raw: string): string {
  return raw.normalize("NFC").replace(INVISIBLE, "").trim().slice(0, MAX_CHAT_LENGTH);
}
