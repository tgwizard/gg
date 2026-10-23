import { useEffect, useRef, useState } from "react";
import "./kit.css";

/** Two players' clocks, as games send them: milliseconds left as of `since`, and whose is running. */
export type Clocks<C extends string> = Record<C, number> & { since: number; running: C | null };

/** Byo-yomi clocks (Go): main time, then `periods` periods of `period` ms each. */
export type ByoYomiClocks<C extends string> = Record<C, { main: number; periods: number }> & { since: number; running: C | null; period: number };

/** Now, by the server's clock: serverNow ticks four times a second, so a running clock counts between ticks too. */
function useClockNow(serverNow: number, running: boolean): number {
  const base = useRef({ serverNow, at: Date.now() });
  if (base.current.serverNow !== serverNow) base.current = { serverNow, at: Date.now() };
  return serverNow + (running ? Date.now() - base.current.at : 0);
}

/** Redraw ten times a second while `fast` (the last seconds, shown in tenths). */
function useFastTicks(fast: boolean) {
  const [, redraw] = useState(0);
  useEffect(() => {
    if (!fast) return;
    const t = setInterval(() => redraw((n) => n + 1), 100);
    return () => clearInterval(t);
  }, [fast]);
}

/** A game clock (chess, Othello): minutes and seconds, tenths in the last ten seconds. */
export function Clock<C extends string>({ clock, side, serverNow, testId }: { clock: Clocks<C>; side: C; serverNow: number; testId?: string }) {
  const running = clock.running === side;
  const now = useClockNow(serverNow, running);
  const left = Math.max(0, (clock[side] as number) - (running ? now - clock.since : 0));
  useFastTicks(running && left < 10_000);
  return (
    <div className={`game-clock ${running ? "running" : ""} ${running && left < 20_000 ? "low" : ""} ${left === 0 ? "flagged" : ""}`} role="timer" data-testid={testId}>
      {formatClock(left)}
    </div>
  );
}

/**
 * A byo-yomi clock: main time with the periods to come underneath ("3×20s"), then, once
 * main time is gone, the period running down and how many are left.
 */
export function ByoYomiClock<C extends string>({ clock, side, serverNow, testId }: { clock: ByoYomiClocks<C>; side: C; serverNow: number; testId?: string }) {
  const running = clock.running === side;
  const now = useClockNow(serverNow, running);
  const { main, periods } = clock[side];
  const elapsed = running ? Math.max(0, now - clock.since) : 0;
  let left: number;
  let periodsLeft = periods;
  const inPeriods = elapsed >= main && periods > 0 && clock.period > 0;
  if (!inPeriods) left = Math.max(0, main - elapsed);
  else {
    const over = elapsed - main;
    periodsLeft = Math.max(0, periods - Math.floor(over / clock.period));
    left = periodsLeft ? clock.period - (over % clock.period) : 0;
  }
  useFastTicks(running && left < 10_000);
  const low = running && (inPeriods ? left < 10_000 : left < 20_000 && !periods);
  const out = left === 0 && periodsLeft === 0;
  return (
    <div className={`game-clock byo ${running ? "running" : ""} ${low ? "low" : ""} ${out ? "flagged" : ""}`} role="timer" data-testid={testId}>
      <span>{formatClock(left)}</span>
      {periods > 0 && clock.period > 0 && (
        <span className="game-clock-periods" title={`${periodsLeft} byo-yomi ${periodsLeft === 1 ? "period" : "periods"} of ${clock.period / 1000} seconds`}>
          {inPeriods ? `byo-yomi · ${periodsLeft} left` : `+ ${periodsLeft}×${clock.period / 1000}s`}
        </span>
      )}
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
