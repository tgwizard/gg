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
 *
 * Removing a bot from a room (or deleting it) is one request to the room, which takes it
 * out of the game and the room together. Until the room confirms, the bot keeps the room
 * (marked `removing`), so a removal made while the room wasn't open happens when it is.
 */
import { BOT_MIN_MOVE_MS, botMove, tableMove } from "../../games/kit/bot";
import type { AnyGameDefinition } from "../../games/types";
import type { BotInfo } from "../../shared/protocol";
import { devLog } from "../devlog";
import { getConnection, PROVIDERS } from "../llm/connections";
import { RequestError, RoomClient } from "../net/RoomClient";
import { AiBrain } from "./ai/AiBrain";
import { gameMoves } from "./ai/prompt";
import { addBotStandIn, addBotUsage, type BotRecord, leftRoom, setBotError } from "./store";

/** How long a bot "thinks" before moving. */
const THINK_MS: [number, number] = [BOT_MIN_MOVE_MS, 1800];
/** Until a person sits down, bots leave the seats to people for this long. */
const SEAT_WAIT_MS = 10_000;
const MAX_ATTEMPTS = 3;
const random = (maxExclusive: number) => Math.floor(Math.random() * maxExclusive);

export class BotPlayer {
  private client: RoomClient | null = null;
  /** For AI bots: decides game moves and chat (table moves stay here). */
  private brain: AiBrain | null = null;
  private games: Record<string, AnyGameDefinition> | null = null;
  private readonly lock = new AbortController();
  private releaseLock: (() => void) | null = null;
  private stopped = false;
  /** A request to leave the room is on its way. */
  private leaving = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  /** The game situation (instance and version) the bot last decided on. */
  private seen: string | null = null;
  private attempts = 0;
  /** When the bot first could take a seat in this game (it waits for people first). */
  private seatOpenSince: { instanceId: string; at: number } | null = null;

  constructor(
    private bot: BotRecord,
    private readonly roomId: string,
    private readonly ownerSecret: string,
  ) {}

  /** Taken out of this room, or deleted: it's to leave. */
  private removing() {
    return !!(this.bot.deleted || this.bot.rooms[this.roomId]?.removing);
  }

  start() {
    // Held until stop(). A player stopped before (or just as) the lock comes through
    // must let go of it at once, or the bot's next player waits forever: React mounts
    // the room twice in dev, and leaving the room can race the lock too.
    const play = () => {
      if (this.stopped) return Promise.resolve();
      this.log("playing from this tab");
      return new Promise<void>((release) => {
        this.releaseLock = release;
        void this.connect();
      });
    };
    if (!navigator.locks) return void play();
    void navigator.locks.query().then((state) => {
      if (!this.stopped && state.held?.some((l) => l.name === this.lockName())) this.log("waiting for its lock (held by another tab, or a moment ago by this page)");
    });
    navigator.locks.request(this.lockName(), { signal: this.lock.signal }, play).catch(() => {});
  }

  private lockName() {
    return `gg.bot.${this.bot.id}.${this.roomId}`;
  }

  /** Its setup changed (name, color, AI connection, persona), or it's been removed. */
  update(bot: BotRecord) {
    this.bot = bot;
    if (this.removing()) return this.onChange();
    this.client?.setProfile(bot.name, bot.color, botInfo(bot));
    if (this.client) this.setBrain();
  }

  /** Stop playing (you left the room, or it's gone); a bot still in the room comes back with you. */
  stop() {
    this.stopped = true;
    this.brain?.stop();
    clearTimeout(this.timer);
    this.lock.abort();
    this.client?.stop();
    this.client = null;
    this.releaseLock?.();
  }

  /** Removed: leave the room for good once connected (retried on every change until it's done). */
  private leave(client: RoomClient) {
    const status = client.getSnapshot().status;
    if (status === "left" || status === "not_found") return leftRoom(this.bot.id, this.roomId);
    if (this.leaving || status !== "connected") return;
    this.leaving = true;
    this.log("leaving the room");
    client.leaveRoom().then(
      () => leftRoom(this.bot.id, this.roomId),
      (e: unknown) => {
        this.leaving = false;
        this.log("couldn't leave yet", { error: e instanceof Error ? e.message : String(e) });
      },
    );
  }

  private log(event: string, data?: unknown) {
    devLog(this.roomId, `bot ${this.bot.name}`, event, data);
  }

  private async connect() {
    // Game rules are only needed once you have a bot, so they load separately.
    this.games ??= (await import("../../games/registry")).games;
    if (this.stopped) return this.releaseLock?.();
    const { secret, name, color } = this.bot;
    const client = new RoomClient(this.roomId, secret, name, color, this.ownerSecret, botInfo(this.bot));
    this.client = client;
    this.setBrain();
    client.subscribe(() => this.onChange());
    client.start();
  }

  /** AI bots get a brain; switching a bot to built-in (or to another connection) replaces it. */
  private setBrain() {
    const { level, connectionId, name, persona, model, effort } = this.bot;
    if (level !== "ai" || !connectionId || this.removing()) {
      this.brain?.stop();
      this.brain = null;
      return;
    }
    const setup = { name, persona, connectionId, model, effort };
    if (this.brain) return this.brain.update(setup);
    const client = this.client!;
    this.brain = new AiBrain(setup, this.games!, {
      snapshot: () => client.getSnapshot(),
      sendOp: (op, at) => client.sendGameOp(op, at),
      say: (text) => void client.sendChat(text).catch(() => {}),
      easyMove: () => {
        const game = client.getSnapshot().game;
        const def = game && this.games?.[game.gameId];
        return def ? def.bot.easy(game.view, gameMoves(game.legalOps ?? []), random) : null;
      },
      usage: (u) => addBotUsage(this.bot.id, u),
      error: (message) => setBotError(this.bot.id, message),
      activity: (text) => client.setActivity(text),
      standIn: (why) => addBotStandIn(this.bot.id, why),
      log: (event, data) => this.log(event, data),
    });
    this.brain.observe();
  }

  private onChange() {
    if (this.removing() || this.client?.getSnapshot().status === "not_found") {
      clearTimeout(this.timer);
      this.brain?.stop();
      this.brain = null;
      if (this.client) this.leave(this.client);
      return;
    }
    this.brain?.observe();
    const snapshot = this.client?.getSnapshot();
    const game = snapshot?.status === "connected" ? snapshot.game : null;
    const key = game ? `${game.instanceId}:${game.version}` : null;
    if (key === this.seen) return;
    this.seen = key;
    this.attempts = 0;
    clearTimeout(this.timer);
    if (key) this.think();
  }

  private think() {
    const [min, max] = THINK_MS;
    this.timer = setTimeout(() => this.move(), min + random(max - min));
  }

  private move() {
    const client = this.client;
    const game = client?.getSnapshot().game;
    const def = game && this.games?.[game.gameId];
    if (!client || !game || !def || this.removing()) return;
    // AI bots only make table moves here; their brain plays the game.
    const op = this.brain ? tableMove(game.legalOps ?? [], random) : botMove(def, game.view, game.legalOps ?? [], random);
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
    this.log(this.brain ? "table move" : "easy move", op);
    client.sendGameOp(op).catch((e: unknown) => {
      this.log("move refused", { op, error: e instanceof Error ? e.message : String(e) });
      // Stale: the game moved on and the new view is on its way, which makes the bot look again.
      if (e instanceof RequestError && e.code === "stale") return;
      if (++this.attempts < MAX_ATTEMPTS && `${game.instanceId}:${game.version}` === this.seen) this.think();
      else console.warn(`${this.bot.name} couldn't move`, op, e);
    });
  }
}

/** What the room is told about how a bot plays. */
function botInfo(bot: BotRecord): BotInfo {
  const persona = bot.persona ? { persona: bot.persona } : {};
  if (bot.level !== "ai" || !bot.connectionId) return { level: "easy", ...persona };
  const connection = getConnection(bot.connectionId);
  const model = bot.model ?? connection?.model;
  return {
    level: "ai",
    ...(model ? { model } : {}),
    ...(connection ? { provider: PROVIDERS[connection.provider].short } : {}),
    effort: bot.effort ?? "low",
    ...persona,
  };
}
