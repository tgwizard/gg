/**
 * Who you are, per browser: a random secret (the server derives your public player
 * id from it) and a display name used in every room. Both live in localStorage.
 */
import { useSyncExternalStore } from "react";
import { sanitizeName } from "../shared/protocol";

const SECRET_KEY = "gg.secret";
const NAME_KEY = "gg.name";
const NAME_EVENT = "gg:name";

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
  window.dispatchEvent(new Event(NAME_EVENT));
}

function subscribe(cb: () => void) {
  // "storage" fires when another tab changes the name.
  window.addEventListener("storage", cb);
  window.addEventListener(NAME_EVENT, cb);
  return () => {
    window.removeEventListener("storage", cb);
    window.removeEventListener(NAME_EVENT, cb);
  };
}

export function useName(): string | null {
  return useSyncExternalStore(subscribe, getName);
}
