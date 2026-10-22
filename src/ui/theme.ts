/**
 * Visual themes. A theme sets `data-theme` (CSS tokens in themes.css) and `data-art` on
 * <html>: "pixel" themes draw tables and pips as pixel art, "smooth" ones use CSS.
 * Picked per browser; `?theme=<id>` in the URL picks one too (handy for screenshots).
 */
import { useSyncExternalStore } from "react";

export const THEMES = [
  { id: "pixel", name: "Pixel", art: "pixel" },
  { id: "family", name: "Family board game", art: "smooth" },
  { id: "minimal", name: "Minimal", art: "smooth" },
  { id: "fantasy", name: "Fantasy", art: "smooth" },
  { id: "neon", name: "Neon", art: "smooth" },
] as const;

export type ThemeId = (typeof THEMES)[number]["id"];
export type Art = (typeof THEMES)[number]["art"];

const KEY = "gg.theme";
const listeners = new Set<() => void>();
let current: ThemeId = initial();

function initial(): ThemeId {
  const valid = (id: string | null): id is ThemeId => THEMES.some((t) => t.id === id);
  const fromUrl = typeof location !== "undefined" ? new URLSearchParams(location.search).get("theme") : null;
  if (valid(fromUrl)) {
    save(fromUrl);
    return fromUrl;
  }
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(KEY);
  } catch {
    // Storage blocked: use the default.
  }
  return valid(stored) ? stored : "pixel";
}

function save(id: ThemeId) {
  try {
    localStorage.setItem(KEY, id);
  } catch {
    // Not remembered; fine.
  }
}

export function applyTheme() {
  const theme = THEMES.find((t) => t.id === current)!;
  document.documentElement.dataset.theme = theme.id;
  document.documentElement.dataset.art = theme.art;
}

export function setTheme(id: ThemeId) {
  current = id;
  save(id);
  applyTheme();
  for (const l of listeners) l();
}

export function useTheme(): { id: ThemeId; art: Art } {
  const id = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
  );
  return { id, art: THEMES.find((t) => t.id === id)!.art };
}
