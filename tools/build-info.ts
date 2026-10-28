/**
 * What a build is, stamped into the page and the Worker alike (see vite.config.ts and
 * src/shared/build.ts), so a page can tell it's older than the server it talks to.
 *
 *   - `id`: this build (commit and time, so two builds of one commit differ too).
 *   - `games`: per game, a hash of what the server and the page must agree on to play
 *     it: the game's rules and views, not how they're drawn. That's the game's folder
 *     without `ui/`, its tests, its meta (name, rules text), bot and set-ups for practice,
 *     plus the shared kit (also without its `ui/`) and the game contract (`types.ts`). A
 *     page whose hash for a running game differs from the server's can't play it safely.
 */
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import type { BuildInfo } from "../src/shared/build.ts";

/** Not part of what server and page must agree on (see above). */
const NOT_CONTRACT = /(^|\/)ui\/|\.test\.ts$|(^|\/)(meta|bot|scenarios?|testing)\.ts$/;

export function buildInfo(root = process.cwd(), now = new Date()): BuildInfo {
  let commit = "nogit";
  try {
    commit = execSync("git rev-parse --short HEAD", { cwd: root, stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    // Not a checkout: the time alone tells builds apart.
  }
  return { id: `${commit}.${now.toISOString().replace(/[-:]|\.\d+Z$/g, "")}`, games: gameVersions(join(root, "src/games")) };
}

/** Each game's contract hash (see above), by its id, for the games in `gamesDir`. */
export function gameVersions(gamesDir: string): Record<string, string> {
  const shared = [...files(join(gamesDir, "kit"), gamesDir), ...(existsSync(join(gamesDir, "types.ts")) ? ["types.ts"] : [])];
  const games: Record<string, string> = {};
  for (const id of readdirSync(gamesDir).sort()) {
    const dir = join(gamesDir, id);
    if (id === "kit" || !statSync(dir).isDirectory() || !existsSync(join(dir, "index.ts"))) continue;
    const hash = createHash("sha256");
    for (const file of [...shared, ...files(dir, gamesDir)]) hash.update(`${file}\0${readFileSync(join(gamesDir, file))}\0`);
    games[gameId(dir) ?? id] = hash.digest("hex").slice(0, 12);
  }
  return games;
}

/** The id a game registers as (its meta's), which needn't be its folder's name. */
function gameId(dir: string): string | null {
  const meta = join(dir, "meta.ts");
  return existsSync(meta) ? (readFileSync(meta, "utf8").match(/^\s*id:\s*"([^"]+)"/m)?.[1] ?? null) : null;
}

/** Contract files under `dir`, relative to `base`, sorted. */
function files(dir: string, base: string): string[] {
  if (!existsSync(dir)) return [];
  const found: string[] = [];
  const walk = (d: string) => {
    for (const name of readdirSync(d)) {
      const path = join(d, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.tsx?$/.test(name)) found.push(relative(base, path).split("\\").join("/"));
    }
  };
  walk(dir);
  return found.filter((f) => !NOT_CONTRACT.test(f)).sort();
}
