/**
 * Plays one of your bots from this tab. A bot is just another player: its own
 * identity and its own connection (a RoomClient), so it gets only its own redacted
 * view, plus the moves it can make right now. After each change it waits a moment,
 * like a person would, then makes its move (`botMove`) through the same path as a
 * click. Moves carry the game version, so a move made against an old situation is
 * refused and the bot simply looks again.
 *
 * Only one tab plays a given bot: each holds a Web Lock while playing, and other tabs
 * of the room wait for it (taking over if that tab closes).
 */
import { botMove } from "../../games/kit/bot";
import type { AnyGameDefinition } from "../../games/types";
import { RequestError, RoomClient } from "../net/RoomClient";
import type { BotRecord } from "./store";

/** How long a bot "thinks" before moving. */
const THINK_MS: [number, number] = [600, 1500];
/** Until a person sits down, bots leave the seats to people for this long. */
const SEAT_WAIT_MS = 10_000;
const MAX_ATTEMPTS = 3;
const random = (maxExclusive: number) => Math.floor(Math.random() * maxExclusive);

export class BotPlayer {
  private client: RoomClient | null = null;
  private games: Record<string, AnyGameDefinition> | null = null;
  private readonly lock = new AbortController();
  private releaseLock: (() => void) | null = null;
  private stopped = false;
  private leaving = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  /** The game situation (instance and version) the bot last decided on. */
  private seen: string | null = null;
  private attempts = 0;
  /** When the bot first could take a seat in this game (it waits for people first). */
  private seatOpenSince: { instanceId: string; at: number } | null = null;

  constructor(
    private bot: BotRecord,
    private readonly ownerSecret: string,
  ) {}

  start() {
    const play = () =>
      new Promise<void>((release) => {
        this.releaseLock = release;
        void this.connect();
      });
    if (navigator.locks) navigator.locks.request(`gg.bot.${this.bot.id}`, { signal: this.lock.signal }, play).catch(() => {});
    else void play();
  }

  /** Its name or color changed. */
  update(bot: BotRecord) {
    this.bot = bot;
    this.client?.setProfile(bot.name, bot.color);
  }

  /** Stop playing (you left the room); the bot stays a member and comes back with you. */
  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    this.lock.abort();
    this.client?.stop();
    this.client = null;
    this.releaseLock?.();
  }

  /** Take the bot out of the room for good: give up its seat, leave, then stop. */
  async remove() {
    const client = this.client;
    // Not playing in this tab (another tab has it, and does this there).
    if (!client) return this.stop();
    this.leaving = true;
    clearTimeout(this.timer);
    try {
      await connected(client, 10_000);
      const game = client.getSnapshot().game;
      if (game?.legalOps?.some((op) => (op as { type?: string }).type === "leave")) await client.sendGameOp({ type: "leave" }).catch(() => {});
      await client.leaveRoom();
    } catch {
      // Offline: it stays in the room as a disconnected member.
    }
    this.stop();
  }

  private async connect() {
    // Game rules are only needed once you have a bot, so they load separately.
    this.games ??= (await import("../../games/registry")).games;
    if (this.stopped) return;
    const { roomId, secret, name, color } = this.bot;
    const client = new RoomClient(roomId, secret, name, color, this.ownerSecret);
    this.client = client;
    client.subscribe(() => this.onChange());
    client.start();
  }

  private onChange() {
    const snapshot = this.client?.getSnapshot();
    const game = snapshot?.status === "connected" ? snapshot.game : null;
    const key = game ? `${game.instanceId}:${game.version}` : null;
    if (key === this.seen) return;
    this.seen = key;
    this.attempts = 0;
    clearTimeout(this.timer);
    if (key && !this.leaving) this.think();
  }

  private think() {
    const [min, max] = THINK_MS;
    this.timer = setTimeout(() => this.move(), min + random(max - min));
  }

  private move() {
    const client = this.client;
    const game = client?.getSnapshot().game;
    const def = game && this.games?.[game.gameId];
    if (!client || !game || !def || this.leaving) return;
    const op = botMove(def, game.view, game.legalOps ?? [], random);
    if (op == null) return;
    if ((op as { type?: string }).type === "sit") {
      // Follow people to the table quickly; with nobody seated yet, give them time to choose first.
      if (this.seatOpenSince?.instanceId !== game.instanceId) this.seatOpenSince = { instanceId: game.instanceId, at: Date.now() };
      const members = client.getSnapshot().members;
      const peopleSeated = game.players.some((id) => members.find((m) => m.id === id)?.kind === "human");
      const wait = this.seatOpenSince.at + SEAT_WAIT_MS - Date.now();
      if (!peopleSeated && wait > 0) {
        this.timer = setTimeout(() => this.move(), wait);
        return;
      }
    }
    client.sendGameOp(op).catch((e: unknown) => {
      // Stale: the game moved on and the new view is on its way, which makes the bot look again.
      if (e instanceof RequestError && e.code === "stale") return;
      if (++this.attempts < MAX_ATTEMPTS && `${game.instanceId}:${game.version}` === this.seen) this.think();
      else console.warn(`${this.bot.name} couldn't move`, op, e);
    });
  }
}

function connected(client: RoomClient, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const check = () => {
      if (client.getSnapshot().status !== "connected") return false;
      unsubscribe();
      clearTimeout(timer);
      resolve();
      return true;
    };
    const unsubscribe = client.subscribe(check);
    const timer = setTimeout(() => {
      unsubscribe();
      reject(new Error("not connected"));
    }, timeoutMs);
    check();
  });
}
