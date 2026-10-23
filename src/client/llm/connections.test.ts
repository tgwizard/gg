import { describe, expect, it } from "vitest";
import { defaultModel } from "./connections";

const models = (...ids: string[]) => ids.map((id) => ({ id, name: id }));

describe("defaultModel", () => {
  it("starts on the provider's cheapest model, newest of its line", () => {
    expect(defaultModel("meta", models("muse-spark-1.3", "muse-spark-1.3-contributor", "muse-spark-1.2-contributor"))).toBe("muse-spark-1.3-contributor");
    expect(defaultModel("openai", models("gpt-6.1-sol", "gpt-6-sol", "gpt-6-luna", "gpt-5.6-luna", "gpt-5.4-nano"))).toBe("gpt-6-luna");
    expect(defaultModel("anthropic", models("claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5", "claude-haiku-4-5"))).toBe("claude-haiku-5-5");
  });

  it("falls back to the newest model, or nothing", () => {
    expect(defaultModel("openai", models("gpt-6.1-sol", "o4-mini"))).toBe("gpt-6.1-sol");
    expect(defaultModel("meta", [])).toBeUndefined();
  });
});
