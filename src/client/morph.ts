import { flushSync } from "react-dom";

/** Run a state change as a view transition where the browser has them (and motion is welcome). */
export function morph(update: () => void) {
  if (!("startViewTransition" in document) || matchMedia("(prefers-reduced-motion: reduce)").matches) return update();
  document.startViewTransition(() => flushSync(update));
}
