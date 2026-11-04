import { describe, expect, it } from "vitest";
import { SHARDS } from "./conformance";
import { gameMetas } from "./metas";
import { games } from "./registry";

describe("game metas", () => {
  it("lists every registered game, for things that don't load the engines", () => {
    expect(gameMetas.map((m) => m.id).sort()).toEqual(Object.keys(games).sort());
  });
});

describe("conformance", () => {
  it("has a test file for each shard, so every game is checked", () => {
    const files = Object.keys(import.meta.glob("./conformance.*.test.ts")).sort();
    expect(files).toEqual(Array.from({ length: SHARDS }, (_, i) => `./conformance.${i + 1}.test.ts`));
  });
});
