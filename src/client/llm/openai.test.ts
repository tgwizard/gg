import { describe, expect, it } from "vitest";
import { metaTextModels, platformTextModels } from "./openai";

describe("metaTextModels", () => {
  it("keeps the Muse Spark chat models, newest first, plain before contributor", () => {
    const ids = ["muse-wonder-1.0", "sam-3.1", "muse-spark-1.3-contributor", "muse-voice-transcribe-1.0", "muse-spark-1.3", "muse-image-1.0", "muse-spark-1.2", "muse-spark-1.10"];
    expect(metaTextModels(ids)).toEqual(["muse-spark-1.10", "muse-spark-1.3", "muse-spark-1.3-contributor", "muse-spark-1.2"]);
  });
});

describe("platformTextModels", () => {
  it("keeps current text models, newest GPTs first", () => {
    const ids = [
      "o4-mini",
      "o4-mini-2025-04-16",
      "gpt-5.4-mini",
      "gpt-5.4-mini-2026-03-17",
      "gpt-6.1-sol",
      "gpt-5.10",
      "gpt-5.9",
      "gpt-4-0613",
      "gpt-3.5-turbo",
      "gpt-3.5-turbo-instruct",
      "gpt-live-1",
      "gpt-4o-realtime-preview",
      "gpt-image-1",
      "text-embedding-3-large",
      "whisper-1",
    ];
    expect(platformTextModels(ids)).toEqual(["gpt-6.1-sol", "gpt-5.10", "gpt-5.9", "gpt-5.4-mini", "o4-mini"]);
  });
});
