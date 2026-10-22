import { useSyncExternalStore } from "react";

/** Whether a media query matches, kept up to date. */
export function useMedia(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mql = matchMedia(query);
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    },
    () => matchMedia(query).matches,
  );
}

/** Phone-sized screens, where tables turn tall and cards shrink. */
export const useNarrow = () => useMedia("(max-width: 640px)");
