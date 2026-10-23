/**
 * Your bots, per room, kept in localStorage like your own identity: each has its own
 * secret (so its own player id) and plays from this browser while you have the room open.
 */
import { useMemo, useSyncExternalStore } from "react";
import { COLOR_COUNT } from "../../shared/colors";
import { playerIdFromSecret } from "../../shared/playerId";
import { MAX_BOTS_PER_PLAYER, sanitizeName } from "../../shared/protocol";
import { newSecret } from "../identity";
import type { Effort } from "../llm/types";
import { storage } from "../storage";

/** "easy" is the built-in bot, without AI; "ai" plays with one of your AI connections (see /settings). */
export type BotLevel = "easy" | "ai";

/** What a bot is: everything you choose when adding or editing one. */
export interface BotSetup {
  name: string;
  color: number;
  level: BotLevel;
  /** For AI bots: which of your AI keys it uses, */
  connectionId?: string;
  /** with which of its models, */
  model?: string;
  /** thinking how hard (low when unset). */
  effort?: Effort;
  /** For AI bots: how it talks and plays, in your words. */
  persona?: string;
}

export interface BotRecord extends BotSetup {
  /** Local id; the room knows the bot by the player id derived from `secret`. */
  id: string;
  roomId: string;
  secret: string;
  /** What the room calls it (derived from the secret). */
  playerId: string;
  addedAt: string;
  /** Tokens an AI bot has used, all told. */
  usage?: { input: number; cachedInput: number; output: number; calls: number };
  /** Why an AI bot last couldn't reach its model, until it next can. */
  error?: string;
  /** Moves the built-in bot made for an AI bot, and why the last one was. */
  standIns?: { count: number; lastWhy: string; lastAt: string };
  /**
   * You removed it, and it's leaving the room. The record (with the bot's secret) is kept
   * until the room confirms, so a removal made offline still happens later.
   */
  removing?: true;
}

const KEY = "gg.bots";
const EVENT = "gg:bots";

const NAMES = ["Beep", "Boop", "Sprocket", "Gizmo", "Widget", "Rivet", "Servo", "Pixel", "Bolt", "Dynamo", "Tinker", "Cogsworth"];

let cache: { raw: string | null; list: BotRecord[] } = { raw: null, list: [] };

export function getBots(): BotRecord[] {
  const raw = storage.get(KEY);
  if (raw !== cache.raw) {
    let list: BotRecord[] = [];
    try {
      const parsed: unknown = raw ? JSON.parse(raw) : [];
      if (Array.isArray(parsed)) list = (parsed as BotRecord[]).filter((b) => typeof b?.secret === "string" && typeof b.roomId === "string" && typeof b.playerId === "string");
    } catch {
      // Unreadable: start over rather than break the page.
    }
    cache = { raw, list };
  }
  return cache.list;
}

function save(list: BotRecord[]) {
  storage.set(KEY, JSON.stringify(list));
  window.dispatchEvent(new Event(EVENT));
}

/** A name and color for a new bot, unlike anyone's already in the room. */
export function suggestBot(taken: { names: string[]; colors: number[] }): { name: string; color: number } {
  const pick = <T,>(options: T[], fallback: T) => options[Math.floor(Math.random() * options.length)] ?? fallback;
  const names = new Set(taken.names.map((n) => n.toLowerCase()));
  const colors = new Set(taken.colors);
  return {
    name: pick(
      NAMES.filter((n) => !names.has(n.toLowerCase())),
      `Bot ${names.size + 1}`,
    ),
    color: pick(
      Array.from({ length: COLOR_COUNT }, (_, i) => i).filter((c) => !colors.has(c)),
      0,
    ),
  };
}

/** A new bot for a room; null if you have as many there as you can. */
export async function addBot(roomId: string, setup: BotSetup): Promise<BotRecord | null> {
  if (getBots().filter((b) => b.roomId === roomId).length >= MAX_BOTS_PER_PLAYER) return null;
  const secret = newSecret();
  const bot: BotRecord = {
    ...clean(setup),
    id: crypto.randomUUID(),
    roomId,
    secret,
    playerId: await playerIdFromSecret(secret),
    addedAt: new Date().toISOString(),
  };
  save([...getBots(), bot]);
  return bot;
}

/** Change a bot; the tab playing it passes a new name or color on to the room. */
export function updateBot(id: string, setup: BotSetup) {
  patchBot(id, { ...clean(setup), error: undefined });
}

/** Count the tokens an AI bot's call used. */
export function addBotUsage(id: string, u: { inputTokens: number; outputTokens: number; cachedInputTokens?: number }) {
  const bot = getBots().find((b) => b.id === id);
  const usage = bot?.usage ?? { input: 0, cachedInput: 0, output: 0, calls: 0 };
  patchBot(id, {
    usage: { input: usage.input + u.inputTokens, cachedInput: usage.cachedInput + (u.cachedInputTokens ?? 0), output: usage.output + u.outputTokens, calls: usage.calls + 1 },
    error: undefined,
  });
}

export function addBotStandIn(id: string, why: string) {
  const count = (getBots().find((b) => b.id === id)?.standIns?.count ?? 0) + 1;
  patchBot(id, { standIns: { count, lastWhy: why, lastAt: new Date().toISOString() } });
}

export function setBotError(id: string, error: string | undefined) {
  if (getBots().find((b) => b.id === id)?.error !== error) patchBot(id, { error });
}

function patchBot(id: string, patch: Partial<BotRecord>) {
  save(getBots().map((b) => (b.id === id ? { ...b, ...patch } : b)));
}

function clean(setup: BotSetup): BotSetup {
  const ai = setup.level === "ai" && setup.connectionId;
  return {
    name: sanitizeName(setup.name),
    color: setup.color,
    level: ai ? "ai" : "easy",
    ...(ai
      ? {
          connectionId: setup.connectionId,
          ...(setup.model ? { model: setup.model } : {}),
          effort: setup.effort ?? "low",
          persona: setup.persona?.trim().slice(0, 300) || undefined,
        }
      : {}),
  };
}

/** Take a bot out of the room for good. Whichever tab runs it does that, then forgets it. */
export function removeBot(id: string) {
  patchBot(id, { removing: true });
}

/** The room has let the bot go: forget it. */
export function forgetBot(id: string) {
  save(getBots().filter((b) => b.id !== id));
}

export function subscribeBots(cb: () => void) {
  window.addEventListener("storage", cb);
  window.addEventListener(EVENT, cb);
  return () => {
    window.removeEventListener("storage", cb);
    window.removeEventListener(EVENT, cb);
  };
}

export function useBots(roomId: string): BotRecord[] {
  const all = useSyncExternalStore(subscribeBots, getBots);
  return useMemo(() => all.filter((b) => b.roomId === roomId), [all, roomId]);
}
