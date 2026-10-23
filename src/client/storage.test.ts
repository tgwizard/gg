import { afterEach, describe, expect, it, vi } from "vitest";
import { storage } from "./storage";

function fakeLocalStorage(opts: { full?: boolean } = {}) {
  const data = new Map<string, string>();
  const ls = {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => {
      if (opts.full) throw new DOMException("full", "QuotaExceededError");
      data.set(k, v);
    },
    removeItem: (k: string) => void data.delete(k),
  };
  vi.stubGlobal("localStorage", new Proxy(ls, { ownKeys: () => [...data.keys()], getOwnPropertyDescriptor: (_, k) => (data.has(k as string) ? { enumerable: true, configurable: true, value: data.get(k as string) } : undefined) }));
  return { data, ls };
}

afterEach(() => vi.unstubAllGlobals());

describe("storage", () => {
  it("keeps a value whose write failed, even though reads still work", () => {
    const { data } = fakeLocalStorage({ full: true });
    data.set("gg.quota.name", "old");
    storage.set("gg.quota.name", "new");
    expect(storage.get("gg.quota.name")).toBe("new");
    expect(storage.keys()).toContain("gg.quota.name");
    storage.remove("gg.quota.name");
    expect(storage.get("gg.quota.name")).toBeNull();
  });

  it("uses localStorage again once a write succeeds", () => {
    const { data } = fakeLocalStorage();
    storage.set("gg.ok", "1");
    expect(data.get("gg.ok")).toBe("1");
    expect(storage.get("gg.ok")).toBe("1");
  });

  it("falls back to memory when storage is unavailable", () => {
    vi.stubGlobal("localStorage", undefined);
    storage.set("gg.nostorage", "x");
    expect(storage.get("gg.nostorage")).toBe("x");
  });
});
