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
 *   - `nextDeadline`/`onDeadline` drive timers (turn clocks, delays between hands),
 *     backed by a Durable Object alarm.
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
  /** Player ids the game is waiting on (turn indicator; later: what bots react to). */
  waitingOn(state: State): string[];
  /**
   * Ops `player` could legally make right now; every one must be accepted by `apply`.
   * For open-ended ops (bet sizes) a representative sample is fine.
   */
  legalOps(state: State, player: string): Op[];
  /** Must make progress: after onDeadline, the deadline moves later or goes away. */
  nextDeadline?(state: State): number | null;
  onDeadline?(state: State, ctx: GameContext): void;
  /** Invariants the conformance fuzzer checks after every step; throw to fail. */
  checkInvariants?(state: State): void;
  /**
   * Future bot support: describe a player's view and legal ops in a form an LLM can
   * act on. Bots will submit ops through the same `apply` path as humans.
   */
  describeForBot?(view: View): { situation: string; legalOps: Op[] };
}

export type AnyGameDefinition = GameDefinition<any, any, any, any>;
