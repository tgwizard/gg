/**
 * Your bots: players kept in this browser (see ../local), that play by themselves, built
 * in or with one of your AI keys.
 */
import { COLOR_COUNT } from "../../shared/colors";
import { sanitizeName } from "../../shared/protocol";
import { type LocalPlayer, type LocalRoom, localPlayers } from "../local";
import { addConnectionUsage, addUsage } from "../llm/connections";
import type { Effort, Usage } from "../llm/types";

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

export type BotRoom = LocalRoom;

export interface BotRecord extends LocalPlayer, BotSetup {
  /** Tokens an AI bot has used, all told. */
  usage?: Usage;
  /** Why an AI bot last couldn't reach its model, until it next can. */
  error?: string;
  /** Moves the built-in bot made for an AI bot, and why the last one was. */
  standIns?: { count: number; lastWhy: string; lastAt: string };
}

/** As many bots as anyone needs to keep. */
export const MAX_BOTS = 24;

const NAMES = ["Beep", "Boop", "Sprocket", "Gizmo", "Widget", "Rivet", "Servo", "Pixel", "Bolt", "Dynamo", "Tinker", "Cogsworth"];

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

const bots = localPlayers<BotRecord>("gg.bots", fromOlder);

/** Every bot, deleted ones still on their way out of rooms included. */
export const getBots = bots.all;
export const subscribeBots = bots.subscribe;
/** Bots of yours in a room (or on their way in or out). */
export const botsIn = bots.inRoom;
/** Bots of yours playing in a room (not leaving it). */
export const playingIn = bots.playingIn;
/** Bring a bot into a room (the room page plays it). False if you've brought as many there as you can. */
export const inviteBot = bots.invite;
/** Take a bot out of one room for good (it stays yours). Whichever tab plays it there does the leaving. */
export const removeFromRoom = bots.removeFromRoom;
/** The room has let the bot go (or is gone). */
export const leftRoom = bots.leftRoom;
/** Delete a bot: it leaves every room it's in, then it's forgotten. */
export const deleteBot = bots.remove;
/** Your bots (not deleted ones), oldest first. */
export const useMyBots = bots.useMine;
/** Your bots in a room, including ones on their way out. */
export const useBots = bots.useIn;

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
export function createBot(setup: BotSetup): Promise<BotRecord | null> {
  return bots.create(clean(setup), MAX_BOTS);
}

/** Change a bot, everywhere; the tabs playing it pass a new name or color on to their rooms. */
export function updateBot(id: string, setup: BotSetup) {
  bots.patch(id, { ...clean(setup), error: undefined });
}

/** An AI key is gone: its bots play built-in until given another. */
export function dropConnection(connectionId: string) {
  bots.save(getBots().map((b) => (b.connectionId === connectionId ? { ...b, ...clean({ ...b, level: "easy" }), error: undefined } : b)));
}

/** Count the tokens an AI bot's call used, for the bot and for the key it used. */
export function addBotUsage(id: string, u: { inputTokens: number; outputTokens: number; cachedInputTokens?: number }) {
  const bot = getBots().find((b) => b.id === id);
  bots.patch(id, { usage: addUsage(bot?.usage, u), error: undefined });
  if (bot?.connectionId) addConnectionUsage(bot.connectionId, u);
}

export function addBotStandIn(id: string, why: string) {
  const count = (getBots().find((b) => b.id === id)?.standIns?.count ?? 0) + 1;
  bots.patch(id, { standIns: { count, lastWhy: why, lastAt: new Date().toISOString() } });
}

export function setBotError(id: string, error: string | undefined) {
  if (getBots().find((b) => b.id === id)?.error !== error) bots.patch(id, { error });
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
