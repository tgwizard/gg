/**
 * Keeping up with deploys. Every welcome carries the server's build (src/shared/build.ts);
 * a page from an older build is stale: its lazily loaded files are gone from the server,
 * and its games may no longer match the server's. Everything that matters lives on the
 * server, so reloading is cheap (you rejoin where you were), and a stale page reloads
 * as soon as it won't interrupt anything:
 *
 *   - when the tab is hidden (you come back to the new version);
 *   - on going to another page in the app (a full page load instead);
 *   - when nothing's going on: no game on or being set up (pages say, with
 *     `useHoldReload`), and nothing being typed or chosen (no text typed into a field,
 *     no dialog open).
 *
 * Until then, the room says an update is ready, with a Reload button, and a game whose
 * rules changed shows that instead of the game (`gameOutdated`). It reloads once per
 * server build: if the page is still stale after that (the old page served a moment
 * longer while a deploy spreads), it waits to be asked.
 */
import { useEffect, useSyncExternalStore } from "react";
import { BUILD, type BuildInfo } from "../shared/build";
import { devLog } from "./devlog";

let server: BuildInfo | null = null;
const listeners = new Set<() => void>();
let holds = 0;
let timer: ReturnType<typeof setInterval> | undefined;
const RELOADED_KEY = "gg.reloadedFor";

/** What a server said its build is (from a welcome). */
export function noteServerBuild(build: BuildInfo | undefined) {
  if (!build || (server?.id === build.id && JSON.stringify(server.games) === JSON.stringify(build.games))) return;
  server = build;
  for (const l of listeners) l();
  if (isStale()) {
    devLog("update", "page", "stale", { page: BUILD.id, server: build.id });
    timer ??= setInterval(check, 2_000);
    check();
  }
}

/**
 * After a file failed to load: whether that's because the site has changed since this
 * page loaded (the home page no longer names this page's script), so only a reload
 * helps. If so, the page is stale from now on.
 */
export async function checkSiteUpdated(): Promise<boolean> {
  if (isStale()) return true;
  const mine = document.querySelector<HTMLScriptElement>('script[type="module"][src*="/assets/"]')?.getAttribute("src");
  if (!mine) return false; // dev: no built scripts
  let theirs: string | undefined;
  try {
    const html = await (await fetch("/", { cache: "no-store" })).text();
    if (html.includes(mine)) return false;
    theirs = html.match(/<script[^>]+src="([^"]*\/assets\/[^"]+)"/)?.[1];
  } catch {
    return false;
  }
  // Named after the site's script, so the next deploy found this way is another update.
  if (!isStale()) noteServerBuild({ id: `site:${theirs ?? Date.now()}`, games: server?.games ?? BUILD.games });
  return true;
}

export function isStale(): boolean {
  return !!server && server.id !== BUILD.id;
}

/** The server plays `gameId` by rules this page doesn't have: it can't play it safely. */
export function gameOutdated(gameId: string): boolean {
  const theirs = server?.games[gameId];
  return theirs !== undefined && theirs !== BUILD.games[gameId];
}

/** Whether this page is stale, for showing it. */
export function useStale(): boolean {
  return useSyncExternalStore(subscribe, isStale);
}

/** Whether the running game changed under this page. */
export function useGameOutdated(gameId: string): boolean {
  return useSyncExternalStore(subscribe, () => gameOutdated(gameId));
}

/** While `hold`, a stale page waits for the tab to be hidden (or a press) to reload: a game is on. */
export function useHoldReload(hold: boolean) {
  useEffect(() => {
    if (!hold) return;
    holds++;
    return () => {
      holds--;
      check();
    };
  }, [hold]);
}

/** Reload now (the Reload button), or for a stale page, load `path` in full rather than in place. */
export function reloadNow() {
  location.reload();
}

/** For navigation: true if it went to `path` with a full page load (the page is stale). */
export function loadInFull(path: string): boolean {
  if (!isStale() || reloadedAlready()) return false;
  markReloaded();
  location.assign(path);
  return true;
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

function check() {
  if (!isStale() || reloadedAlready()) return;
  const hidden = document.visibilityState === "hidden";
  if (!hidden && (holds > 0 || busy())) return;
  if (hidden && typing()) return;
  markReloaded();
  devLog("update", "page", hidden ? "reloading while hidden" : "reloading while idle");
  location.reload();
}

if (typeof document !== "undefined") document.addEventListener("visibilitychange", () => check());

/** Something's being typed or chosen right now. */
function busy(): boolean {
  const active = document.activeElement;
  if (active instanceof HTMLElement && active.matches("input, textarea, select, [contenteditable]")) return true;
  return !!document.querySelector('[role="dialog"]') || typing();
}

/** Text typed into a field, which a reload would lose. */
function typing(): boolean {
  return [...document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("textarea, input:not([type]), input[type=text], input[type=search]")].some(
    (el) => !el.readOnly && el.value.trim() !== "",
  );
}

/** Reloaded once for this server build already (it's still stale: wait to be asked). */
function reloadedAlready(): boolean {
  try {
    return sessionStorage.getItem(RELOADED_KEY) === server?.id;
  } catch {
    return false;
  }
}

function markReloaded() {
  try {
    sessionStorage.setItem(RELOADED_KEY, server!.id);
  } catch {
    // Without storage, at worst it reloads once more.
  }
}
