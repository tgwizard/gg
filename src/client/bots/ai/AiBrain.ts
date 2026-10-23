/**
 * The mind of an AI bot: one conversation with the owner's model per game, grown only
 * at the end (so it's mostly cache hits), and woken by what happens rather than on a
 * timer:
 *
 *   - its move: right away;
 *   - someone talking in the room: after a short pause, so a burst is one wake-up.
 *     Other bots' messages wake it only while a budget lasts, which people talking and
 *     game news top up, so bots can banter but not forever;
 *   - otherwise, a slow heartbeat while there's news it hasn't seen.
 *
 * One call at a time. The model answers with the `act` tool; moves go through the same
 * path as anyone's, and their result goes back to the model (which can retry a few
 * times). If the model can't be reached, or keeps passing on its own move, the Easy bot
 * plays that move so the table never waits on it.
 */
import type { AnyGameDefinition } from "../../../games/types";
import { clientFor, getConnection } from "../../llm/connections";
import { type Effort, type LLMClient, LLMError, type LLMMessage, type LLMPart, type LLMUsage } from "../../llm/types";
import { RequestError, type RoomSnapshot } from "../../net/RoomClient";
import { ACT, actTool, gameMoves, instructions, parseAct, updateText } from "./prompt";

export interface BrainHost {
  snapshot(): RoomSnapshot;
  /** A move, made against the game version the bot was looking at. */
  sendOp(op: unknown, ifVersion?: number): Promise<void>;
  say(text: string): void;
  /** The Easy bot's move, when the model can't or won't make one. */
  easyMove(): unknown;
  usage(u: LLMUsage): void;
  error(message: string | undefined): void;
  /** What it's doing, for everyone to see (null when done). */
  activity(text: string | null): void;
  /** The Easy bot is about to make a move for it, and why. */
  standIn(why: string): void;
  /** Dev logging (see devlog.ts). */
  log(event: string, data?: unknown): void;
}

export interface BrainSetup {
  name: string;
  persona?: string;
  connectionId: string;
  /** Defaults to the connection's model. */
  model?: string;
  effort?: Effort;
}

type Reason = "turn" | "chat" | "heartbeat" | "retry";

const LOBBY = "lobby";

const CHAT_PAUSE_MS = 2_500;
const HEARTBEAT_MS = 60_000;
/** Bot-to-bot messages that may wake it before people or the game top the budget up. */
const BOT_CHAT_BUDGET = 3;
/** Unprompted chat (not answering someone, not on its move) at most this often. */
const UNPROMPTED_SAY_MS = 30_000;
/**
 * Calls a minute for chat and watching. Its own moves have a separate, much higher
 * limit (the game paces them: others move in between), only against runaway loops.
 */
const MAX_CALLS_PER_MINUTE = 8;
const MAX_MOVE_CALLS_PER_MINUTE = 30;
/** How long the Easy bot "thinks" when it stands in, like it does on its own. */
const STAND_IN_MS: [number, number] = [600, 1500];
const MAX_ATTEMPTS = 3;
/** Start the conversation over (with recent chat) when it gets this long. */
const MAX_MESSAGES = 80;
const RECENT_CHAT = 12;

export class AiBrain {
  private def: AnyGameDefinition | null = null;
  /** The game instance the conversation is about, or LOBBY between games. */
  private context: string | null = null;
  private messages: LLMMessage[] = [];
  /** Tool results waiting to open the next update. */
  private results: LLMPart[] = [];
  /** The last chat message the model has been sent. */
  private chatCursor = 0;
  /** The last chat message looked at for waking up. */
  private seenChat = 0;
  private viewVersion: number | null = null;
  private seenVersion: number | null = null;
  private news = false;
  private botBudget = BOT_CHAT_BUDGET;
  private lastUnpromptedSay = 0;
  private calls: number[] = [];
  private pending = new Set<Reason>();
  private running = false;
  private stopped = false;
  private timers = new Map<Reason | "standIn", ReturnType<typeof setTimeout>>();
  private heartbeat = setInterval(() => this.news && this.wake("heartbeat"), HEARTBEAT_MS);
  private client: { connectionId: string; llm: Promise<LLMClient> } | null = null;
  private abort = new AbortController();

  constructor(
    private setup: BrainSetup,
    private readonly games: Record<string, AnyGameDefinition>,
    private readonly host: BrainHost,
  ) {}

  /** Name, persona or connection changed: the next update starts a fresh conversation. */
  update(setup: BrainSetup) {
    // Any of these changes the prompt's prefix (or the cache's model), so start over.
    const changed = (["name", "persona", "connectionId", "model", "effort"] as const).some((k) => setup[k] !== this.setup[k]);
    this.setup = setup;
    if (changed) this.context = null;
  }

  stop() {
    this.stopped = true;
    this.abort.abort();
    clearInterval(this.heartbeat);
    for (const t of this.timers.values()) clearTimeout(t);
  }

  /** Called on every change to the bot's room snapshot. */
  observe() {
    const snap = this.host.snapshot();
    if (snap.status !== "connected") return;
    const game = snap.game;
    if ((game?.instanceId ?? LOBBY) !== this.context) this.restart(snap);

    const kinds = new Map(snap.members.map((m) => [m.id, m.kind]));
    let talk = false;
    for (const m of snap.chat) {
      if (m.seq <= this.seenChat) continue;
      this.seenChat = m.seq;
      if (m.kind === "user" && m.playerId === snap.you?.id) continue;
      this.news = true;
      if (m.kind !== "user") this.botBudget = BOT_CHAT_BUDGET;
      else if (kinds.get(m.playerId ?? "") !== "bot") {
        this.botBudget = BOT_CHAT_BUDGET;
        talk = true;
      } else if (this.botBudget > 0) {
        this.botBudget--;
        talk = true;
      }
    }
    if (talk) this.wake("chat", CHAT_PAUSE_MS);

    if (game && game.version !== this.seenVersion) {
      this.seenVersion = game.version;
      this.news = true;
      if (gameMoves(game.legalOps ?? []).length) this.wake("turn");
    }
  }

  private restart(snap: RoomSnapshot) {
    const game = snap.game;
    this.host.log("new conversation", { game: game?.gameId ?? "lobby", instance: game?.instanceId });
    this.def = game ? (this.games[game.gameId] ?? null) : null;
    this.context = game?.instanceId ?? LOBBY;
    this.messages = [];
    this.results = [];
    this.viewVersion = null;
    // A new conversation starts with a little of what was said before.
    const chat = snap.chat;
    this.chatCursor = chat.length > RECENT_CHAT ? chat[chat.length - RECENT_CHAT - 1]!.seq : 0;
    this.seenChat = Math.max(this.seenChat, this.chatCursor);
  }

  private wake(reason: Reason, delayMs = 0) {
    if (this.stopped) return;
    if (delayMs > 0) {
      if (this.timers.has(reason)) return;
      this.timers.set(
        reason,
        setTimeout(() => {
          this.timers.delete(reason);
          this.wake(reason);
        }, delayMs),
      );
      return;
    }
    this.pending.add(reason);
    void this.run();
  }

  private async run() {
    if (this.running || this.stopped) return;
    this.running = true;
    try {
      while (this.pending.size && !this.stopped) {
        // Pace calls. Its own move can't wait, so it gets its own, higher limit.
        const now = Date.now();
        this.calls = this.calls.filter((t) => now - t < 60_000);
        const move = this.pending.has("turn") || this.myMove();
        if (this.calls.length >= (move ? MAX_MOVE_CALLS_PER_MINUTE : MAX_CALLS_PER_MINUTE)) {
          this.host.log("over the call limit", { calls: this.calls.length, move, pending: [...this.pending] });
          if (move) this.standIn("it made too many model calls this minute");
          this.pending.clear();
          this.wake("heartbeat", 60_000 - (now - this.calls[0]!));
          break;
        }
        const reasons = new Set(this.pending);
        this.pending.clear();
        await this.think(reasons);
      }
    } finally {
      this.running = false;
    }
  }

  /** One update to the model and what comes of its answer. */
  private async think(reasons: Set<Reason>, attempt = 1, reminder?: string): Promise<void> {
    const snap = this.host.snapshot();
    const game = snap.game;
    const def = this.def;
    const you = snap.you?.id;
    if (!you || (game?.instanceId ?? LOBBY) !== this.context || (game && !def)) return;
    if (this.messages.length > MAX_MESSAGES) this.restart(snap);

    const moves = game ? gameMoves(game.legalOps ?? []) : [];
    const chat = snap.chat.filter((m) => m.seq > this.chatCursor && !(m.kind === "user" && m.playerId === you));
    if (!game && !chat.length && !this.results.length) return;
    const text = updateText({
      chat,
      ...(game && game.version !== this.viewVersion ? { view: game.view } : {}),
      inGame: !!game,
      moves,
      names: new Map(snap.members.map((m) => [m.id, m.name])),
      you,
      ...(reminder ? { reminder } : {}),
    });
    const connection = getConnection(this.setup.connectionId);
    const model = this.setup.model ?? connection?.model;
    if (!connection || !model) {
      this.host.error(connection ? "Pick a model for its AI connection in Settings." : "Its AI connection was removed. Edit the bot to pick another.");
      if (moves.length) this.standIn("its AI connection isn't set up");
      return;
    }
    // Kept in case the call fails: then this update is dropped and goes out with the next one.
    const before = { chatCursor: this.chatCursor, viewVersion: this.viewVersion, results: this.results };
    this.chatCursor = Math.max(this.chatCursor, ...snap.chat.map((m) => m.seq));
    this.viewVersion = game?.version ?? null;
    this.news = false;
    this.messages.push({ role: "user", content: [...this.results, { type: "text", text }] });
    this.results = [];

    let answer;
    const started = Date.now();
    this.host.log("wake", { reasons: [...reasons], attempt, model, effort: this.setup.effort ?? "low", messages: this.messages.length, update: text });
    this.host.activity(moves.length ? "Thinking about its move" : reasons.has("chat") ? "Reading the chat" : game ? "Watching the game" : "Thinking");
    try {
      this.calls.push(Date.now());
      answer = await (await this.llm()).generate({
        model,
        effort: this.setup.effort ?? "low",
        instructions: instructions(def, this.setup),
        tools: [actTool(def)],
        messages: this.messages,
        maxOutputTokens: 4000,
        cache: true,
        signal: this.abort.signal,
      });
    } catch (e) {
      this.messages.pop();
      Object.assign(this, before);
      this.host.activity(null);
      if (e instanceof LLMError && e.code === "cancelled") return;
      const message = e instanceof Error ? e.message : "Couldn't reach the model.";
      this.host.log("model error", { ms: Date.now() - started, message, code: e instanceof LLMError ? e.code : undefined });
      this.host.error(message);
      if (moves.length) this.standIn(`the model call failed (${message})`);
      return;
    }
    this.host.activity(null);
    this.host.error(undefined);
    this.host.log("answer", { ms: Date.now() - started, toolCalls: answer.toolCalls, text: answer.text || undefined, usage: answer.usage });
    if (answer.usage) this.host.usage(answer.usage);
    this.messages.push(answer.message);
    if (this.stopped) return;

    const [call, ...extra] = answer.toolCalls;
    for (const c of extra) this.results.push({ type: "tool_result", callId: c.id, content: "Ignored: one act per update.", isError: true });
    if (!call || call.name !== ACT) {
      if (call) this.results.push({ type: "tool_result", callId: call.id, content: `Unknown tool; use ${ACT}.`, isError: true });
      if (!moves.length) return;
      // Passed on its own move: one nudge, then the Easy bot moves for it.
      if (attempt < MAX_ATTEMPTS && !reasons.has("retry")) return this.think(new Set(["retry"]), attempt + 1, "It's your move: call act with one of the legal moves.");
      return this.standIn("the model passed on its own move");
    }

    const act = parseAct(def, call.input);
    const notes: string[] = [];
    if (act.say) {
      const prompted = reasons.has("turn") || reasons.has("chat") || reasons.has("retry");
      if (prompted || Date.now() - this.lastUnpromptedSay > UNPROMPTED_SAY_MS) {
        if (!prompted) this.lastUnpromptedSay = Date.now();
        this.host.say(act.say);
        notes.push("Said.");
      } else notes.push("Not said: you spoke up a moment ago; give others room.");
    }
    let failed = act.error;
    if (!failed && act.op !== undefined) {
      if (!moves.length) failed = "It isn't your move.";
      else {
        try {
          await this.host.sendOp(act.op, game!.version);
          notes.unshift("Move made.");
        } catch (e) {
          failed = e instanceof RequestError ? e.message : "The move didn't go through.";
          if (e instanceof RequestError && e.code === "stale") {
            // The game moved on; the next update shows where things stand.
            this.results.push({ type: "tool_result", callId: call.id, content: "The game changed before your move landed; see the next update." });
            return;
          }
        }
      }
    }
    this.host.log("act", { op: act.op, say: act.say, failed, notes });
    if (failed) {
      this.results.push({ type: "tool_result", callId: call.id, content: [`Not accepted: ${failed}`, ...notes].join(" "), isError: true });
      if (moves.length && attempt < MAX_ATTEMPTS) return this.think(new Set(["retry"]), attempt + 1);
      if (moves.length) this.standIn(`its moves weren't accepted (${failed})`);
      return;
    }
    this.results.push({ type: "tool_result", callId: call.id, content: notes.join(" ") || "Passed." });
  }

  /** Its own move right now, as far as it can tell. */
  private myMove(): boolean {
    const game = this.host.snapshot().game;
    return !!game && gameMoves(game.legalOps ?? []).length > 0;
  }

  /**
   * The Easy bot makes this move instead, after its usual moment's thought, and the
   * owner can see that it did and why.
   */
  private standIn(why: string) {
    const version = this.host.snapshot().game?.version;
    this.host.log("stand-in", { why, version });
    this.host.standIn(why);
    this.host.activity("Playing without AI");
    const [min, max] = STAND_IN_MS;
    const timer = setTimeout(() => {
      this.timers.delete("standIn");
      this.host.activity(null);
      const game = this.host.snapshot().game;
      if (this.stopped || game?.version !== version) return;
      const op = this.host.easyMove();
      if (op != null) void this.host.sendOp(op, version).catch(() => {});
    }, min + Math.floor(Math.random() * (max - min)));
    this.timers.set("standIn", timer);
  }

  private llm(): Promise<LLMClient> {
    const id = this.setup.connectionId;
    if (this.client?.connectionId !== id) {
      const connection = getConnection(id);
      this.client = { connectionId: id, llm: connection ? clientFor(connection) : Promise.reject(new Error("No such connection.")) };
    }
    return this.client.llm;
  }
}
