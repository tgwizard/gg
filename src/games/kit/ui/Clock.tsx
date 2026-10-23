import { useEffect, useRef, useState } from "react";
import "./kit.css";

/** Two players' clocks, as games send them: milliseconds left as of `since`, and whose is running. */
export type Clocks<C extends string> = Record<C, number> & { since: number; running: C | null };

/** A game clock (chess, Othello): minutes and seconds, tenths in the last ten seconds. */
export function Clock<C extends string>({ clock, side, serverNow, testId }: { clock: Clocks<C>; side: C; serverNow: number; testId?: string }) {
  const running = clock.running === side;
  // serverNow ticks four times a second; in the last seconds, count between ticks too.
  const base = useRef({ serverNow, at: Date.now() });
  if (base.current.serverNow !== serverNow) base.current = { serverNow, at: Date.now() };
  const [, redraw] = useState(0);
  const now = serverNow + (running ? Date.now() - base.current.at : 0);
  const left = Math.max(0, (clock[side] as number) - (running ? now - clock.since : 0));
  const fast = running && left < 10_000;
  useEffect(() => {
    if (!fast) return;
    const t = setInterval(() => redraw((n) => n + 1), 100);
    return () => clearInterval(t);
  }, [fast]);
  return (
    <div className={`game-clock ${running ? "running" : ""} ${running && left < 20_000 ? "low" : ""} ${left === 0 ? "flagged" : ""}`} role="timer" data-testid={testId}>
      {formatClock(left)}
    </div>
  );
}

export function formatClock(ms: number): string {
  if (ms < 10_000) return `0:0${Math.floor(ms / 1000)}.${Math.floor((ms % 1000) / 100)}`;
  const s = Math.ceil(ms / 1000);
  const [h, m, sec] = [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60];
  const two = (n: number) => String(n).padStart(2, "0");
  return h ? `${h}:${two(m)}:${two(sec)}` : `${m}:${two(sec)}`;
}
