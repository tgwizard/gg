/**
 * Client side of the room connection: one WebSocket, kept alive forever.
 *
 *   - Reconnects with jittered exponential backoff; immediately when the browser
 *     comes back online or the tab comes back (shown, focused, restored). A connection
 *     that looks open after the tab was hidden is checked with a quick ping: a phone
 *     that was away often has a dead one that it still calls open. Those events come
 *     in bunches, so it acts on them once, and never cuts short an attempt that's
 *     just started.
 *   - Heartbeats detect half-dead connections (e.g. after a laptop sleeps) that
 *     the browser would otherwise consider open for minutes.
 *   - Every mutation goes through an outbox keyed by a client id (cid). After a
 *     reconnect, un-acked messages are resent; the server dedupes by cid. Game ops
 *     carry the game version they were made against (`ifVersion`), so a click
 *     never applies to a situation the player hasn't seen, first send or resend.
 *   - Chat typed while offline is queued and shown as pending. It's also kept in the
 *     tab's sessionStorage, so it still goes out after a refresh (with the same cid,
 *     so it's never posted twice); after an hour it's dropped, as the server's memory
 *     of what it already applied doesn't reach that far back. Chat goes out at a pace
 *     the server accepts (a queue after a reconnect is flushed a few at a time), and a
 *     message refused for coming too fast waits and goes again.
 *   - Server limits are explained, not hidden: a refused connection carries a
 *     message and a retry-after, which wins over the normal backoff.
 *
 * State is exposed as an immutable snapshot for React's useSyncExternalStore.
 */
import {
  type BotInfo,
  type ChatMessage,
  type ClientMessage,
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
} from "../../shared/protocol";
import { devLog } from "../devlog";
import { noteServerBuild } from "../update";

export type ConnectionStatus =
  | "connecting"
  | "connected"
  | "reconnecting"
  | "offline"
  | "not_found"
  | "outdated"
  /** Too many tabs of this room open; this one was closed in favour of a newer one. */
  | "replaced"
  /** A bot that was removed from the room. */
  | "left";

export interface PendingChat {
  cid: string;
  text: string;
  ts: number;
}

export interface RoomSnapshot {
  status: ConnectionStatus;
  /** Consecutive failed connection attempts. */
  attempt: number;
  nextRetryAt: number | null;
  /** Received at least one welcome, so the data below is meaningful. */
  joined: boolean;
  you: Member | null;
  members: Member[];
  /** The room's display name, if someone gave it one. */
  roomName: string | null;
  chat: ChatMessage[];
  pendingChat: PendingChat[];
  game: GameSnapshot | null;
  /** serverTime - Date.now(), for rendering server deadlines. */
  clockOffset: number;
  /** Why we're not connected, when the server told us (e.g. rate limited). */
  notice: string | null;
}

export interface ConnectionStats {
  /** The last heartbeat's round trip. */
  latencyMs: number | null;
  connectedAt: number | null;
  /** When anything last arrived from the server. */
  lastHeardAt: number | null;
  /** Times this tab has had to reconnect. */
  reconnects: number;
  heartbeatEveryMs: number;
}

/** Whose a bot's or guest's connection is (see the constructor). */
export type Owned = { owner: string } & ({ bot: BotInfo } | { guest: true });

export class RequestError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

type Mutation = Extract<ClientMessage, { cid: string }>;

interface Outgoing {
  msg: Mutation;
  kind: "chat" | "room" | "game";
  resolve(): void;
  reject(e: RequestError): void;
}

const HEARTBEAT_EVERY_MS = 10_000;
const HEARTBEAT_TIMEOUT_MS = 8_000;
const CONNECT_TIMEOUT_MS = 10_000;
/** Coming back to the tab: how long the connection has to answer before it's replaced. */
const PROBE_TIMEOUT_MS = 3_000;
/** Coming back fires several events at once (shown, focused): one check for all of them. */
const RESUME_EVERY_MS = 2_000;
const MAX_BACKOFF_MS = 10_000;
const MAX_CHAT = 500;
const PENDING_CHAT_MAX_AGE_MS = 60 * 60 * 1000;
/** Chat waiting to be sent, at most. */
const MAX_PENDING_CHAT = 30;
/** Chat sent at once, then one per CHAT_EVERY_MS: within the server's limits for a connection (limits.ts). */
const CHAT_BURST = 10;
const CHAT_EVERY_MS = 1_200;
/** After a message is refused for coming too fast. */
const CHAT_RETRY_MS = 3_000;

export class RoomClient {
  private ws: WebSocket | null = null;
  private welcomed = false;
  private stopped = true;
  private snapshot: RoomSnapshot = {
    status: "connecting",
    attempt: 0,
    nextRetryAt: null,
    joined: false,
    you: null,
    members: [],
    roomName: null,
    chat: [],
    pendingChat: [],
    game: null,
    clockOffset: 0,
    notice: null,
  };
  private listeners = new Set<() => void>();
  private toastListeners = new Set<(text: string) => void>();
  /** Set by a server error just before it closes the socket on us. */
  private retryAfterMs: number | null = null;
  private outbox = new Map<string, Outgoing>();
  /** Chat sent on this connection and not yet acknowledged, and what may go out now. */
  private chatInFlight = new Set<string>();
  private chatTokens = { n: CHAT_BURST, at: 0 };
  private chatTimer: ReturnType<typeof setTimeout> | undefined;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private connectTimer: ReturnType<typeof setTimeout> | undefined;
  private probeTimer: ReturnType<typeof setTimeout> | undefined;
  private connectStartedAt = 0;
  private resumedAt = 0;
  /** The tab was hidden since the connection was last checked. */
  private wasHidden = false;
  private heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  private pingSentAt: number | null = null;
  private lastReceivedAt = 0;
  private latencyMs: number | null = null;
  private connectedAt: number | null = null;
  private reconnects = 0;

  constructor(
    private readonly roomId: string,
    private readonly secret: string,
    private name: string,
    private color: number,
    /** For a bot's or guest's connection: its owner's secret, and for a bot how it plays. */
    owned?: Owned,
  ) {
    this.owner = owned?.owner;
    this.bot = owned && "bot" in owned ? owned.bot : undefined;
    this.guest = !!owned && "guest" in owned;
  }

  private readonly owner: string | undefined;
  private bot: BotInfo | undefined;
  private readonly guest: boolean;

  // --- lifecycle -----------------------------------------------------------

  start() {
    if (!this.stopped) return;
    this.stopped = false;
    this.restorePendingChat();
    window.addEventListener("online", this.onOnline);
    window.addEventListener("offline", this.onOffline);
    document.addEventListener("visibilitychange", this.onResume);
    window.addEventListener("focus", this.onResume);
    window.addEventListener("pageshow", this.onResume);
    this.heartbeatTimer = setInterval(this.heartbeat, 2_000);
    this.connect();
  }

  stop() {
    this.stopped = true;
    window.removeEventListener("online", this.onOnline);
    window.removeEventListener("offline", this.onOffline);
    document.removeEventListener("visibilitychange", this.onResume);
    window.removeEventListener("focus", this.onResume);
    window.removeEventListener("pageshow", this.onResume);
    clearInterval(this.heartbeatTimer);
    clearTimeout(this.probeTimer);
    clearTimeout(this.retryTimer);
    clearTimeout(this.connectTimer);
    clearTimeout(this.chatTimer);
    const ws = this.ws;
    this.ws = null;
    ws?.close(1000, "bye");
  }

  /** Reconnect a tab that was replaced by a newer one (the user asked to use this one). */
  takeOver() {
    if (this.stopped || this.snapshot.status !== "replaced") return;
    this.update({ status: "reconnecting", attempt: 0 });
    this.connect();
  }

  /** Skip the backoff and try now (unless an attempt has only just started). */
  retryNow() {
    if (this.stopped || this.isTerminal()) return;
    if (this.ws && this.ws.readyState === WebSocket.OPEN && this.welcomed) return;
    if (this.ws && Date.now() - this.connectStartedAt < PROBE_TIMEOUT_MS) return;
    this.dropSocket();
    this.connect();
  }

  /** How the connection is doing, for the details behind the status light. */
  stats(): ConnectionStats {
    return {
      latencyMs: this.isConnected() ? this.latencyMs : null,
      connectedAt: this.isConnected() ? this.connectedAt : null,
      lastHeardAt: this.lastReceivedAt || null,
      reconnects: this.reconnects,
      heartbeatEveryMs: HEARTBEAT_EVERY_MS,
    };
  }

  // --- store ---------------------------------------------------------------

  getSnapshot = (): RoomSnapshot => this.snapshot;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Transient messages for the user (e.g. "slow down"). */
  onToast(listener: (text: string) => void) {
    this.toastListeners.add(listener);
    return () => {
      this.toastListeners.delete(listener);
    };
  }

  /** For logs: whose connection this is. */
  private who(): string {
    return this.owner ? `${this.guest ? "guest" : "bot"} ${this.name}` : `you (${this.name})`;
  }

  private toast(text: string) {
    for (const l of this.toastListeners) l(text);
  }

  private update(patch: Partial<RoomSnapshot>) {
    if (patch.status && patch.status !== this.snapshot.status) {
      devLog(this.roomId, this.who(), `status ${patch.status}`, patch.attempt ? { attempt: patch.attempt } : undefined);
    }
    this.snapshot = { ...this.snapshot, ...patch };
    if (patch.pendingChat) this.savePendingChat();
    for (const l of this.listeners) l();
  }

  // --- pending chat across refreshes ---------------------------------------

  /** Only your own chat is kept (a bot's or guest's is of the moment). */
  private pendingKey(): string | null {
    return this.owner ? null : `gg.pendingChat.${this.roomId}`;
  }

  private savePendingChat() {
    const key = this.pendingKey();
    if (!key) return;
    try {
      if (this.snapshot.pendingChat.length) sessionStorage.setItem(key, JSON.stringify(this.snapshot.pendingChat));
      else sessionStorage.removeItem(key);
    } catch {
      // Storage unavailable: it's still sent if this page stays open.
    }
  }

  /** Chat this tab queued before a refresh (or before leaving the room and coming back). */
  private restorePendingChat() {
    const key = this.pendingKey();
    if (!key || this.snapshot.pendingChat.length) return;
    let saved: PendingChat[] = [];
    try {
      const parsed: unknown = JSON.parse(sessionStorage.getItem(key) ?? "[]");
      if (Array.isArray(parsed)) saved = parsed as PendingChat[];
    } catch {
      return;
    }
    const fresh = saved.filter((p) => typeof p?.cid === "string" && typeof p.text === "string" && Date.now() - p.ts < PENDING_CHAT_MAX_AGE_MS);
    this.update({ pendingChat: fresh });
    for (const p of fresh) void this.enqueue({ type: "chat", cid: p.cid, text: p.text }, "chat").catch(() => {});
  }

  // --- public actions ------------------------------------------------------

  /** Queued while offline and delivered on reconnect. Rejects if the server refuses it. */
  sendChat(raw: string): Promise<void> {
    const text = sanitizeChat(raw);
    if (!text) return Promise.resolve();
    if (this.snapshot.pendingChat.length >= MAX_PENDING_CHAT) return Promise.reject(new RequestError("too_many_pending", "Lots of messages are still waiting to be sent. Try again once they've gone."));
    const cid = crypto.randomUUID();
    this.update({ pendingChat: [...this.snapshot.pendingChat, { cid, text, ts: Date.now() }] });
    return this.enqueue({ type: "chat", cid, text }, "chat");
  }

  setProfile(name: string, color: number, bot?: BotInfo) {
    if (name === this.name && color === this.color && JSON.stringify(bot) === JSON.stringify(this.bot)) return;
    this.name = name;
    this.color = color;
    this.bot = bot;
    if (this.welcomed) this.sendRaw({ type: "setProfile", name, color, ...(bot ? { bot } : {}) });
  }

  /** What you're up to (null when done). Only sent while connected: it's of the moment. */
  setActivity(text: string | null) {
    if (this.isConnected()) this.sendRaw({ type: "activity", text });
  }

  renameRoom(name: string) {
    return this.request({ type: "renameRoom", cid: crypto.randomUUID(), name }, "room");
  }

  selectGame(gameId: string, config: unknown) {
    return this.request({ type: "selectGame", cid: crypto.randomUUID(), gameId, config }, "room");
  }

  endGame() {
    const game = this.snapshot.game;
    if (!game) return Promise.resolve();
    return this.request({ type: "endGame", cid: crypto.randomUUID(), instanceId: game.instanceId }, "room");
  }

  /** For bots: leave the room for good. The connection then closes as "left". */
  leaveRoom() {
    return this.request({ type: "leaveRoom", cid: crypto.randomUUID() }, "room");
  }

  /**
   * A move, made against the game as you see it now, or as of `at` (what a bot looked at
   * before deciding): it's refused if that game has ended or changed since.
   */
  sendGameOp(op: unknown, at?: { instanceId: string; version: number; round?: string }) {
    const game = this.snapshot.game;
    const { instanceId, version, round } = at ?? game ?? {};
    if (!instanceId) return Promise.reject(new RequestError("no_game", "No game is running."));
    return this.request({ type: "gameOp", cid: crypto.randomUUID(), instanceId, op, ifVersion: version, ...(round !== undefined ? { ifRound: round } : {}) }, "game");
  }

  // --- outbox --------------------------------------------------------------

  /** Mutations other than chat need a live connection: acting on stale state is worse than failing. */
  private request(msg: Mutation, kind: Outgoing["kind"]) {
    if (!this.isConnected()) return Promise.reject(new RequestError("offline", "You're offline. Reconnecting…"));
    return this.enqueue(msg, kind);
  }

  private enqueue(msg: Mutation, kind: Outgoing["kind"]) {
    return new Promise<void>((resolve, reject) => {
      const out: Outgoing = { msg, kind, resolve, reject };
      this.outbox.set(msg.cid, out);
      this.transmit(out);
    });
  }

  private transmit(out: Outgoing) {
    if (out.kind === "chat") this.pumpChat();
    else if (this.isConnected()) this.sendRaw(out.msg);
  }

  /** Send the chat that's waiting, in order, as fast as the server takes it. */
  private pumpChat() {
    clearTimeout(this.chatTimer);
    if (!this.isConnected()) return;
    const now = Date.now();
    const t = this.chatTokens;
    t.n = Math.min(CHAT_BURST, t.n + (now - t.at) / CHAT_EVERY_MS);
    t.at = now;
    for (const out of [...this.outbox.values()]) {
      if (out.kind !== "chat" || this.chatInFlight.has(out.msg.cid)) continue;
      const queued = this.snapshot.pendingChat.find((p) => p.cid === out.msg.cid);
      if (queued && now - queued.ts > PENDING_CHAT_MAX_AGE_MS) {
        this.settle(out.msg.cid, new RequestError("expired", "A message waited too long for a connection and wasn't sent."));
        continue;
      }
      if (t.n < 1) {
        this.chatTimer = setTimeout(() => this.pumpChat(), (1 - t.n) * CHAT_EVERY_MS);
        return;
      }
      t.n--;
      this.chatInFlight.add(out.msg.cid);
      this.sendRaw(out.msg);
    }
  }

  private settle(cid: string, error: RequestError | null) {
    const out = this.outbox.get(cid);
    if (!out) return;
    if (out.kind === "chat") {
      this.chatInFlight.delete(cid);
      // Too fast (other tabs on this network count too): it goes again in a moment.
      if (error?.code === RATE_LIMITED) {
        this.chatTokens = { n: 0, at: Date.now() };
        clearTimeout(this.chatTimer);
        this.chatTimer = setTimeout(() => this.pumpChat(), CHAT_RETRY_MS);
        return;
      }
    }
    if (error) devLog(this.roomId, this.who(), "refused", { request: out.msg, code: error.code, message: error.message });
    this.outbox.delete(cid);
    if (out.kind === "chat") this.update({ pendingChat: this.snapshot.pendingChat.filter((p) => p.cid !== cid) });
    if (error) out.reject(error);
    else out.resolve();
  }

  // --- socket --------------------------------------------------------------

  private isConnected() {
    return this.welcomed && this.ws?.readyState === WebSocket.OPEN;
  }

  private isTerminal() {
    const s = this.snapshot.status;
    return s === "not_found" || s === "outdated" || s === "replaced" || s === "left";
  }

  private connect() {
    if (this.stopped || this.isTerminal()) return;
    clearTimeout(this.retryTimer);
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${location.host}/api/rooms/${this.roomId}/ws`);
    this.ws = ws;
    this.welcomed = false;
    this.connectStartedAt = Date.now();
    this.pingSentAt = null;
    this.latencyMs = null;
    this.update({ status: this.snapshot.joined ? "reconnecting" : "connecting", nextRetryAt: null });

    clearTimeout(this.connectTimer);
    this.connectTimer = setTimeout(() => {
      if (this.ws === ws && !this.welcomed) this.onSocketLost(ws);
    }, CONNECT_TIMEOUT_MS);

    ws.onopen = () => {
      if (this.ws !== ws) return;
      const lastSeq = this.snapshot.chat.at(-1)?.seq ?? null;
      this.sendRaw({
        type: "hello",
        protocol: PROTOCOL_VERSION,
        secret: this.secret,
        name: this.name,
        color: this.color,
        chatCursor: lastSeq,
        ...(this.owner ? { owner: this.owner } : {}),
        ...(this.guest ? { guest: true } : {}),
        ...(this.bot ? { bot: this.bot } : {}),
      });
    };
    ws.onmessage = (e) => {
      if (this.ws !== ws) return;
      this.lastReceivedAt = Date.now();
      if (e.data === PONG) {
        if (this.pingSentAt !== null) this.latencyMs = this.lastReceivedAt - this.pingSentAt;
        return;
      }
      try {
        this.handle(JSON.parse(e.data as string) as ServerMessage);
      } catch (err) {
        console.error("bad message from server", err);
      }
    };
    ws.onclose = (e) => {
      if (this.ws !== ws) return;
      if (e.code === CloseCode.RoomNotFound) return this.terminate("not_found");
      if (e.code === CloseCode.Outdated) return this.terminate("outdated");
      if (e.code === CloseCode.Left) return this.terminate("left");
      if (e.code === CloseCode.Replaced) {
        // Keep queued chat: it goes out if the user takes this tab back.
        this.dropSocket();
        return this.update({ status: "replaced", nextRetryAt: null });
      }
      this.onSocketLost(ws);
    };
  }

  private terminate(status: "not_found" | "outdated" | "left") {
    this.dropSocket();
    this.update({ status, nextRetryAt: null });
    for (const cid of [...this.outbox.keys()]) this.settle(cid, new RequestError(status, "Disconnected."));
  }

  private dropSocket() {
    const ws = this.ws;
    this.ws = null;
    this.welcomed = false;
    clearTimeout(this.connectTimer);
    clearTimeout(this.probeTimer);
    if (ws) {
      ws.onopen = ws.onmessage = ws.onclose = null;
      try {
        ws.close(4000, "dropped");
      } catch {
        // ignore
      }
    }
  }

  private onSocketLost(ws: WebSocket) {
    if (this.ws !== ws) return;
    this.dropSocket();
    if (this.stopped) return;
    const attempt = this.snapshot.attempt + 1;
    const base = attempt === 1 ? 250 : Math.min(MAX_BACKOFF_MS, 500 * 2 ** (attempt - 1));
    let delay = Math.round(base * (0.6 + Math.random() * 0.4));
    if (this.retryAfterMs !== null) {
      // The server asked us to wait; jitter so a whole room doesn't come back at once.
      delay = Math.max(delay, Math.round(this.retryAfterMs * (1 + Math.random() * 0.2)));
      this.retryAfterMs = null;
    }
    this.update({
      status: navigator.onLine === false ? "offline" : "reconnecting",
      attempt,
      nextRetryAt: Date.now() + delay,
    });
    this.retryTimer = setTimeout(() => this.connect(), delay);
  }

  private heartbeat = () => {
    const ws = this.ws;
    if (!ws || !this.welcomed || ws.readyState !== WebSocket.OPEN) return;
    const now = Date.now();
    if (this.pingSentAt !== null && this.lastReceivedAt < this.pingSentAt) {
      // Ping outstanding: if nothing came back in time, the connection is dead.
      if (now - this.pingSentAt > HEARTBEAT_TIMEOUT_MS) this.onSocketLost(ws);
      return;
    }
    if (this.pingSentAt === null || now - this.pingSentAt >= HEARTBEAT_EVERY_MS) {
      this.pingSentAt = now;
      ws.send(PING);
    }
  };

  private onOnline = () => this.retryNow();

  private onOffline = () => {
    if (this.ws) this.onSocketLost(this.ws);
    else this.update({ status: "offline" });
  };

  /** Back in the tab: check the connection now, rather than at the next heartbeat. */
  private onResume = (e: Event) => {
    if (document.visibilityState === "hidden") this.wasHidden = true;
    // Every page load has a pageshow; only one restored from the back/forward cache is a return.
    if (document.visibilityState !== "visible" || this.stopped || (e instanceof PageTransitionEvent && !e.persisted)) return;
    const now = Date.now();
    if (now - this.resumedAt < RESUME_EVERY_MS) return;
    this.resumedAt = now;
    if (!this.isConnected()) return this.retryNow();
    // A tab that stayed in sight kept up its heartbeat: nothing to check.
    if (!this.wasHidden && !(e instanceof PageTransitionEvent)) return;
    this.wasHidden = false;
    // Don't trust a socket that slept: it has a moment to answer, or it's replaced.
    const ws = this.ws!;
    this.pingSentAt = now;
    ws.send(PING);
    clearTimeout(this.probeTimer);
    this.probeTimer = setTimeout(() => {
      if (this.ws !== ws || this.lastReceivedAt >= now) return;
      devLog(this.roomId, this.who(), "no answer after coming back; reconnecting");
      this.onSocketLost(ws);
    }, PROBE_TIMEOUT_MS);
  };

  private sendRaw(msg: ClientMessage) {
    this.ws?.send(JSON.stringify(msg));
  }

  // --- incoming ------------------------------------------------------------

  private handle(msg: ServerMessage) {
    switch (msg.type) {
      case "welcome": {
        this.welcomed = true;
        clearTimeout(this.connectTimer);
        if (this.snapshot.joined) this.reconnects++;
        this.connectedAt = Date.now();
        this.update({
          status: "connected",
          attempt: 0,
          nextRetryAt: null,
          joined: true,
          you: msg.you,
          members: msg.members,
          roomName: msg.roomName,
          chat: msg.chatReset ? msg.chat : mergeChat(this.snapshot.chat, msg.chat),
          game: msg.game,
          clockOffset: msg.serverTime - Date.now(),
          notice: null,
        });
        noteServerBuild(msg.build);
        // Resend anything unacknowledged, in order (chat at its own pace).
        this.chatInFlight.clear();
        this.chatTokens = { n: CHAT_BURST, at: Date.now() };
        for (const out of this.outbox.values()) if (out.kind !== "chat") this.transmit(out);
        this.pumpChat();
        return;
      }
      case "members": {
        const you = msg.members.find((m) => m.id === this.snapshot.you?.id) ?? this.snapshot.you;
        return this.update({ members: msg.members, you });
      }
      case "room":
        return this.update({ roomName: msg.name });
      case "chat":
        return this.update({ chat: mergeChat(this.snapshot.chat, msg.messages) });
      case "game":
        return this.update({ game: msg.game });
      case "ack":
        return this.settle(msg.cid, msg.ok ? null : new RequestError(msg.error.code, msg.error.message));
      case "error":
        if (msg.code === "room_not_found") return this.terminate("not_found");
        if (msg.code === "outdated") return this.terminate("outdated");
        if (msg.code === RATE_LIMITED || msg.code === ROOM_FULL) {
          if (msg.retryAfterMs !== undefined) {
            // The socket is about to be closed; explain why and wait as asked.
            this.retryAfterMs = msg.retryAfterMs;
            return this.update({ notice: msg.message });
          }
          return this.toast(msg.message);
        }
        console.warn("server error", msg);
        devLog(this.roomId, this.who(), "server error", msg);
    }
  }
}

function mergeChat(existing: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  if (!incoming.length) return existing;
  const bySeq = new Map(existing.map((m) => [m.seq, m]));
  for (const m of incoming) bySeq.set(m.seq, m);
  return [...bySeq.values()].sort((a, b) => a.seq - b.seq).slice(-MAX_CHAT);
}
