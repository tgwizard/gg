/**
 * localStorage, falling back to memory when it's unavailable (private modes, blocked
 * storage) or a write fails (a full quota). A key whose write failed is served from
 * memory from then on, so a value just saved is never shadowed by an older one; it
 * lasts as long as the page.
 */
const memory = new Map<string, string | null>();

export const storage = {
  get(key: string): string | null {
    if (memory.has(key)) return memory.get(key)!;
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string) {
    try {
      localStorage.setItem(key, value);
      memory.delete(key);
    } catch {
      if (!memory.has(key)) console.warn(`Couldn't save ${key} in this browser; it's kept until the page closes.`);
      memory.set(key, value);
    }
  },
  remove(key: string) {
    try {
      localStorage.removeItem(key);
      memory.delete(key);
    } catch {
      memory.set(key, null);
    }
  },
  /** Every key there is, saved or only in memory. */
  keys(): string[] {
    let saved: string[] = [];
    try {
      saved = Object.keys(localStorage);
    } catch {
      // unavailable
    }
    return [...new Set([...saved, ...memory.keys()])];
  },
};
