import { describe, expect, it } from "vitest";
import { formatDateTime, formatTime } from "./format";

describe("time formatting", () => {
  it("uses a 24-hour clock and ISO 8601 dates, in local time", () => {
    const evening = new Date(2026, 9, 22, 21, 7, 33).getTime();
    expect(formatTime(evening)).toBe("21:07");
    expect(formatDateTime(evening)).toBe("2026-10-22 21:07:33");
    expect(formatTime(new Date(2026, 0, 5, 0, 3).getTime())).toBe("00:03");
  });
});
