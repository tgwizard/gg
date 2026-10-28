import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { games as registered } from "../src/games/registry";
import { buildInfo, gameVersions } from "./build-info";

function tree(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "gg-games-"));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  return dir;
}

const games = {
  "types.ts": "contract",
  "kit/lobby.ts": "seats",
  "kit/ui/Cards.tsx": "cards",
  "chess/index.ts": "def",
  "chess/engine.ts": "rules",
  "chess/meta.ts": "name",
  "chess/bot.ts": "bot",
  "chess/rules.test.ts": "test",
  "chess/ui/Board.tsx": "board",
  "go/index.ts": "def",
  "go/engine.ts": "rules",
  "go/meta.ts": 'export const goMeta = {\n  id: "weiqi",\n};',
};

describe("build info", () => {
  it("versions each game by what server and page must agree on, not how it's drawn", () => {
    const before = gameVersions(tree(games));
    // By the id the game registers as, which can differ from its folder.
    expect(Object.keys(before)).toEqual(["chess", "weiqi"]);
    expect(before.chess).not.toBe(before.weiqi);
    // Drawing, naming, testing and the bot don't change what's agreed on.
    for (const file of ["chess/ui/Board.tsx", "kit/ui/Cards.tsx", "chess/meta.ts", "chess/bot.ts", "chess/rules.test.ts"]) {
      expect(gameVersions(tree({ ...games, [file]: "changed" })), file).toEqual(before);
    }
    // A game's own rules change only that game; the kit or the contract changes every game.
    const engine = gameVersions(tree({ ...games, "chess/engine.ts": "new rules" }));
    expect(engine.chess).not.toBe(before.chess);
    expect(engine.weiqi).toBe(before.weiqi);
    for (const file of ["kit/lobby.ts", "types.ts"]) {
      const changed = gameVersions(tree({ ...games, [file]: "changed" }));
      expect(changed.chess).not.toBe(before.chess);
      expect(changed.weiqi).not.toBe(before.weiqi);
    }
  });

  it("tells two builds of the same code apart, and knows every real game", () => {
    const a = buildInfo(process.cwd(), new Date("2026-10-28T10:00:00Z"));
    const b = buildInfo(process.cwd(), new Date("2026-10-28T10:00:01Z"));
    expect(a.id).not.toBe(b.id);
    expect(a.games).toEqual(b.games);
    expect(Object.keys(a.games).sort()).toEqual(Object.keys(registered).sort());
  });
});
