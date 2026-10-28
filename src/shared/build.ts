/**
 * Which build this code is, stamped in at build time (see tools/build-info.ts): the
 * Worker sends its own in the welcome, so a page can tell it's older than the server.
 * Dev servers and tests are all "dev", with no game versions, so they always match.
 */
export interface BuildInfo {
  id: string;
  /** Per game, a hash of what server and page must agree on to play it. */
  games: Record<string, string>;
}

declare const __GG_BUILD__: BuildInfo | undefined;

export const BUILD: BuildInfo = typeof __GG_BUILD__ === "object" ? __GG_BUILD__ : { id: "dev", games: {} };
