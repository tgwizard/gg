import { describe, expect, it } from "vitest";
import { ipKey } from "./ip";

describe("ipKey", () => {
  it("keeps IPv4 as-is", () => {
    expect(ipKey("203.0.113.9")).toBe("203.0.113.9");
  });

  it("groups IPv6 by /64, however it's written", () => {
    const a = ipKey("2001:db8:abcd:12:1:2:3:4");
    expect(a).toBe("2001:db8:abcd:12::/64");
    expect(ipKey("2001:0db8:abcd:0012:ffff:ffff:ffff:ffff")).toBe(a);
    expect(ipKey("2001:db8:abcd:12::1")).toBe(a);
    expect(ipKey("2001:DB8:ABCD:12::9%eth0")).toBe(a);
    expect(ipKey("2001:db8::1")).toBe("2001:db8:0:0::/64");
    expect(ipKey("::1")).toBe("0:0:0:0::/64");
    expect(ipKey("2001:db8:abcd:13::1")).not.toBe(a);
  });
});
