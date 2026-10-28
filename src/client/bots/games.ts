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
