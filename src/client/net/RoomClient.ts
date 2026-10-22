/**
 * Client side of the room connection: one WebSocket, kept alive forever.
 *
 *   - Reconnects with jittered exponential backoff; immediately when the browser
 *     comes back online or the tab becomes visible.
 *   - Heartbeats detect half-dead connections (e.g. after a laptop sleeps) that
 *     the browser would otherwise consider open for minutes.
 *   - Every mutation goes through an outbox keyed by a client id (cid). After a
 *     reconnect, un-acked messages are resent; the server dedupes by cid. Game ops
 *     carry the game version they were made against (`ifVersion`), so a click
 *     never applies to a situation the player hasn't seen, first send or resend.
 *   - Chat typed while offline is queued and shown as pending.
 *   - Server limits are explained, not hidden: a refused connection carries a
 *     message and a retry-after, which wins over the normal backoff.
 *
 * State is exposed as an immutable snapshot for React's useSyncExternalStore.
 */
import {
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

export type ConnectionStatus =
  | "connecting"
  | "connected"
  | "reconnecting"
  | "offline"
  | "not_found"
  | "outdated"
  /** Too many tabs of this room open; this one was closed in favour of a newer one. */
  | "replaced";

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
const MAX_BACKOFF_MS = 10_000;
const MAX_CHAT = 500;

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
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private connectTimer: ReturnType<typeof setTimeout> | undefined;
  private heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  private pingSentAt: number | null = null;
  private lastReceivedAt = 0;

  constructor(
    private readonly roomId: string,
    private readonly secret: string,
    private name: string,
    private color: number,
  ) {}

  // --- lifecycle -----------------------------------------------------------

  start() {
    if (!this.stopped) return;
    this.stopped = false;
    window.addEventListener("online", this.onOnline);
    window.addEventListener("offline", this.onOffline);
    document.addEventListener("visibilitychange", this.onVisible);
    this.heartbeatTimer = setInterval(this.heartbeat, 2_000);
    this.connect();
  }

  stop() {
    this.stopped = true;
    window.removeEventListener("online", this.onOnline);
    window.removeEventListener("offline", this.onOffline);
    document.removeEventListener("visibilitychange", this.onVisible);
    clearInterval(this.heartbeatTimer);
    clearTimeout(this.retryTimer);
    clearTimeout(this.connectTimer);
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

  /** Skip the backoff and try now. */
  retryNow() {
    if (this.stopped || this.isTerminal()) return;
    if (this.ws && this.ws.readyState === WebSocket.OPEN && this.welcomed) return;
    this.dropSocket();
    this.connect();
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

  private toast(text: string) {
    for (const l of this.toastListeners) l(text);
  }

  private update(patch: Partial<RoomSnapshot>) {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const l of this.listeners) l();
  }

  // --- public actions ------------------------------------------------------

  /** Queued while offline and delivered on reconnect. Rejects if the server refuses it. */
  sendChat(raw: string): Promise<void> {
    const text = sanitizeChat(raw);
    if (!text) return Promise.resolve();
    const cid = crypto.randomUUID();
    this.update({ pendingChat: [...this.snapshot.pendingChat, { cid, text, ts: Date.now() }] });
    return this.enqueue({ type: "chat", cid, text }, "chat");
  }

  setProfile(name: string, color: number) {
    if (name === this.name && color === this.color) return;
    this.name = name;
    this.color = color;
    if (this.welcomed) this.sendRaw({ type: "setProfile", name, color });
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

  sendGameOp(op: unknown) {
    const game = this.snapshot.game;
    if (!game) return Promise.reject(new RequestError("no_game", "No game is running."));
    return this.request({ type: "gameOp", cid: crypto.randomUUID(), instanceId: game.instanceId, op, ifVersion: game.version }, "game");
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
    if (this.isConnected()) this.sendRaw(out.msg);
  }

  private settle(cid: string, error: RequestError | null) {
    const out = this.outbox.get(cid);
    if (!out) return;
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
    return s === "not_found" || s === "outdated" || s === "replaced";
  }

  private connect() {
    if (this.stopped || this.isTerminal()) return;
    clearTimeout(this.retryTimer);
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${location.host}/api/rooms/${this.roomId}/ws`);
    this.ws = ws;
    this.welcomed = false;
    this.pingSentAt = null;
    this.update({ status: this.snapshot.joined ? "reconnecting" : "connecting", nextRetryAt: null });

    clearTimeout(this.connectTimer);
    this.connectTimer = setTimeout(() => {
      if (this.ws === ws && !this.welcomed) this.onSocketLost(ws);
    }, CONNECT_TIMEOUT_MS);

    ws.onopen = () => {
      if (this.ws !== ws) return;
      const lastSeq = this.snapshot.chat.at(-1)?.seq ?? null;
      this.sendRaw({ type: "hello", protocol: PROTOCOL_VERSION, secret: this.secret, name: this.name, color: this.color, chatCursor: lastSeq });
    };
    ws.onmessage = (e) => {
      if (this.ws !== ws) return;
      this.lastReceivedAt = Date.now();
      if (e.data === PONG) return;
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
      if (e.code === CloseCode.Replaced) {
        // Keep queued chat: it goes out if the user takes this tab back.
        this.dropSocket();
        return this.update({ status: "replaced", nextRetryAt: null });
      }
      this.onSocketLost(ws);
    };
  }

  private terminate(status: "not_found" | "outdated") {
    this.dropSocket();
    this.update({ status, nextRetryAt: null });
    for (const cid of [...this.outbox.keys()]) this.settle(cid, new RequestError(status, "Disconnected."));
  }

  private dropSocket() {
    const ws = this.ws;
    this.ws = null;
    this.welcomed = false;
    clearTimeout(this.connectTimer);
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

  private onVisible = () => {
    if (document.visibilityState !== "visible") return;
    if (this.isConnected()) {
      // Verify the connection right away rather than trusting a socket that slept.
      this.pingSentAt = Date.now();
      this.ws!.send(PING);
    } else this.retryNow();
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
        // Resend anything unacknowledged, in order.
        for (const out of this.outbox.values()) this.transmit(out);
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
    }
  }
}

function mergeChat(existing: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  if (!incoming.length) return existing;
  const bySeq = new Map(existing.map((m) => [m.seq, m]));
  for (const m of incoming) bySeq.set(m.seq, m);
  return [...bySeq.values()].sort((a, b) => a.seq - b.seq).slice(-MAX_CHAT);
}
