/** A minimal protocol client for integration tests, speaking to the real worker. */
import { exports } from "cloudflare:workers";
import { PROTOCOL_VERSION, type ServerMessage } from "../../src/shared/protocol";

const BASE = "http://gg.test";

export async function createRoom(): Promise<string> {
  const res = await exports.default.fetch(`${BASE}/api/rooms`, { method: "POST" });
  const body = (await res.json()) as { id: string };
  return body.id;
}

type Waiter = { pred: (m: ServerMessage) => boolean; resolve: (m: ServerMessage) => void };

export class TestClient {
  readonly received: ServerMessage[] = [];
  readonly raw: string[] = [];
  closed: { code: number; reason: string } | null = null;
  private waiters: Waiter[] = [];
  private cidCounter = 0;
  private constructor(readonly ws: WebSocket) {
    ws.addEventListener("message", (e) => {
      if (e.data === "pong") return;
      const text = e.data as string;
      this.raw.push(text);
      const msg = JSON.parse(text) as ServerMessage;
      this.received.push(msg);
      this.waiters = this.waiters.filter((w) => {
        if (!w.pred(msg)) return true;
        w.resolve(msg);
        return false;
      });
    });
    ws.addEventListener("close", (e) => {
      this.closed = { code: e.code, reason: e.reason };
    });
  }

  static async connect(roomId: string): Promise<TestClient> {
    const res = await exports.default.fetch(`${BASE}/api/rooms/${roomId}/ws`, { headers: { Upgrade: "websocket" } });
    const ws = res.webSocket;
    if (!ws) throw new Error(`no websocket (status ${res.status})`);
    ws.accept();
    return new TestClient(ws);
  }

  /** Connect and say hello; resolves with the welcome message. */
  static async join(roomId: string, secret: string, name: string, chatCursor: number | null = null) {
    const c = await TestClient.connect(roomId);
    const welcome = c.next("welcome");
    c.send({ type: "hello", protocol: PROTOCOL_VERSION, secret, name, chatCursor });
    return { client: c, welcome: await welcome };
  }

  send(msg: unknown) {
    this.ws.send(typeof msg === "string" ? msg : JSON.stringify(msg));
  }

  /** Next message (from now on) matching type and predicate. */
  next<T extends ServerMessage["type"]>(
    type: T,
    pred: (m: Extract<ServerMessage, { type: T }>) => boolean = () => true,
    timeoutMs = 2000,
  ): Promise<Extract<ServerMessage, { type: T }>> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timed out waiting for ${type}`)), timeoutMs);
      this.waiters.push({
        pred: (m) => m.type === type && pred(m as Extract<ServerMessage, { type: T }>),
        resolve: (m) => {
          clearTimeout(timer);
          resolve(m as Extract<ServerMessage, { type: T }>);
        },
      });
    });
  }

  /** Send a mutation with a cid and wait for its ack. */
  async request(msg: Record<string, unknown>, cid = `c${++this.cidCounter}-${Math.random()}`) {
    const ack = this.next("ack", (a) => a.cid === cid);
    this.send({ ...msg, cid });
    return ack;
  }

  latestGame() {
    for (let i = this.received.length - 1; i >= 0; i--) {
      const m = this.received[i]!;
      if (m.type === "game") return m.game;
      if (m.type === "welcome") return m.game;
    }
    return null;
  }

  close() {
    this.ws.close(1000, "bye");
  }
}

export const secret = (name: string) => `secret-for-${name}-0123456789abcdef`;
