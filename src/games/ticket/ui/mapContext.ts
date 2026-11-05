import { createContext, useContext, useEffect, useSyncExternalStore } from "react";
import type { TtrMap } from "../map";
import { mapById, USA } from "../maps";

/** The map the game on screen is played on, for the parts of it that name cities and routes. */
export const MapContext = createContext<TtrMap>(USA);
export const useTtrMap = () => useContext(MapContext);

// The rules (`help`) sit outside the game, so the game says which map is showing.
let shown: string | undefined;
const listeners = new Set<() => void>();

/** The game: this is the map showing (until it's gone). */
export function useShowMap(id: string) {
  useEffect(() => {
    shown = id;
    for (const l of listeners) l();
    return () => {
      if (shown === id) shown = undefined;
      for (const l of listeners) l();
    };
  }, [id]);
}

/** The map showing, or North America when there's no game on screen. */
export function useShownMap(): TtrMap {
  const id = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => shown,
  );
  return mapById(id);
}
