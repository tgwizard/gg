import { useEffect, useReducer, useRef, useState } from "react";
import { play } from "../../../ui";
import { reducedMotion } from "../../kit/ui/Flights";
import { nextStop, RIDERS, type Rider, type UnicornView } from "../engine";

/** How long the die tumbles before it shows the roll, and each hop to the next stop after it. */
export const TUMBLE_MS = 900;
export const HOP_MS = 320;

interface Shown {
  at: number;
  riders: Rider[];
  /** Hops so far, so each restarts the hop animation. */
  hops: number;
}

/**
 * The race as it's shown, a little behind the server: a new roll tumbles the die, then the
 * unicorn hops stop by stop along its way (onto the bridge, with all six friends), and
 * whoever it picks up joins it there. Only rolls that arrive live play out; a first view,
 * a refresh or catching up after a reconnect just shows where everyone is.
 */
export function useGallop(view: UnicornView, connected: boolean) {
  const latest = useRef(view);
  latest.current = view;
  const shown = useRef(new Map<string, Shown>());
  const [, render] = useReducer((x: number) => x + 1, 0);
  const [tumbling, setTumbling] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Hops in this gallop: a die never goes past 6, so many more means a move was missed. */
  const run = useRef(0);
  const key = `${view.game}:${view.rolls}`;
  const seen = useRef({ key, connected, game: view.game });

  const snap = () => {
    shown.current = new Map(latest.current.racers.map((r) => [r.playerId, { at: r.at, riders: [...r.riders], hops: shown.current.get(r.playerId)?.hops ?? 0 }]));
  };
  const step = () => {
    let moving = false;
    run.current++;
    for (const r of latest.current.racers) {
      const s = shown.current.get(r.playerId);
      if (!s) {
        shown.current.set(r.playerId, { at: r.at, riders: [...r.riders], hops: 0 });
        continue;
      }
      if (s.at !== r.at) {
        s.at = nextStop(s.at, r.riders.length === RIDERS.length);
        s.hops++;
        moving = true;
        // Lost its way (a move missed): there at once.
        if (run.current > 12) s.at = r.at;
      }
      if (s.at === r.at && s.riders.length !== r.riders.length) {
        const fresh = r.riders.length > s.riders.length;
        s.riders = [...r.riders];
        if (fresh) play("good", 0.05);
      }
    }
    render();
    if (moving) {
      play("hop");
      timer.current = setTimeout(step, HOP_MS);
    } else timer.current = null;
  };
  const stop = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };

  useEffect(() => {
    const before = seen.current;
    seen.current = { key, connected, game: view.game };
    const live = before.connected && connected && before.game === view.game && !reducedMotion();
    if (!live) {
      stop();
      setTumbling(false);
      snap();
      render();
    } else if (key !== before.key) {
      stop();
      setTumbling(true);
      play("dice");
      run.current = 0;
      timer.current = setTimeout(() => {
        setTumbling(false);
        step();
      }, TUMBLE_MS);
    } else if (!timer.current) {
      run.current = 0;
      step();
    }
  }, [view, connected]);
  useEffect(() => stop, []);

  const of = (id: string) => shown.current.get(id);
  const behind = view.racers.some((r) => (of(r.playerId)?.at ?? r.at) !== r.at || (of(r.playerId)?.riders.length ?? r.riders.length) !== r.riders.length);
  return {
    tumbling,
    /** Nothing's on its way: the board shows the race as it is. */
    settled: !tumbling && !behind,
    at: (id: string, fallback: number) => of(id)?.at ?? fallback,
    riders: (id: string, fallback: Rider[]) => of(id)?.riders ?? fallback,
    hops: (id: string) => of(id)?.hops ?? 0,
  };
}
