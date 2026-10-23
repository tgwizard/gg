import { useSyncExternalStore } from "react";

const EVENT = "gg:navigate";

/** `from`: the page to offer a way back to (e.g. the room you opened settings from). */
export function navigate(path: string, from?: string) {
  history.pushState(from ? { from } : null, "", path);
  window.dispatchEvent(new Event(EVENT));
}

function subscribe(cb: () => void) {
  window.addEventListener("popstate", cb);
  window.addEventListener(EVENT, cb);
  return () => {
    window.removeEventListener("popstate", cb);
    window.removeEventListener(EVENT, cb);
  };
}

export function usePath(): string {
  return useSyncExternalStore(subscribe, () => location.pathname);
}

/** Where the current page was opened from, if it said (see `navigate`). */
export function cameFrom(): string | null {
  const from = (history.state as { from?: unknown } | null)?.from;
  return typeof from === "string" ? from : null;
}
