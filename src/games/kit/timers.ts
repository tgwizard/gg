/**
 * Named deadlines in game state (a turn clock, a pause between rounds, ...).
 *
 * The room runs a game's timers off a Durable Object alarm: it calls
 * `nextDeadline(state)` after every change and `onDeadline(state, ctx)` when it's
 * due. With timers kept as `state.timers`, those two are just `nextTimer` and a
 * switch over `dueTimer`.
 */
export type Timers<K extends string = string> = Partial<Record<K, number>>;

export function setTimer<K extends string>(timers: Timers<K>, key: K, at: number | null) {
  if (at === null) delete timers[key];
  else timers[key] = at;
}

/** Earliest pending deadline, or null. */
export function nextTimer<K extends string>(timers: Timers<K>): number | null {
  let next: number | null = null;
  for (const at of Object.values(timers) as number[]) if (next === null || at < next) next = at;
  return next;
}

/** The earliest timer that is due at `now` (and clears it), or null. */
export function takeDueTimer<K extends string>(timers: Timers<K>, now: number): K | null {
  let due: K | null = null;
  for (const [key, at] of Object.entries(timers) as [K, number][]) {
    if (at <= now && (due === null || at < timers[due]!)) due = key;
  }
  if (due !== null) delete timers[due];
  return due;
}
