/**
 * Links to /try scenarios: a game set up at an interesting moment (often its end),
 * in a new practice room with Easy bots. See "Practice rooms" in docs/ARCHITECTURE.md.
 *
 *   pnpm scenario                        every scenario, with its link
 *   pnpm scenario chess                  one game's
 *   pnpm scenario chess mate-in-one      one link
 *     --open                             open it (or /try) in the default browser
 *     --base http://localhost:5312       another local server (default http://localhost:5311; /try is dev-only)
 */
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { runnerImport } from "vite";
import type { scenarios as Scenarios } from "../src/games/scenarios.ts";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { open: { type: "boolean", default: false }, base: { type: "string", default: "http://localhost:5311" } },
});
const [gameId, scenarioId] = positionals;
const base = values.base.replace(/\/+$/, "");

// The games are written for the bundler (extensionless imports), so Vite loads them.
const path = fileURLToPath(new URL("../src/games/scenarios.ts", import.meta.url));
const { module } = await runnerImport<{ scenarios: typeof Scenarios }>(path, { configFile: false, logLevel: "error" });
const all = module.scenarios;

if (gameId && !all[gameId]) fail(`No game "${gameId}". Games: ${Object.keys(all).join(", ")}.`);
const list = gameId ? { [gameId]: all[gameId]! } : all;
let link = `${base}/try`;
if (scenarioId) {
  const s = all[gameId!]!.find((x) => x.id === scenarioId);
  if (!s) fail(`No scenario "${scenarioId}" for ${gameId}. Scenarios: ${all[gameId!]!.map((x) => x.id).join(", ")}.`);
  link = `${base}/try/${gameId}/${s.id}`;
  console.log(link);
} else {
  for (const [id, scenarios] of Object.entries(list)) {
    console.log(`\n${id}`);
    for (const s of scenarios) console.log(`  ${s.id.padEnd(14)} ${base}/try/${id}/${s.id}\n  ${"".padEnd(14)} \x1b[2m${s.description}\x1b[0m`);
  }
  console.log();
}
if (values.open) execFileSync(process.platform === "darwin" ? "open" : "xdg-open", [link]);

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}
