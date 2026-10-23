/**
 * The contract every game implements. Game logic is server-authoritative and runs
 * inside the room's Durable Object; clients only ever see `view(state, viewer)`.
 *
 * A game is a deterministic-ish state machine:
 *   - `create` builds the initial state from a validated config.
 *   - `apply` validates and applies an op from an actor (a human or, later, a bot).
 *   - `view` redacts the state for one viewer. Anything secret (decks, other
 *     players' hands) must be stripped here: the full state never leaves the server.
 *   - `players` / `waitingOn` tell the room who is playing and whose move it is.
 *   - `legalOps` lists what a player could do now (bots act from it; the shared
 *     conformance tests fuzz every game with it).
 *   - `bot` plays the game without AI. Table moves (sitting down, sitting out,
 *     starting) are built from `kit/lobby` and handled for every game alike; the
 *     game's bot only picks among its own moves.
 *   - `nextDeadline`/`onDeadline` drive timers (turn clocks, delays between hands),
 *     backed by a Durable Object alarm. A deadline that has passed is applied before
 *     any later op, so a move can't beat its clock by arriving before the alarm.
 *   - `removePlayer` takes someone out for good (a removed bot), so nobody holds a
 *     seat in a game they've left.
 *
 * `apply` and `onDeadline` receive a private copy of the state and may mutate it
 * freely; throwing a GameError rejects the op and discards the mutations. State
 * must be plain JSON (it's stored and structuredClone'd).
 *
 * Shared building blocks for seats and timers live in `./kit`. Every registered
 * game must pass `conformance.test.ts`.
 */
import type { z } from "zod";

export class GameError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export interface GameContext {
  /** Server time in ms. Use this rather than Date.now() so logic is testable. */
  now: number;
  /** Cryptographically secure integer in [0, maxExclusive). */
  randomInt(maxExclusive: number): number;
  /** Current display name for a player id. */
  nameOf(playerId: string): string;
  /** Post a message from the game into the room chat. */
  announce(text: string): void;
}

export interface GameMeta {
  id: string;
  name: string;
  tagline: string;
  minPlayers: number;
  maxPlayers: number;
  /**
   * How to play, shown in the game's help and given to AI bots. Plain text:
   * paragraphs, and lines starting with "- " as bullets.
   */
  rules: string;
  /** For AI bots only: how the game's view and moves are written (coordinates, card codes). */
  botNotes?: string;
}

export interface GameDefinition<State = unknown, Op = unknown, View = unknown, Config = unknown> {
  meta: GameMeta;
  configSchema: z.ZodType<Config>;
  opSchema: z.ZodType<Op>;
  create(config: Config, ctx: GameContext): State;
  apply(state: State, actor: string, op: Op, ctx: GameContext): void;
  view(state: State, viewer: string): View;
  /** Player ids taking part (e.g. seated). The room lets these, or the game's starter, end the game. */
  players(state: State): string[];
  /**
   * `player` is gone for good: give up their place as if they'd left the table. Called
   * only for someone in `players`; afterwards they must no longer be.
   */
  removePlayer(state: State, player: string, ctx: GameContext): void;
  /**
   * Ops that only change the actor's own part of the game (arranging your own fleet),
   * so they needn't be made against the latest version: the room accepts them even if
   * someone else moved in the meantime. `apply` still checks they're allowed now.
   */
  concurrentOp?(op: Op): boolean;
  /** Player ids the game is waiting on (turn indicator; later: what bots react to). */
  waitingOn(state: State): string[];
  /**
   * Ops `player` could legally make right now; every one must be accepted by `apply`.
   * For open-ended ops (bet sizes) a representative sample is fine. Bots are sent
   * this list, so it must not depend on anything `player` can't know.
   */
  legalOps(state: State, player: string): Op[];
  /** Must make progress: after onDeadline, the deadline moves later or goes away. */
  nextDeadline?(state: State): number | null;
  onDeadline?(state: State, ctx: GameContext): void;
  /** Invariants the conformance fuzzer checks after every step; throw to fail. */
  checkInvariants?(state: State): void;
  bot: GameBot<View, Op>;
}

/** How a bot plays a game. Bots submit ops through the same `apply` path as humans. */
export interface GameBot<View, Op> {
  /**
   * The built-in bot, which needs no AI: pick one of `ops` (the legal game moves right
   * now, table moves left out) or null to wait. It decides from `view` alone, like a
   * person at the table would. Starting games is left to people.
   *
   * It runs in the browser, on the page, so it should decide within a few hundred ms.
   * A bot that searches cuts its search short when `quick` is set (tests and set-up
   * positions, which play thousands of moves).
   */
  easy(view: View, ops: Op[], rand: (maxExclusive: number) => number, opts?: BotOptions): Op | null;
}

export interface BotOptions {
  /** Decide fast rather than well. */
  quick?: boolean;
}

export type AnyGameDefinition = GameDefinition<any, any, any, any>;
