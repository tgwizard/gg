/** localStorage, falling back to memory when it's unavailable (private modes, blocked storage). */
const memory = new Map<string, string>();

export const storage = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return memory.get(key) ?? null;
    }
  },
  set(key: string, value: string) {
    try {
      localStorage.setItem(key, value);
    } catch {
      memory.set(key, value);
    }
  },
  remove(key: string) {
    try {
      localStorage.removeItem(key);
    } catch {
      memory.delete(key);
    }
  },
};
