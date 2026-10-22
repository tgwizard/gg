import { describe, expect, it } from "vitest";
import { generateRoomCode, normalizeRoomCode, ROOM_CODE_LENGTH, roomCodeFromInput } from "./roomCode";

describe("room codes", () => {
  it("generates codes that are already canonical", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      const code = generateRoomCode();
      expect(code).toHaveLength(ROOM_CODE_LENGTH);
      expect(normalizeRoomCode(code)).toBe(code);
      seen.add(code);
    }
    expect(seen.size).toBe(1000);
  });

  it("forgives case, spacing and look-alike characters", () => {
    expect(normalizeRoomCode("k7qx-m4pz r2")).toBe("K7QXM4PZR2");
    expect(normalizeRoomCode("AB0OIL1XYZ")).toBe("AB00111XYZ");
  });

  it("rejects the wrong length and impossible characters", () => {
    expect(normalizeRoomCode("K7QXM4PZR")).toBeNull();
    expect(normalizeRoomCode("K7QXM4PZR2X")).toBeNull();
    expect(normalizeRoomCode("K7QXM4PZRU")).toBeNull(); // U isn't in the alphabet
    expect(normalizeRoomCode("8e119e85-15bb-4fde-b6eb-0725bcd5c919")).toBeNull();
  });

  it("finds the code in a pasted link", () => {
    expect(roomCodeFromInput("https://gg.tgwizard.com/r/k7qxm4pzr2?x=1")).toBe("K7QXM4PZR2");
    expect(roomCodeFromInput("  k7qxm4pzr2 ")).toBe("K7QXM4PZR2");
    expect(roomCodeFromInput("hello")).toBeNull();
  });
});
