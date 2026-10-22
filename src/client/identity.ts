/**
 * Who you are, per browser: a random secret (the server derives your public player
 * id from it), and your profile (display name and preferred color) used in every
 * room. All of it lives in localStorage.
 */
import { useSyncExternalStore } from "react";
import { COLOR_COUNT, isColor } from "../shared/colors";
import { sanitizeName } from "../shared/protocol";

const SECRET_KEY = "gg.secret";
const NAME_KEY = "gg.name";
const COLOR_KEY = "gg.color";
const PROFILE_EVENT = "gg:profile";

const memory = new Map<string, string>(); // fallback when storage is unavailable

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return memory.get(key) ?? null;
  }
}

function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    memory.set(key, value);
  }
}

export function getSecret(): string {
  let secret = read(SECRET_KEY);
  if (!secret) {
    const bytes = crypto.getRandomValues(new Uint8Array(24));
    secret = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
    write(SECRET_KEY, secret);
  }
  return secret;
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
