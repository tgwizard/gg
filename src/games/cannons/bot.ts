/**
 * The built-in Cannons bot, which plays like a person at the controls. It picks a
 * cannon (the nearest, then sticks with it), an angle that looks like it clears the hills
 * in between, and a first power from a rough sense of the distance, the height and the
 * wind, a fair bit off. After that it keeps the angle and corrects the power from where
 * its last shots landed: how far that was off from what it expected tells it how much to
 * change (it doesn't quite trust it, and its feel for the wind is rough). A shot that
 * hits a hill on the way makes it aim higher. It usually hits within a few shots, rarely
 * with the first.
 */
import type { GameBot } from "../types";
import type { CannonsView, CannonView, ShotView } from "./engine";
import type { CannonsOp } from "./index";
import { BARREL, dir, GRAVITY, groundAt, MAX_POWER, MIN_POWER, PIVOT, speedOf, WIND_FORCE } from "./physics";

type Rand = (maxExclusive: number) => number;

export const cannonsBot: GameBot<CannonsView, CannonsOp> = {
  easy(view, ops, rand) {
    if (!ops.some((op) => op.type === "fire")) return null;
    const me = view.cannons.find((c) => c.playerId === view.turn);
    if (!me) return null;
    return { type: "fire", ...aim(view, me, rand) };
  },
};

/** A number in [lo, hi). */
const between = (rand: Rand, lo: number, hi: number) => lo + (rand(10_000) / 10_000) * (hi - lo);

export function aim(view: CannonsView, me: CannonView, rand: Rand): { angle: number; power: number } {
  const mine = view.shots.filter((s) => s.by === me.playerId);
  const others = view.cannons.filter((c) => c.alive && c !== me);
  // Stick with whoever it was shooting at, while they're still standing.
  const last = mine.at(-1);
  const target = others.find((c) => c.playerId === last?.near?.playerId) ?? others.reduce((a, b) => (Math.abs(b.x - me.x) < Math.abs(a.x - me.x) ? b : a));
  const side = target.x >= me.x ? 1 : -1;
  const distance = Math.abs(target.x - me.x);
  const toAngle = (up: number) => (side > 0 ? up : 180 - up);
  // Its feel for the wind: roughly right.
  const windSense = between(rand, 0.5, 1.3);
  const push = view.wind * WIND_FORCE * side * windSense;

  // Its shots at this cannon from the same side, the latest last.
  const tries = mine.filter((s) => s.near?.playerId === target.playerId && (s.angle < 90) === side > 0);
  const latest = tries.at(-1);
  let up = latest ? Math.min(90 - Math.abs(90 - latest.angle), 90) : firstAngle(view, me, target, rand);
  // It came down well before the target, up on a hill higher than both cannons: aim higher (if that still reaches).
  const blocked = !!latest && latest.end === "ground" && (latest.x - me.x) * side < distance - 40 && latest.y > Math.max(me.y, target.y) + 30;
  if (blocked) {
    const higher = Math.min(75, up + 8 + rand(5));
    if (solvePower((p) => reach(higher, p, 0, target.y - me.y), distance) < MAX_POWER - 5) up = higher;
  }

  const height = (u: number) => target.y - (me.y + PIVOT + dir(u).sin * BARREL);
  const reachAt = (u: number, p: number, a: number) => reach(u, p, a, height(u));
  let power: number;
  if (!latest || blocked) {
    // A first guess: what the distance looks like it needs, a fair bit off.
    const guess = solvePower((p) => reachAt(up, p, push), distance);
    const off = between(rand, 0.06, 0.18) * (rand(2) ? 1 : -1);
    power = guess * (1 + off);
  } else if (latest.end === "off") {
    // Gone over everything: a good deal less.
    power = latest.power * between(rand, 0.8, 0.9);
  } else {
    // By eye, from where its shots at this angle landed: how far off the last one was, and
    // roughly how many meters a point of power is worth (from two shots, or from the last
    // one alone, as if distance went with power). The wind it allows for roughly.
    const along = (s: ShotView) => (s.x - me.x) * side;
    const flightTime = (s: ShotView) => (2 * speedOf(s.power) * dir(up).sin) / GRAVITY;
    const windShift = (s: ShotView, wind: number) => (wind * WIND_FORCE * side * windSense * flightTime(s) ** 2) / 2;
    // Where it would have landed in this turn's wind.
    const adjusted = (s: ShotView) => along(s) - windShift(s, s.wind) + windShift(s, view.wind);
    const usable = tries.filter((s) => s.end !== "off" && s.angle === latest.angle);
    const prev = usable.at(-2);
    let perPoint = Math.max(4, adjusted(latest) / latest.power);
    if (prev && prev.power !== latest.power) {
      const slope = (adjusted(latest) - adjusted(prev)) / (latest.power - prev.power);
      if (slope > 2) perPoint = slope;
    }
    const miss = adjusted(latest) - distance;
    // After one shot it's a rough feel (it may over- or under-do it); with a few behind it, steadier.
    const trust = usable.length < 2 ? between(rand, 0.45, 1.3) : between(rand, 0.75, 1.1);
    power = latest.power - (miss / perPoint) * trust;
    // Not perfectly steady hands.
    if (rand(3) === 0) power += rand(2) ? 1 : -1;
  }
  return { angle: toAngle(Math.round(up)), power: Math.max(MIN_POWER, Math.min(MAX_POWER, Math.round(power))) };
}

/** How far along (towards the target) a ball comes back down to `height` above the muzzle, with no ground in the way. */
function reach(up: number, power: number, push: number, height: number): number {
  const { cos, sin } = dir(up);
  const v = speedOf(power);
  const [vx, vy] = [v * cos, v * sin];
  const disc = vy * vy - 2 * GRAVITY * height;
  if (disc < 0) return 0;
  const t = (vy + Math.sqrt(disc)) / GRAVITY;
  return BARREL * cos + vx * t + (push * t * t) / 2;
}

/** The power (unrounded) at which `land(power)` comes to `distance`, or the nearest it gets. */
function solvePower(land: (power: number) => number, distance: number): number {
  let [lo, hi] = [MIN_POWER, MAX_POWER];
  if (land(hi) < distance) return hi;
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    if (land(mid) < distance) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** The lowest angle (in degrees up) whose arc looks like it clears the ground in between, give or take. */
function firstAngle(view: CannonsView, me: CannonView, target: CannonView, rand: Rand): number {
  const side = target.x >= me.x ? 1 : -1;
  const distance = Math.abs(target.x - me.x);
  for (let up = 40; up <= 75; up += 5) {
    const { cos, sin } = dir(up);
    const p = solvePower((q) => reach(up, q, 0, target.y - (me.y + PIVOT + sin * BARREL)), distance);
    if (p >= MAX_POWER) continue;
    const v = speedOf(p);
    const [vx, vy] = [v * cos, v * sin];
    let clear = true;
    for (let d = 25; d < distance - 25 && clear; d += 8) {
      const t = d / vx;
      const y = me.y + PIVOT + vy * t - (GRAVITY * t * t) / 2;
      if (y < groundAt(view.terrain, me.x + d * side) + 12) clear = false;
    }
    if (clear) return up + rand(7) - 3;
  }
  return 60 + rand(7) - 3;
}
