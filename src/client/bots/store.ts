/**
 * Your bots, kept in localStorage like your own identity: each is one player (its own
 * secret, so the same player id everywhere) that you invite into rooms, and that plays
 * from this browser while you have one of those rooms open. Editing a bot changes it
 * in every room; deleting it takes it out of all of them.
 */
import { useMemo, useSyncExternalStore } from "react";
import { COLOR_COUNT } from "../../shared/colors";
import { playerIdFromSecret } from "../../shared/playerId";
import { MAX_BOTS_PER_PLAYER, sanitizeName } from "../../shared/protocol";
import { newSecret } from "../identity";
import { addConnectionUsage, addUsage } from "../llm/connections";
import type { Effort, Usage } from "../llm/types";
import { storage } from "../storage";

/** "easy" is the built-in bot, without AI; "ai" plays with one of your AI connections (see /settings). */
export type BotLevel = "easy" | "ai";

/** What a bot is: everything you choose when making or editing one. */
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
  /** How it talks and plays, in your words: everyone in the room sees it, and AI bots play the part. */
  persona?: string;
}

/** A room a bot has been invited to. */
export interface BotRoom {
  invitedAt: string;
  /**
   * You took it out of the room, and it's leaving. Kept until the room confirms, so a
   * removal made while the room isn't open happens when you're next there.
   */
  removing?: true;
}

export interface BotRecord extends BotSetup {
  id: string;
  secret: string;
  /** What rooms call it (derived from the secret). */
  playerId: string;
  createdAt: string;
  rooms: Record<string, BotRoom>;
  /** Deleted: gone from your bots, and leaving every room it's in; forgotten once it has. */
  deleted?: true;
  /** Tokens an AI bot has used, all told. */
  usage?: Usage;
  /** Why an AI bot last couldn't reach its model, until it next can. */
  error?: string;
  /** Moves the built-in bot made for an AI bot, and why the last one was. */
  standIns?: { count: number; lastWhy: string; lastAt: string };
}

/** As many bots as anyone needs to keep. */
export const MAX_BOTS = 24;

const KEY = "gg.bots";
const EVENT = "gg:bots";

const NAMES = ["Beep", "Boop", "Sprocket", "Gizmo", "Widget", "Rivet", "Servo", "Pixel", "Bolt", "Dynamo", "Tinker", "Cogsworth"];

let cache: { raw: string | null; list: BotRecord[] } = { raw: null, list: [] };

/** Every bot, deleted ones still on their way out of rooms included. */
export function getBots(): BotRecord[] {
  const raw = storage.get(KEY);
  if (raw !== cache.raw) {
    let list: BotRecord[] = [];
    try {
      const parsed: unknown = raw ? JSON.parse(raw) : [];
      if (Array.isArray(parsed)) list = fromOlder(parsed.filter((b) => typeof b?.secret === "string" && typeof b.playerId === "string"));
    } catch {
      // Unreadable: start over rather than break the page.
    }
    cache = { raw, list };
  }
  return cache.list;
}

/**
 * Bots used to be made per room. Each name becomes one bot, kept with the identity it
 * had in its first room; it stays in that room (its namesakes elsewhere are left behind).
 */
function fromOlder(list: (BotRecord & { roomId?: string; addedAt?: string; removing?: true })[]): BotRecord[] {
  if (!list.some((b) => typeof b.roomId === "string")) return list;
  const byName = new Map<string, BotRecord>();
  for (const old of list) {
    if (typeof old.roomId !== "string") {
      byName.set(old.id, old);
      continue;
    }
    if (old.removing || byName.has(old.name.toLowerCase())) continue;
    const { roomId, addedAt, removing: _, ...rest } = old;
    byName.set(old.name.toLowerCase(), { ...rest, createdAt: addedAt ?? new Date().toISOString(), rooms: { [roomId]: { invitedAt: addedAt ?? new Date().toISOString() } } });
  }
  return [...byName.values()];
}

function save(list: BotRecord[]) {
  storage.set(KEY, JSON.stringify(list));
  window.dispatchEvent(new Event(EVENT));
}

/** A name and color for a new bot, unlike your other bots' and anyone's already in the room. */
export function suggestBot(taken: { names: string[]; colors: number[] }): { name: string; color: number } {
  const pick = <T,>(options: T[], fallback: T) => options[Math.floor(Math.random() * options.length)] ?? fallback;
  const mine = getBots().filter((b) => !b.deleted);
  const names = new Set([...taken.names, ...mine.map((b) => b.name)].map((n) => n.toLowerCase()));
  const colors = new Set([...taken.colors, ...mine.map((b) => b.color)]);
  return {
    name: pick(
      NAMES.filter((n) => !names.has(n.toLowerCase())),
      `Bot ${names.size + 1}`,
    ),
    color: pick(
      Array.from({ length: COLOR_COUNT }, (_, i) => i).filter((c) => !colors.has(c)),
      Math.floor(Math.random() * COLOR_COUNT),
    ),
  };
}

/** A new bot of yours; null if you have as many as you can keep. */
export async function createBot(setup: BotSetup): Promise<BotRecord | null> {
  if (getBots().filter((b) => !b.deleted).length >= MAX_BOTS) return null;
  const secret = newSecret();
  const bot: BotRecord = {
    ...clean(setup),
    id: crypto.randomUUID(),
    secret,
    playerId: await playerIdFromSecret(secret),
    createdAt: new Date().toISOString(),
    rooms: {},
  };
  save([...getBots(), bot]);
  return bot;
}

/** Bots of yours in a room (or on their way in or out). */
export const botsIn = (roomId: string, list = getBots()) => list.filter((b) => b.rooms[roomId]);
/** Bots of yours playing in a room (not leaving it). */
export const playingIn = (roomId: string, list = getBots()) => list.filter((b) => b.rooms[roomId] && !b.rooms[roomId].removing && !b.deleted);

/** Bring a bot into a room (the room page plays it). False if you have as many there as you can. */
export function inviteBot(id: string, roomId: string): boolean {
  if (playingIn(roomId).length >= MAX_BOTS_PER_PLAYER) return false;
  save(getBots().map((b) => (b.id === id && !b.deleted ? { ...b, rooms: { ...b.rooms, [roomId]: { invitedAt: b.rooms[roomId]?.invitedAt ?? new Date().toISOString() } } } : b)));
  return true;
}

/** Take a bot out of one room for good (it stays yours). Whichever tab plays it there does the leaving. */
export function removeFromRoom(id: string, roomId: string) {
  save(getBots().map((b) => (b.id === id && b.rooms[roomId] ? { ...b, rooms: { ...b.rooms, [roomId]: { ...b.rooms[roomId], removing: true } } } : b)));
}

/** The room has let the bot go (or is gone): forget it there, and forget a deleted bot that's left everywhere. */
export function leftRoom(id: string, roomId: string) {
  const list = getBots().flatMap((b) => {
    if (b.id !== id) return [b];
    const { [roomId]: _, ...rooms } = b.rooms;
    return b.deleted && !Object.keys(rooms).length ? [] : [{ ...b, rooms }];
  });
  save(list);
}

/** Delete a bot: it leaves every room it's in (as each is next opened), then it's forgotten. */
export function deleteBot(id: string) {
  const list = getBots().flatMap((b) => {
    if (b.id !== id) return [b];
    if (!Object.keys(b.rooms).length) return [];
    const rooms = Object.fromEntries(Object.entries(b.rooms).map(([room, r]) => [room, { ...r, removing: true as const }]));
    return [{ ...b, rooms, deleted: true as const }];
  });
  save(list);
}

/** Change a bot, everywhere; the tabs playing it pass a new name or color on to their rooms. */
export function updateBot(id: string, setup: BotSetup) {
  patchBot(id, { ...clean(setup), error: undefined });
}

/** An AI key is gone: its bots play built-in until given another. */
export function dropConnection(connectionId: string) {
  save(getBots().map((b) => (b.connectionId === connectionId ? { ...b, ...clean({ ...b, level: "easy" }), error: undefined } : b)));
}

/** Count the tokens an AI bot's call used, for the bot and for the key it used. */
export function addBotUsage(id: string, u: { inputTokens: number; outputTokens: number; cachedInputTokens?: number }) {
  const bot = getBots().find((b) => b.id === id);
  patchBot(id, { usage: addUsage(bot?.usage, u), error: undefined });
  if (bot?.connectionId) addConnectionUsage(bot.connectionId, u);
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
    connectionId: ai ? setup.connectionId : undefined,
    model: ai ? setup.model : undefined,
    effort: ai ? (setup.effort ?? "low") : undefined,
    persona: setup.persona?.trim().slice(0, 300) || undefined,
  };
}

export function subscribeBots(cb: () => void) {
  window.addEventListener("storage", cb);
  window.addEventListener(EVENT, cb);
  return () => {
    window.removeEventListener("storage", cb);
    window.removeEventListener(EVENT, cb);
  };
}

/** Your bots (not deleted ones), oldest first. */
export function useMyBots(): BotRecord[] {
  const all = useSyncExternalStore(subscribeBots, getBots);
  return useMemo(() => all.filter((b) => !b.deleted), [all]);
}

/** Your bots in a room, including ones on their way out. */
export function useBots(roomId: string): BotRecord[] {
  const all = useSyncExternalStore(subscribeBots, getBots);
  return useMemo(() => botsIn(roomId, all), [all, roomId]);
}
