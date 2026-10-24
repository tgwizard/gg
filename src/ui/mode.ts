/**
 * Light or dark. Follows the system until you pick one with the toggle (or ⌃⇧L); your pick is
 * remembered per browser. index.html applies it before first paint to avoid a flash.
 */
import { useSyncExternalStore } from "react";

export type Mode = "light" | "dark";

const KEY = "gg.mode";
const listeners = new Set<() => void>();
const system = matchMedia("(prefers-color-scheme: dark)");
let current: Mode = stored() ?? (system.matches ? "dark" : "light");

function stored(): Mode | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : null;
  } catch {
    return null;
  }
}

function set(mode: Mode) {
  current = mode;
  applyMode();
  for (const l of listeners) l();
}

system.addEventListener("change", (e) => {
  if (!stored()) set(e.matches ? "dark" : "light");
});

/**
 * The keys that switch between light and dark, as shown in tooltips. ⌘ works too, but
 * Chrome on a Mac keeps ⇧⌘L for itself, so Control is the one to show.
 */
export const MODE_SHORTCUT = /Mac|iPhone|iPad/.test(navigator.platform) ? "⌃⇧L" : "Ctrl+Shift+L";

// Capturing, so a game's own key handling can't swallow it first.
window.addEventListener(
  "keydown",
  (e) => {
    if (e.code === "KeyL" && e.shiftKey && (e.metaKey || e.ctrlKey) && !e.altKey && !e.repeat) {
      e.preventDefault();
      toggleMode();
    }
  },
  { capture: true },
);

export function applyMode() {
  document.documentElement.dataset.mode = current;
}

export function toggleMode() {
  const next = current === "dark" ? "light" : "dark";
  try {
    localStorage.setItem(KEY, next);
  } catch {
    // Not remembered; fine.
  }
  set(next);
}

export function useMode(): Mode {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
  );
}
