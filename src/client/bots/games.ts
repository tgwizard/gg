/**
 * The game rules bots play by. They're a separate download (only needed once you have a
 * bot), which can fail: on a bad connection, or after a deploy, when this page's copy of
 * them is gone from the server. A failed load is forgotten, so the next one tries again.
 */
import type { AnyGameDefinition } from "../../games/types";

let loading: Promise<Record<string, AnyGameDefinition>> | null = null;

export function loadGames(): Promise<Record<string, AnyGameDefinition>> {
  loading ??= import("../../games/registry").then(
    (m) => m.games,
    (e: unknown) => {
      loading = null;
      throw e;
    },
  );
  return loading;
}

/**
 * Whether the site has changed since this page loaded (its scripts are gone, so it can't
 * load more of them): only a reload helps then.
 */
export async function siteUpdated(): Promise<boolean> {
  const mine = document.querySelector<HTMLScriptElement>('script[type="module"][src*="/assets/"]')?.getAttribute("src");
  if (!mine) return false; // dev: no built scripts
  try {
    const html = await (await fetch("/", { cache: "no-store" })).text();
    return !html.includes(mine);
  } catch {
    return false;
  }
}
