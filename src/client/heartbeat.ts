/**
 * A heartbeat while your turn's time runs out: from 10 s left, a beat a second, then
 * quicker for the last few. For any game whose clock is the room's `deadline`.
 */
import { useEffect } from "react";
import { play } from "../ui/sound";
import { RACING_MS, URGENT_MS } from "../ui/urgency";

/** With `leftMs` to go: whether to beat now, and how long until the next look (null: time's up). */
export function heartbeatStep(leftMs: number): { beat: boolean; nextMs: number } | null {
  if (leftMs <= 0) return null;
  if (leftMs > URGENT_MS) return { beat: false, nextMs: leftMs - URGENT_MS };
  return { beat: true, nextMs: leftMs <= RACING_MS ? 600 : 1000 };
}

/** Beat while `active` (it's your turn) and the server-time `deadline` is near. */
export function useHeartbeat(active: boolean, deadline: number | null, clockOffset: number) {
  useEffect(() => {
    if (!active || deadline === null) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const look = () => {
      const step = heartbeatStep(deadline - (Date.now() + clockOffset));
      if (!step) return;
      if (step.beat) play("heartbeat");
      timer = setTimeout(look, step.nextMs);
    };
    look();
    return () => clearTimeout(timer);
  }, [active, deadline, clockOffset]);
}
