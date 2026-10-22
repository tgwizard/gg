/**
 * One Durable Object per room. It owns everything about the room: members, chat
 * history and the active game. Clients connect over hibernatable WebSockets.
 *
 * Resilience model:
 *   - All state lives in the DO's SQLite storage, so reconnecting (or refreshing)
 *     is just "hello" again: the server replies with a full snapshot plus any chat
 *     the client missed (by seq cursor).
 *   - Mutations carry a client id (cid) and are idempotent: results are stored, so
 *     resends after a dropped connection never apply twice.
 *   - Game views are sent whole on every change (turn-based games are small), so
 *     clients can never drift.
 *   - Heartbeats are answered by the runtime's auto-response, without waking the
 *     DO; an alarm sweeps sockets that stopped pinging.
 *
 * The same alarm expires rooms nobody has used in a while, and every connection
 * gets rate limits generous enough that people never notice them (see limits.ts).
 */
import { DurableObject } from "cloudflare:workers";
import { games } from "../games/registry";
import { type AnyGameDefinition, type GameContext, GameError } from "../games/types";
import {
  type AckError,
  type ChatKind,
  type ChatMessage,
  ClientMessage,
  CloseCode,
  type GameSnapshot,
  type Member,
  PING,
  PONG,
  PROTOCOL_VERSION,
  RATE_LIMITED,
  ROOM_FULL,
  type ServerMessage,
  sanitizeChat,
  sanitizeName,
} from "../shared/protocol";
import type { TokenBucket } from "../shared/token-bucket";
import {
  chatBucket,
  clientIp,
  FLOOD_RETRY_MS,
  HELLO_TIMEOUT_MS,
  ipChatBucket,
  ipOpsBucket,
  MAX_MEMBERS,
  MAX_SOCKETS_PER_IP,
  MAX_SOCKETS_PER_PLAYER,
  MAX_SOCKETS_PER_ROOM,
  MAX_VIOLATIONS,
  newMemberBucket,
  opsBucket,
  ROOM_IDLE_TTL_MS,
  ROOM_UNUSED_TTL_MS,
  rejectSocket,
} from "./limits";

interface Attachment {
  playerId: string | null;
  connectedAt: number;
  /** Limit key for the client's IP (an IPv6 /64). */
  ip: string;
}

interface RoomInfo {
  id: string;
  createdAt: number;
}

interface StoredGame {
  instanceId: string;
  gameId: string;
  version: number;
  startedAt: number;
  startedBy: string;
  state: unknown;
}

type AckResult = { ok: true } | { ok: false; error: AckError };

/**
 * How often a room with connected players wakes up to close dead sockets. Clients
 * notice their own dead connections within seconds; this only keeps other people's
 * presence dots honest, so it can be lazy (and each wake-up is billed).
 */
const SWEEP_INTERVAL_MS = 5 * 60_000;
/** Generous, since browsers throttle timers (and so pings) in background tabs. */
const STALE_SOCKET_MS = 120_000;
const CHAT_PAGE = 100;
const CHAT_CATCHUP_MAX = 300;
const CHAT_RETAIN = 1000;
const OP_RETAIN_MS = 60 * 60 * 1000;
/** Activity is persisted at most this often. */
const TOUCH_EVERY_MS = 60_000;

interface Buckets {
  chat: TokenBucket;
  ops: TokenBucket;
}

interface Limits extends Buckets {
  violations: number;
  lastViolationAt: number;
}

export class Room extends DurableObject<Env> {
  private sql: SqlStorage;
  /**
   * Whether this room's tables exist. Requests for room ids that were never created
   * must not create storage (that would be free, permanent junk for anyone to make).
   */
  private ready: boolean;
  private game: StoredGame | null;
  // In memory only: limits reset if the DO hibernates, which is fine.
  private limits = new WeakMap<WebSocket, Limits>();
  private ipLimits = new Map<string, Buckets>();
  private newMembers = new Map<string, TokenBucket>();
  private lastTouch = 0;
  /** Sweeps run on a fixed cadence from the last one, so busy rooms still get swept. */
  private lastSweepAt = Date.now();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.ready = this.sql.exec(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'kv'`).toArray().length > 0;
    this.game = this.getKv<StoredGame>("game");
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(PING, PONG));
  }

  // --- RPC (called by the worker) ------------------------------------------

  async create(id: string): Promise<RoomInfo> {
    const existing = this.getKv<RoomInfo>("room");
    if (existing) return existing;
    this.migrate();
    this.ready = true;
    const info = { id, createdAt: Date.now() };
    this.setKv("room", info);
    // Schedules expiry, so rooms nobody ever opens are cleaned up too.
    await this.scheduleAlarm();
    return info;
  }

  async info(): Promise<RoomInfo | null> {
    return this.getKv<RoomInfo>("room");
  }

  // --- WebSocket lifecycle -------------------------------------------------

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected a WebSocket upgrade", { status: 426 });
    }
    if (!this.getKv<RoomInfo>("room")) {
      return rejectSocket("room_not_found", "This room doesn't exist.", undefined, CloseCode.RoomNotFound);
    }
    const sockets = this.ctx.getWebSockets();
    if (sockets.filter((ws) => this.attachment(ws)?.playerId).length >= MAX_SOCKETS_PER_ROOM) {
      return rejectSocket(ROOM_FULL, "This room is full right now.", 30_000);
    }
    // Stops one client from hoarding connections that never join (which would fill the room).
    const ip = clientIp(request);
    if (sockets.filter((ws) => this.attachment(ws)?.ip === ip).length >= MAX_SOCKETS_PER_IP) {
      return rejectSocket(RATE_LIMITED, "Too many connections from your network to this room.", 30_000);
    }
    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ playerId: null, connectedAt: Date.now(), ip } satisfies Attachment);
    await this.scheduleAlarm();
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    if (typeof raw !== "string") return;
    let msg: ClientMessage;
    try {
      msg = ClientMessage.parse(JSON.parse(raw));
    } catch {
      if (!this.allow(ws, "ops")) return;
      return this.send(ws, { type: "error", code: "bad_message", message: "Malformed message." });
    }
    if (!this.allow(ws, msg.type === "chat" || msg.type === "setName" ? "chat" : "ops")) {
      return this.onLimited(ws, msg);
    }

    if (msg.type === "hello") return this.onHello(ws, msg);

    const playerId = this.attachment(ws)?.playerId;
    if (!playerId) return this.send(ws, { type: "error", code: "not_joined", message: "Say hello first." });
    this.touch();

    switch (msg.type) {
      case "setName":
        return this.onSetName(playerId, msg.name);
      case "chat":
        return this.ack(ws, msg.cid, this.onChat(playerId, msg.cid, msg.text));
      case "selectGame":
        return this.ack(ws, msg.cid, this.idempotent(playerId, msg.cid, () => this.onSelectGame(playerId, msg.gameId, msg.config)));
      case "endGame":
        return this.ack(ws, msg.cid, this.idempotent(playerId, msg.cid, () => this.onEndGame(playerId, msg.instanceId)));
      case "gameOp": {
        const result = this.idempotent(playerId, msg.cid, () => this.onGameOp(playerId, msg.instanceId, msg.op, msg.ifVersion));
        this.ack(ws, msg.cid, result);
        return this.scheduleAlarm();
      }
    }
  }

  async webSocketClose(ws: WebSocket) {
    this.onDisconnect(ws);
    await this.scheduleAlarm();
  }

  async webSocketError(ws: WebSocket) {
    this.onDisconnect(ws);
  }

  async alarm() {
    if (!this.ready) return;
    const now = Date.now();
    if (this.ctx.getWebSockets().length === 0) {
      const expiresAt = this.expiresAt();
      if (expiresAt !== null && expiresAt <= now) return this.expire();
    }
    if (this.game) {
      const def = this.definition();
      const announcements: string[] = [];
      let state = this.game.state;
      let changed = false;
      // Several deadlines can be due at once (e.g. after the DO was evicted for a while).
      for (let i = 0; i < 20; i++) {
        const due = def.nextDeadline?.(state);
        if (due == null || due > now || !def.onDeadline) break;
        const next = structuredClone(state);
        def.onDeadline(next, this.gameContext(announcements, now));
        state = next;
        changed = true;
      }
      if (changed) this.commitGame(state, announcements);
    }
    this.sweep(now);
    await this.scheduleAlarm();
  }

  // --- handlers ------------------------------------------------------------

  private async onHello(ws: WebSocket, msg: Extract<ClientMessage, { type: "hello" }>) {
    if (msg.protocol !== PROTOCOL_VERSION) {
      this.send(ws, { type: "error", code: "outdated", message: "A new version is available. Please reload." });
      ws.close(CloseCode.Outdated, "outdated");
      return;
    }
    const att = this.attachment(ws);
    // One identity per connection: re-hello with new secrets would mint members for free.
    if (!att || att.playerId) return this.send(ws, { type: "error", code: "already_joined", message: "Already joined." });
    const joined = this.ctx.getWebSockets().filter((s) => s !== ws && this.attachment(s)?.playerId).length;
    if (joined >= MAX_SOCKETS_PER_ROOM) return this.refuse(ws, ROOM_FULL, "This room is full right now.", 30_000);

    const playerId = await playerIdFromSecret(msg.secret);
    const name = sanitizeName(msg.name);
    const now = Date.now();
    const existing = this.getMember(playerId);
    if (!existing) {
      if (!this.bucket(this.newMembers, att.ip, newMemberBucket).take(now)) {
        return this.refuse(ws, RATE_LIMITED, "Too many new players from your network just now.", 60_000);
      }
      this.makeRoomForMember();
    }
    const wasOnline = this.isOnline(playerId);

    this.sql.exec(
      `INSERT INTO members (id, name, kind, joined_at, last_seen_at) VALUES (?, ?, 'human', ?, ?)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, last_seen_at = excluded.last_seen_at`,
      playerId,
      name,
      now,
      now,
    );
    ws.serializeAttachment({ ...att, playerId } satisfies Attachment);
    this.closeOldSockets(playerId, ws);
    this.touch();

    let joinMessage: ChatMessage | null = null;
    if (!existing) joinMessage = this.insertChat("system", null, null, `${name} joined the room.`);

    const { messages, reset } = this.chatSince(msg.chatCursor);
    this.send(ws, {
      type: "welcome",
      roomId: this.getKv<RoomInfo>("room")?.id ?? "",
      you: this.getMember(playerId)!,
      members: this.getMembers(),
      chat: messages,
      chatReset: reset,
      game: this.game ? this.snapshotFor(playerId) : null,
      serverTime: now,
    });

    if (joinMessage) this.broadcast({ type: "chat", messages: [joinMessage] }, ws);
    if (!wasOnline || existing?.name !== name) this.broadcast({ type: "members", members: this.getMembers() }, ws);
    // The hello-timeout check for this socket is no longer needed.
    await this.scheduleAlarm();
  }

  private onSetName(playerId: string, raw: string) {
    const name = sanitizeName(raw);
    const before = this.getMember(playerId);
    if (!before || before.name === name) return;
    this.sql.exec(`UPDATE members SET name = ? WHERE id = ?`, name, playerId);
    const msg = this.insertChat("system", null, null, `${before.name} is now known as ${name}.`);
    this.broadcast({ type: "chat", messages: [msg] });
    this.broadcast({ type: "members", members: this.getMembers() });
  }

  private onChat(playerId: string, cid: string, raw: string): AckResult {
    const text = sanitizeChat(raw);
    if (!text) return fail("empty", "Message is empty.");
    const dup = this.sql.exec(`SELECT seq FROM chat WHERE player_id = ? AND cid = ?`, playerId, cid).toArray();
    if (dup.length) return { ok: true };
    const name = this.getMember(playerId)?.name ?? null;
    const msg = this.insertChat("user", playerId, name, text, cid);
    this.broadcast({ type: "chat", messages: [msg] });
    return { ok: true };
  }

  private onSelectGame(playerId: string, gameId: string, rawConfig: unknown): AckResult {
    if (this.game) return fail("game_in_progress", "End the current game first.");
    const def = games[gameId];
    if (!def) return fail("unknown_game", "No such game.");
    const parsed = def.configSchema.safeParse(rawConfig ?? {});
    if (!parsed.success) return fail("bad_config", parsed.error.issues[0]?.message ?? "Invalid settings.");

    const now = Date.now();
    const announcements: string[] = [];
    let state: unknown;
    try {
      state = def.create(parsed.data, this.gameContext(announcements, now));
    } catch (e) {
      return gameFailure(e);
    }
    this.game = { instanceId: crypto.randomUUID(), gameId, version: 0, startedAt: now, startedBy: playerId, state };
    this.commitGame(state, [`${this.nameOf(playerId)} started ${def.meta.name}.`, ...announcements]);
    return { ok: true };
  }

  private onEndGame(playerId: string, instanceId: string): AckResult {
    if (!this.game || this.game.instanceId !== instanceId) return fail("no_such_game", "That game is no longer running.");
    const name = this.definition().meta.name;
    this.game = null;
    this.sql.exec(`DELETE FROM kv WHERE key = 'game'`);
    const msg = this.insertChat("system", null, null, `${this.nameOf(playerId)} ended ${name}.`);
    this.broadcast({ type: "chat", messages: [msg] });
    this.broadcastGame();
    return { ok: true };
  }

  private onGameOp(playerId: string, instanceId: string, rawOp: unknown, ifVersion: number | undefined): AckResult {
    if (!this.game || this.game.instanceId !== instanceId) return fail("no_such_game", "That game is no longer running.");
    if (ifVersion !== undefined && ifVersion !== this.game.version)
      return fail("stale", "The game moved on while you were disconnected. Please try again.");
    const def = this.definition();
    const parsed = def.opSchema.safeParse(rawOp);
    if (!parsed.success) return fail("bad_op", "Invalid move.");

    const announcements: string[] = [];
    const next = structuredClone(this.game.state);
    try {
      def.apply(next, playerId, parsed.data, this.gameContext(announcements, Date.now()));
    } catch (e) {
      return gameFailure(e);
    }
    this.commitGame(next, announcements);
    return { ok: true };
  }

  private onDisconnect(ws: WebSocket) {
    const playerId = this.attachment(ws)?.playerId;
    if (!playerId || this.isOnline(playerId, ws)) return;
    this.sql.exec(`UPDATE members SET last_seen_at = ? WHERE id = ?`, Date.now(), playerId);
    this.broadcast({ type: "members", members: this.getMembers() }, ws);
  }

  // --- game plumbing -------------------------------------------------------

  private definition(): AnyGameDefinition {
    const def = this.game && games[this.game.gameId];
    if (!def) throw new Error(`unknown game ${this.game?.gameId}`);
    return def;
  }

  private gameContext(announcements: string[], now: number): GameContext {
    return {
      now,
      randomInt: secureRandomInt,
      nameOf: (id) => this.nameOf(id),
      announce: (text) => announcements.push(text),
    };
  }

  /** Persist a new game state, then fan out views and announcements. */
  private commitGame(state: unknown, announcements: string[]) {
    const game = this.game!;
    this.game = { ...game, state, version: game.version + 1 };
    this.setKv("game", this.game);
    if (announcements.length) {
      const messages = announcements.map((t) => this.insertChat("game", null, null, t));
      this.broadcast({ type: "chat", messages });
    }
    this.broadcastGame();
  }

  private snapshotFor(playerId: string): GameSnapshot {
    const game = this.game!;
    const def = this.definition();
    return {
      instanceId: game.instanceId,
      gameId: game.gameId,
      version: game.version,
      startedAt: game.startedAt,
      startedBy: game.startedBy,
      view: def.view(game.state, playerId),
      waitingOn: def.waitingOn(game.state),
    };
  }

  /** Each player gets their own redacted view. */
  private broadcastGame() {
    const payloads = new Map<string, string>();
    for (const ws of this.ctx.getWebSockets()) {
      const playerId = this.attachment(ws)?.playerId;
      if (!playerId) continue;
      let payload = payloads.get(playerId);
      if (!payload) {
        const msg: ServerMessage = { type: "game", game: this.game ? this.snapshotFor(playerId) : null };
        payload = JSON.stringify(msg);
        payloads.set(playerId, payload);
      }
      this.sendRaw(ws, payload);
    }
  }

  private async scheduleAlarm() {
    const now = Date.now();
    let next = Infinity;
    if (this.game) {
      const due = this.definition().nextDeadline?.(this.game.state);
      if (due != null) next = Math.min(next, due);
    }
    const sockets = this.ctx.getWebSockets();
    for (const ws of sockets) {
      const att = this.attachment(ws);
      // Connections that haven't joined get closed promptly; joined ones are swept lazily.
      next = Math.min(next, att?.playerId ? this.lastSweepAt + SWEEP_INTERVAL_MS : (att?.connectedAt ?? now) + HELLO_TIMEOUT_MS);
    }
    if (sockets.length === 0) next = Math.min(next, this.expiresAt() ?? Infinity);
    const current = await this.ctx.storage.getAlarm();
    if (next === Infinity) {
      if (current !== null) await this.ctx.storage.deleteAlarm();
      return;
    }
    next = Math.max(next, now);
    if (current === null || Math.abs(current - next) > 1000) await this.ctx.storage.setAlarm(next);
  }

  /**
   * Close sockets that stopped heartbeating (e.g. a laptop lid closed mid-game), and
   * ones that never said hello (pings alone don't count: they'd let anyone squat).
   */
  private sweep(now: number) {
    this.lastSweepAt = now;
    for (const ws of this.ctx.getWebSockets()) {
      const att = this.attachment(ws);
      const connectedAt = att?.connectedAt ?? 0;
      let reason: string | null = null;
      if (!att?.playerId) {
        if (now - connectedAt >= HELLO_TIMEOUT_MS) reason = "hello timeout";
      } else {
        const lastPing = this.ctx.getWebSocketAutoResponseTimestamp(ws)?.getTime() ?? 0;
        if (now - Math.max(lastPing, connectedAt) > STALE_SOCKET_MS) reason = "stale";
      }
      if (!reason) continue;
      try {
        ws.close(1001, reason);
      } catch {
        // already closed
      }
      this.onDisconnect(ws);
    }
  }

  // --- limits & expiry -----------------------------------------------------

  /**
   * Take a token from this socket's bucket and its IP's (so opening more connections
   * doesn't buy more throughput); disconnect sockets that keep flooding.
   */
  private allow(ws: WebSocket, kind: "chat" | "ops"): boolean {
    const now = Date.now();
    let limits = this.limits.get(ws);
    if (!limits) {
      limits = { chat: chatBucket(), ops: opsBucket(), violations: 0, lastViolationAt: now };
      this.limits.set(ws, limits);
    }
    const ip = this.attachment(ws)?.ip ?? "unknown";
    if (this.ipLimits.size > 10_000) this.ipLimits.clear();
    const perIp = this.ipLimits.get(ip) ?? { chat: ipChatBucket(), ops: ipOpsBucket() };
    this.ipLimits.set(ip, perIp);
    if (limits[kind].take(now) && perIp[kind].take(now)) return true;

    // Violations are forgiven at one per second, so only sustained flooding disconnects.
    limits.violations = Math.max(0, limits.violations - (now - limits.lastViolationAt) / 1000) + 1;
    limits.lastViolationAt = now;
    if (limits.violations > MAX_VIOLATIONS) {
      this.refuse(ws, RATE_LIMITED, "Too many messages. Reconnecting in a moment.", FLOOD_RETRY_MS);
    }
    return false;
  }

  /** Tell a client why, then close it; it will come back after `retryAfterMs`. */
  private refuse(ws: WebSocket, code: string, message: string, retryAfterMs: number) {
    this.send(ws, { type: "error", code, message, retryAfterMs });
    try {
      ws.close(CloseCode.RateLimited, code);
    } catch {
      // already closing
    }
    this.onDisconnect(ws);
  }

  private bucket(map: Map<string, TokenBucket>, key: string, make: () => TokenBucket): TokenBucket {
    if (map.size > 10_000) map.clear();
    let b = map.get(key);
    if (!b) map.set(key, (b = make()));
    return b;
  }

  /** Keep the member list bounded: forget the offline members who've been gone longest. */
  private makeRoomForMember() {
    const count = this.sql.exec<{ n: number }>(`SELECT COUNT(*) AS n FROM members`).one().n;
    if (count < MAX_MEMBERS) return;
    const online = this.onlineIds();
    const gone = this.sql
      .exec<{ id: string }>(`SELECT id FROM members ORDER BY last_seen_at`)
      .toArray()
      .filter((r) => !online.has(r.id))
      .slice(0, count - MAX_MEMBERS + 1);
    for (const r of gone) this.sql.exec(`DELETE FROM members WHERE id = ?`, r.id);
  }

  private onLimited(ws: WebSocket, msg: ClientMessage) {
    if (ws.readyState !== WebSocket.READY_STATE_OPEN) return;
    const message = "You're going a bit fast. Wait a moment and try again.";
    if ("cid" in msg) this.ack(ws, msg.cid, fail(RATE_LIMITED, message));
    else this.send(ws, { type: "error", code: RATE_LIMITED, message });
  }

  /** A player refreshing on a bad connection can leave dead sockets behind; the newest ones win. */
  private closeOldSockets(playerId: string, current: WebSocket) {
    const others = this.ctx
      .getWebSockets()
      .filter((ws) => ws !== current && this.attachment(ws)?.playerId === playerId)
      .sort((a, b) => (this.attachment(b)?.connectedAt ?? 0) - (this.attachment(a)?.connectedAt ?? 0));
    for (const ws of others.slice(MAX_SOCKETS_PER_PLAYER - 1)) {
      try {
        ws.close(CloseCode.Replaced, "replaced by a newer connection");
      } catch {
        // already closing
      }
    }
  }

  private touch() {
    const now = Date.now();
    if (now - this.lastTouch < TOUCH_EVERY_MS) return;
    this.lastTouch = now;
    this.setKv("activity", now);
  }

  private expiresAt(): number | null {
    const room = this.getKv<RoomInfo>("room");
    if (!room) return null;
    const everJoined = this.sql.exec<{ n: number }>(`SELECT COUNT(*) AS n FROM members`).one().n > 0;
    if (!everJoined) return room.createdAt + ROOM_UNUSED_TTL_MS;
    return (this.getKv<number>("activity") ?? room.createdAt) + ROOM_IDLE_TTL_MS;
  }

  /** Forget everything: the link now leads to "Room not found". */
  private async expire() {
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
    this.ready = false;
    this.game = null;
    this.lastTouch = 0;
  }

  // --- members & chat ------------------------------------------------------

  private getMember(id: string): Member | null {
    const row = this.sql.exec<MemberRow>(`SELECT * FROM members WHERE id = ?`, id).toArray()[0];
    return row ? this.toMember(row) : null;
  }

  private getMembers(): Member[] {
    const online = this.onlineIds();
    return this.sql
      .exec<MemberRow>(`SELECT * FROM members ORDER BY joined_at`)
      .toArray()
      .map((r) => this.toMember(r, online));
  }

  private toMember(row: MemberRow, online = this.onlineIds()): Member {
    return {
      id: row.id,
      name: row.name,
      kind: row.kind as Member["kind"],
      online: online.has(row.id),
      joinedAt: row.joined_at,
      lastSeenAt: row.last_seen_at,
    };
  }

  private nameOf(id: string): string {
    return this.getMember(id)?.name ?? "Someone";
  }

  /** One pass over the sockets, rather than one per member. */
  private onlineIds(): Set<string> {
    const ids = new Set<string>();
    for (const ws of this.ctx.getWebSockets()) {
      const id = ws.readyState === WebSocket.READY_STATE_OPEN ? this.attachment(ws)?.playerId : null;
      if (id) ids.add(id);
    }
    return ids;
  }

  private isOnline(playerId: string, except?: WebSocket): boolean {
    return this.ctx
      .getWebSockets()
      .some((ws) => ws !== except && ws.readyState === WebSocket.READY_STATE_OPEN && this.attachment(ws)?.playerId === playerId);
  }

  private insertChat(kind: ChatKind, playerId: string | null, name: string | null, text: string, cid: string | null = null): ChatMessage {
    const ts = Date.now();
    const row = this.sql
      .exec<{ seq: number }>(
        `INSERT INTO chat (ts, kind, player_id, name, text, cid) VALUES (?, ?, ?, ?, ?, ?) RETURNING seq`,
        ts,
        kind,
        playerId,
        name,
        text,
        cid,
      )
      .one();
    if (row.seq % 100 === 0) this.sql.exec(`DELETE FROM chat WHERE seq <= ?`, row.seq - CHAT_RETAIN);
    return { seq: row.seq, ts, kind, playerId, name, text, cid };
  }

  /** Messages after `cursor`, or the latest page if the client is new or too far behind. */
  private chatSince(cursor: number | null): { messages: ChatMessage[]; reset: boolean } {
    if (cursor !== null) {
      const rows = this.sql
        .exec<ChatRow>(`SELECT * FROM chat WHERE seq > ? ORDER BY seq LIMIT ?`, cursor, CHAT_CATCHUP_MAX + 1)
        .toArray();
      const maxSeq = this.sql.exec<{ m: number | null }>(`SELECT MAX(seq) AS m FROM chat`).one().m ?? 0;
      if (rows.length <= CHAT_CATCHUP_MAX && cursor <= maxSeq) return { messages: rows.map(toChat), reset: false };
    }
    const rows = this.sql.exec<ChatRow>(`SELECT * FROM chat ORDER BY seq DESC LIMIT ?`, CHAT_PAGE).toArray();
    return { messages: rows.reverse().map(toChat), reset: true };
  }

  // --- infra ---------------------------------------------------------------

  /** Run a mutation at most once per (player, cid); a replayed success returns the stored result. */
  private idempotent(playerId: string, cid: string, fn: () => AckResult): AckResult {
    const prior = this.sql
      .exec<{ result: string }>(`SELECT result FROM ops WHERE player_id = ? AND cid = ?`, playerId, cid)
      .toArray()[0];
    if (prior) return JSON.parse(prior.result) as AckResult;
    const result = fn();
    // Only successes need remembering: a refused op changed nothing, so re-running it is
    // harmless, and not writing on refusal stops spam from turning into storage writes.
    if (result.ok) {
      const now = Date.now();
      this.sql.exec(`INSERT INTO ops (player_id, cid, ts, result) VALUES (?, ?, ?, ?)`, playerId, cid, now, JSON.stringify(result));
      if (Math.random() < 0.05) this.sql.exec(`DELETE FROM ops WHERE ts < ?`, now - OP_RETAIN_MS);
    }
    return result;
  }

  private ack(ws: WebSocket, cid: string, result: AckResult) {
    this.send(ws, result.ok ? { type: "ack", cid, ok: true } : { type: "ack", cid, ok: false, error: result.error });
  }

  private attachment(ws: WebSocket): Attachment | null {
    return (ws.deserializeAttachment() as Attachment | null) ?? null;
  }

  private send(ws: WebSocket, msg: ServerMessage) {
    this.sendRaw(ws, JSON.stringify(msg));
  }

  private sendRaw(ws: WebSocket, payload: string) {
    try {
      ws.send(payload);
    } catch {
      // Socket is closing; the client will catch up on reconnect.
    }
  }

  private broadcast(msg: ServerMessage, except?: WebSocket) {
    const payload = JSON.stringify(msg);
    for (const ws of this.ctx.getWebSockets()) {
      if (ws !== except && this.attachment(ws)?.playerId) this.sendRaw(ws, payload);
    }
  }

  private getKv<T>(key: string): T | null {
    if (!this.ready) return null;
    const row = this.sql.exec<{ value: string }>(`SELECT value FROM kv WHERE key = ?`, key).toArray()[0];
    return row ? (JSON.parse(row.value) as T) : null;
  }

  private setKv(key: string, value: unknown) {
    this.sql.exec(`INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)`, key, JSON.stringify(value));
  }

  private migrate() {
    this.sql.exec(`CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS members (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      kind TEXT NOT NULL,
      joined_at INTEGER NOT NULL,
      last_seen_at INTEGER NOT NULL
    )`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS chat (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      ts INTEGER NOT NULL,
      kind TEXT NOT NULL,
      player_id TEXT,
      name TEXT,
      text TEXT NOT NULL,
      cid TEXT
    )`);
    this.sql.exec(`CREATE INDEX IF NOT EXISTS chat_cid ON chat (player_id, cid)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS ops (
      player_id TEXT NOT NULL,
      cid TEXT NOT NULL,
      ts INTEGER NOT NULL,
      result TEXT NOT NULL,
      PRIMARY KEY (player_id, cid)
    )`);
    this.sql.exec(`CREATE INDEX IF NOT EXISTS ops_ts ON ops (ts)`);
  }
}

type MemberRow = { id: string; name: string; kind: string; joined_at: number; last_seen_at: number };
type ChatRow = { seq: number; ts: number; kind: string; player_id: string | null; name: string | null; text: string; cid: string | null };

function toChat(r: ChatRow): ChatMessage {
  return { seq: r.seq, ts: r.ts, kind: r.kind as ChatKind, playerId: r.player_id, name: r.name, text: r.text, cid: r.cid };
}

function fail(code: string, message: string): AckResult {
  return { ok: false, error: { code, message } };
}

function gameFailure(e: unknown): AckResult {
  if (e instanceof GameError) return fail(e.code, e.message);
  console.error("game error", e);
  return fail("internal", "Something went wrong.");
}

/** Public id = truncated SHA-256 of the browser's secret, so ids can't be spoofed. */
export async function playerIdFromSecret(secret: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return [...new Uint8Array(digest).slice(0, 8)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function secureRandomInt(maxExclusive: number): number {
  if (maxExclusive <= 1) return 0;
  const limit = Math.floor(0x1_0000_0000 / maxExclusive) * maxExclusive;
  const buf = new Uint32Array(1);
  for (;;) {
    crypto.getRandomValues(buf);
    if (buf[0]! < limit) return buf[0]! % maxExclusive;
  }
}
