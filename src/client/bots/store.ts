/**
 * Your bots, per room, kept in localStorage like your own identity: each has its own
 * secret (so its own player id) and plays from this browser while you have the room open.
 */
import { useMemo, useSyncExternalStore } from "react";
import { COLOR_COUNT } from "../../shared/colors";
import { playerIdFromSecret } from "../../shared/playerId";
import { MAX_BOTS_PER_PLAYER, sanitizeName } from "../../shared/protocol";
import { newSecret } from "../identity";
import { storage } from "../storage";

export type BotLevel = "easy";

export interface BotRecord {
  /** Local id; the room knows the bot by the player id derived from `secret`. */
  id: string;
  roomId: string;
  secret: string;
  /** What the room calls it (derived from the secret). */
  playerId: string;
  name: string;
  color: number;
  level: BotLevel;
  addedAt: string;
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

/** A new Easy bot for a room; null if you have as many there as you can. */
export async function addBot(roomId: string, name: string, color: number): Promise<BotRecord | null> {
  if (getBots().filter((b) => b.roomId === roomId).length >= MAX_BOTS_PER_PLAYER) return null;
  const secret = newSecret();
  const bot: BotRecord = {
    id: crypto.randomUUID(),
    roomId,
    secret,
    playerId: await playerIdFromSecret(secret),
    name: sanitizeName(name),
    color,
    level: "easy",
    addedAt: new Date().toISOString(),
  };
  save([...getBots(), bot]);
  return bot;
}

/** Rename or recolor a bot; the tab playing it passes it on to the room. */
export function updateBot(id: string, patch: { name: string; color: number }) {
  save(getBots().map((b) => (b.id === id ? { ...b, name: sanitizeName(patch.name), color: patch.color } : b)));
}

/** Forget a bot. Whichever tab runs it notices, takes it out of the room and stops it. */
export function removeBot(id: string) {
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
