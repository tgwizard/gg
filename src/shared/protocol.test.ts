import { describe, expect, it } from "vitest";
import { MAX_NAME_LENGTH, sanitizeChat, sanitizeName } from "./protocol";

describe("sanitizeName", () => {
  it("collapses whitespace and trims", () => {
    expect(sanitizeName("  Ada \n  Lovelace ")).toBe("Ada Lovelace");
  });

  it("strips invisible and direction-flipping characters", () => {
    expect(sanitizeName("Ad​a")).toBe("Ada");
    expect(sanitizeName("‮adA")).toBe("adA");
    expect(sanitizeName("⁦Bob⁩﻿")).toBe("Bob");
    expect(sanitizeName("​‍")).toBe("Anonymous");
  });

  it("keeps real non-ASCII names and emoji", () => {
    expect(sanitizeName("Åsa 🎲")).toBe("Åsa 🎲");
    expect(sanitizeName("محمد")).toBe("محمد");
  });

  it("caps the length", () => {
    expect(sanitizeName("x".repeat(100))).toHaveLength(MAX_NAME_LENGTH);
  });
});

describe("sanitizeChat", () => {
  it("strips bidi overrides", () => {
    expect(sanitizeChat("  gg ‮wp ")).toBe("gg wp");
  });
});
