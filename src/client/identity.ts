/**
 * Who you are, per browser: a random secret (the server derives your public player
 * id from it), and your profile (display name and preferred color) used in every
 * room. All of it lives in localStorage.
 */
import { useSyncExternalStore } from "react";
import { COLOR_COUNT, isColor } from "../shared/colors";
import { sanitizeName } from "../shared/protocol";
import { storage } from "./storage";

const SECRET_KEY = "gg.secret";
const NAME_KEY = "gg.name";
const COLOR_KEY = "gg.color";
const PROFILE_EVENT = "gg:profile";

const read = storage.get;
const write = storage.set;

export function getSecret(): string {
  let secret = read(SECRET_KEY);
  if (!secret) {
    secret = newSecret();
    write(SECRET_KEY, secret);
  }
  return secret;
}

/** A fresh random secret (yours, or one of your bots'). */
export function newSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function getName(): string | null {
  return read(NAME_KEY);
}

export function saveName(raw: string) {
  write(NAME_KEY, sanitizeName(raw));
  window.dispatchEvent(new Event(PROFILE_EVENT));
}

/** Your preferred color. New players get a random one, so rooms rarely start with clashes. */
export function getColor(): number {
  const stored = Number(read(COLOR_KEY));
  if (read(COLOR_KEY) !== null && isColor(stored)) return stored;
  const color = crypto.getRandomValues(new Uint8Array(1))[0]! % COLOR_COUNT;
  write(COLOR_KEY, String(color));
  return color;
}

export function saveColor(color: number) {
  if (!isColor(color)) return;
  write(COLOR_KEY, String(color));
  window.dispatchEvent(new Event(PROFILE_EVENT));
}

/**
 * Forget everything gg keeps in this browser: profile, light/dark, sound, AI keys, bots,
 * players on this device, your rooms, chat waiting to be sent, and the secret behind your
 * player id (so rooms you've been in will see you as someone new).
 */
export function deleteLocalData() {
  for (const key of storage.keys()) storage.remove(key);
  try {
    sessionStorage.clear();
  } catch {
    // Unavailable: nothing kept there either.
  }
}

function subscribe(cb: () => void) {
  // "storage" fires when another tab changes the name.
  window.addEventListener("storage", cb);
  window.addEventListener(PROFILE_EVENT, cb);
  return () => {
    window.removeEventListener("storage", cb);
    window.removeEventListener(PROFILE_EVENT, cb);
  };
}

export function useName(): string | null {
  return useSyncExternalStore(subscribe, getName);
}

export function useColor(): number {
  return useSyncExternalStore(subscribe, getColor);
}
