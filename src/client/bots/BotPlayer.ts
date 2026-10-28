/**
 * Plays one of your bots from this tab. A bot is just another player: its own
 * identity and its own connection (a RoomClient), so it gets only its own redacted
 * view, plus the moves it can make right now. After each change it waits a moment,
 * like a person would, then makes its move through the same path as a click: a table
 * move (`tableMove`), or the game's built-in bot's (decided off the page's thread, see
 * ./thinker). Moves carry the game version, so a move made against an old situation is
 * refused and the bot simply looks again.
 *
 * Only one tab plays a given bot: each holds a Web Lock while playing, and other tabs
 * of the room wait for it (taking over if that tab closes).
 *
 * Removing a bot from a room (or deleting it) is one request to the room, which takes it
 * out of the game and the room together. Until the room confirms, the bot keeps the room
 * (marked `removing`), so a removal made while the room wasn't open happens when it is.
 */
import { BOT_MIN_MOVE_MS, botPace, tableMove } from "../../games/kit/bot";
import { isLobbyOp } from "../../games/kit/lobby";
import type { AnyGameDefinition } from "../../games/types";
import type { BotInfo } from "../../shared/protocol";
import { devLog } from "../devlog";
import { getConnection, PROVIDERS } from "../llm/connections";
import { RequestError, RoomClient } from "../net/RoomClient";
import { checkSiteUpdated, gameOutdated } from "../update";
import { AiBrain } from "./ai/AiBrain";
import { gameMoves } from "./ai/prompt";
import { loadGames } from "./games";
import { setJoining } from "./joining";
import { addBotStandIn, addBotUsage, type BotRecord, leftRoom, setBotError } from "./store";
import { decide } from "./thinker";

/** How long a bot "thinks" before moving. */
const THINK_MS: [number, number] = [BOT_MIN_MOVE_MS, 1800];
/** Until a person sits down, bots leave the seats to people for this long. */
const SEAT_WAIT_MS = 10_000;
const MAX_ATTEMPTS = 3;
/** Between tries at loading the game rules, at most. */
const MAX_LOAD_RETRY_MS = 30_000;
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
    if (!this.removing()) setJoining(this.roomId, this.bot.id, {});
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
    setJoining(this.roomId, this.bot.id, null);
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

  private async connect(tries = 0) {
    // Game rules are only needed once you have a bot, so they load separately, and that can fail.
    if (!this.games) {
      try {
        this.games = await loadGames();
      } catch (e) {
        if (this.stopped) return this.releaseLock?.();
        const reload = await checkSiteUpdated();
        this.log("couldn't load the game rules", { error: e instanceof Error ? e.message : String(e), reload });
        setJoining(this.roomId, this.bot.id, {
          problem: reload ? "gg was updated since this page loaded. Reload the page to bring bots in." : "Couldn't load what bots need to play. Trying again…",
          reload,
        });
        this.timer = setTimeout(() => void this.connect(tries + 1), Math.min(MAX_LOAD_RETRY_MS, 2_000 * 2 ** tries));
        return;
      }
    }
    if (this.stopped) return this.releaseLock?.();
    const { secret, name, color } = this.bot;
    const client = new RoomClient(this.roomId, secret, name, color, { owner: this.ownerSecret, bot: botInfo(this.bot) });
    this.client = client;
    this.setBrain();
    client.subscribe(() => this.onChange());
    client.start();
  }

  /** The game on changed its rules since this page loaded: the page reloads before the bot plays on. */
  private gameOutdated() {
    const game = this.client?.getSnapshot().game;
    return !!game && gameOutdated(game.gameId);
  }

  /**
   * AI bots get a brain; switching a bot to built-in (or to another connection) replaces it.
   * It has none while its game is one this page can't play: it would only pay for moves
   * that can't be made.
   */
  private setBrain() {
    const { level, connectionId, name, persona, model, effort } = this.bot;
    if (level !== "ai" || !connectionId || this.removing() || this.gameOutdated()) {
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
      builtinMove: () => {
        const game = client.getSnapshot().game;
        return game ? decide({ gameId: game.gameId, view: game.view, ops: gameMoves(game.legalOps ?? []), strength: "hard" }) : Promise.resolve(null);
      },
      usage: (u) => addBotUsage(this.bot.id, u),
      error: (message) => setBotError(this.bot.id, message),
      activity: (text) => client.setActivity(text),
      standIn: (why) => addBotStandIn(this.bot.id, why),
      log: (event, data) => this.log(event, data),
    });
    this.brain.observe();
  }

  /** For the room page: on its way in, or why it can't come in yet. */
  private showJoining() {
    const snapshot = this.client?.getSnapshot();
    if (!snapshot || snapshot.status === "connected" || this.removing()) return setJoining(this.roomId, this.bot.id, null);
    const problem =
      snapshot.status === "outdated"
        ? "gg was updated since this page loaded. Reload the page to bring bots in."
        : snapshot.status === "not_found"
          ? "This room is gone."
          : (snapshot.notice ?? undefined);
    setJoining(this.roomId, this.bot.id, problem ? { problem, reload: snapshot.status === "outdated" } : {});
  }

  private onChange() {
    this.showJoining();
    if (this.removing() || this.client?.getSnapshot().status === "not_found") {
      clearTimeout(this.timer);
      this.brain?.stop();
      this.brain = null;
      if (this.client) this.leave(this.client);
      return;
    }
    // No brain while the game on is one this page can't play; back once it's one it can.
    const wantsBrain = this.bot.level === "ai" && !!this.bot.connectionId && !this.gameOutdated();
    if (wantsBrain !== !!this.brain) this.setBrain();
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
    // A game that takes longer to play out (a die rolling, a unicorn galloping) gets the extra time.
    const extra = botPace(this.games?.[this.client?.getSnapshot().game?.gameId ?? ""]) - min;
    this.timer = setTimeout(() => this.move(), min + extra + random(max - min));
  }

  private async move() {
    const client = this.client;
    const game = client?.getSnapshot().game;
    if (!client || !game || !this.games?.[game.gameId] || this.removing() || this.gameOutdated()) return;
    const at = { instanceId: game.instanceId, version: game.version, round: game.round };
    const legal = game.legalOps ?? [];
    // AI bots only make table moves here; their brain plays the game.
    let op: unknown = tableMove(legal, random);
    if (op == null && !this.brain) {
      try {
        op = await decide({ gameId: game.gameId, view: game.view, ops: legal.filter((o) => !isLobbyOp(o)), strength: this.bot.strength ?? "hard" });
      } catch (e) {
        // Its rules didn't load (see ./games): it thinks again in a moment.
        this.log("couldn't decide", { error: e instanceof Error ? e.message : String(e) });
        if (!this.stopped && ++this.attempts < MAX_ATTEMPTS && this.seen === `${at.instanceId}:${at.version}`) this.think();
        return;
      }
      // The game moved on while it thought: it looks again at the new situation.
      if (this.seen !== `${at.instanceId}:${at.version}` || this.stopped || this.removing()) return;
    }
    if (op == null) return;
    if ((op as { type?: string }).type === "sit") {
      // Follow people to the table quickly; with nobody seated yet, give them time to choose first.
      if (this.seatOpenSince?.instanceId !== game.instanceId) this.seatOpenSince = { instanceId: game.instanceId, at: Date.now() };
      const members = client.getSnapshot().members;
      const peopleSeated = game.players.some((id) => members.find((m) => m.id === id)?.kind !== "bot");
      const wait = this.seatOpenSince.at + SEAT_WAIT_MS - Date.now();
      if (!peopleSeated && wait > 0) {
        this.timer = setTimeout(() => this.move(), wait);
        return;
      }
    }
    this.log(this.brain ? "table move" : "move", op);
    client.sendGameOp(op, at).catch((e: unknown) => {
      this.log("move refused", { op, error: e instanceof Error ? e.message : String(e) });
      // Stale: the game moved on and the new view is on its way, which makes the bot look again.
      if (e instanceof RequestError && e.code === "stale") return;
      if (++this.attempts < MAX_ATTEMPTS && `${at.instanceId}:${at.version}` === this.seen) this.think();
      else console.warn(`${this.bot.name} couldn't move`, op, e);
    });
  }
}

/** What the room is told about how a bot plays. */
function botInfo(bot: BotRecord): BotInfo {
  const persona = bot.persona ? { persona: bot.persona } : {};
  if (bot.level !== "ai" || !bot.connectionId) return { level: "builtin", strength: bot.strength ?? "hard", ...persona };
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
