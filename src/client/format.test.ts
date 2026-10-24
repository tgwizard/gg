import { describe, expect, it } from "vitest";
import { formatDateTime, formatTime, formatZone } from "./format";

describe("time formatting", () => {
  it("uses a 24-hour clock and ISO 8601 dates, in local time", () => {
    const evening = new Date(2026, 9, 22, 21, 7, 33).getTime();
    expect(formatTime(evening)).toBe("21:07");
    expect(formatDateTime(evening)).toBe("2026-10-22 21:07:33");
    expect(formatTime(new Date(2026, 0, 5, 0, 3).getTime())).toBe("00:03");
  });

  it("names the time zone the way people there do, or by its offset", () => {
    const summer = Date.UTC(2026, 6, 1, 12);
    const winter = Date.UTC(2026, 0, 1, 12);
    expect(formatZone(summer, "Europe/Stockholm")).toBe("CEST");
    expect(formatZone(winter, "Europe/Stockholm")).toBe("CET");
    expect(formatZone(summer, "Europe/London")).toBe("BST");
    expect(formatZone(summer, "America/New_York")).toBe("EDT");
    expect(formatZone(summer, "Asia/Tokyo")).toBe("GMT+9");
    expect(formatZone(summer, "UTC")).toBe("UTC");
  });
});
