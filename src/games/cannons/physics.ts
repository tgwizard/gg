/**
 * Cannons' physics: one shot's flight over a side-view landscape, and the crater it
 * leaves. Pure and shared: the server decides every shot with it, and the browser and
 * the bots use the same numbers.
 *
 * Deterministic on purpose. Angles are whole degrees, looked up in a sine table built
 * from a Taylor series (only + − × ÷, which every JavaScript engine rounds the same
 * way; Math.sin may differ in the last bit between engines). The flight steps with a
 * fixed time step, and square roots are worked out by hand too, so the same angle,
 * power, wind and ground always give the same flight, to the last bit, anywhere.
 *
 * The world is in meters: x runs from 0 (the left edge) to WIDTH, y up from 0 (bedrock).
 * The ground is a height every STEP meters (whole meters), straight between them.
 */

export const WIDTH = 800;
/** How much sky is shown above bedrock. */
export const HEIGHT = 500;
/** Meters between terrain heights. */
export const STEP = 4;
export const COLUMNS = WIDTH / STEP + 1;
/** The highest ground can be. */
export const MAX_GROUND = 420;

export const GRAVITY = 234;
/** Speed at power 100, in m/s: 1200 m on the flat at 45°. Speed goes with the square root of the power, so distance goes with the power. */
export const MAX_SPEED = 530;
/** Sideways push per point of wind, in m/s². */
export const WIND_FORCE = 3;
/** The time step: 20 ms, played back in real time. */
export const TICK_MS = 20;
const DT = TICK_MS / 1000;
/** Checks against the ground and cannons per step, so a fast ball can't skip through a peak. */
const SUBSTEPS = 4;
/** The longest a ball flies before it's given up on (12 s). */
export const MAX_TICKS = 600;
/** A point of the path every this many ticks. */
export const PATH_EVERY = 2;

export const MIN_POWER = 5;
export const MAX_POWER = 100;
/** A ball passing this close to a cannon's middle knocks it out. */
export const HIT_RADIUS = 15;
export const CRATER_RADIUS = 16;
/** Where the barrel turns, above the ground under the cannon, and how long it is. */
export const PIVOT = 9;
export const BARREL = 14;
/** The middle of a cannon, above the ground under it (for hits). */
export const BODY = 7;
/** The sea beyond the cliffs at either edge: a ball that comes down off the side splashes in at this height. */
export const SEA_LEVEL = 6;
/** Beyond this far past either edge, a ball is gone for good. */
const LOST_BEYOND = WIDTH / 2;

// --- angles ----------------------------------------------------------------------

const PI = 3.141592653589793;

/** sin(x) for x in [0, π/2], by Taylor series: plain arithmetic only. */
function taylorSin(x: number): number {
  const x2 = x * x;
  let term = x;
  let sum = x;
  for (let k = 1; k <= 8; k++) {
    term = (-term * x2) / ((2 * k) * (2 * k + 1));
    sum += term;
  }
  return sum;
}

/** sin of whole degrees 0–90. */
const SIN90 = Array.from({ length: 91 }, (_, d) => (d === 90 ? 1 : d === 0 ? 0 : taylorSin((d * PI) / 180)));

/** sin and cos of a whole number of degrees from 0 (pointing right) to 180 (pointing left). */
export function dir(angle: number): { cos: number; sin: number } {
  const a = Math.max(0, Math.min(180, Math.round(angle)));
  return a <= 90 ? { cos: SIN90[90 - a]!, sin: SIN90[a]! } : { cos: -SIN90[a - 90]!, sin: SIN90[180 - a]! };
}

/** Rounded to a whole number, never -0 (which JSON can't keep). */
export const whole = (x: number) => Math.round(x) + 0;

/** √x by Newton's method: plain arithmetic, so the same everywhere. */
export function root(x: number): number {
  if (!(x > 0)) return 0;
  let r = x > 1 ? x / 2 : 1;
  for (let i = 0; i < 64; i++) {
    const next = (r + x / r) / 2;
    if (next === r) break;
    r = next;
  }
  return r;
}

/** The ball's speed leaving the barrel at a power, in m/s. */
export const speedOf = (power: number) => MAX_SPEED * root(power / 100);

// --- the ground ------------------------------------------------------------------

/** The ground's height at x; -Infinity off the edges (there's nothing there). */
export function groundAt(terrain: number[], x: number): number {
  if (x < 0 || x > WIDTH) return -Infinity;
  const i = Math.min(COLUMNS - 2, Math.floor(x / STEP));
  const t = (x - i * STEP) / STEP;
  return terrain[i]! + (terrain[i + 1]! - terrain[i]!) * t;
}

/**
 * A crater where a ball burst at (x, y): each column of ground loses what's inside the
 * circle, and what was above it settles down (no overhangs), so a hit on a cliff takes
 * a bite out of it. Returns the new heights.
 */
export function crater(terrain: number[], x: number, y: number, r = CRATER_RADIUS): number[] {
  return terrain.map((h, i) => {
    const dx = i * STEP - x;
    if (dx * dx >= r * r) return h;
    const s = root(r * r - dx * dx);
    const top = Math.min(h, y + s);
    const bottom = Math.max(0, y - s);
    return top > bottom ? Math.max(0, whole(h - (top - bottom))) : h;
  });
}

/** Where a cannon's barrel turns, at x on this ground. */
export function pivotOf(terrain: number[], x: number) {
  return { x, y: groundAt(terrain, x) + PIVOT };
}

// --- a shot ----------------------------------------------------------------------

export interface FlightInput {
  terrain: number[];
  /** Every cannon's x; `alive: false` ones are wrecks the ball passes through. */
  cannons: { x: number; alive: boolean }[];
  /** Index into `cannons`. */
  shooter: number;
  /** Whole degrees: 0 points right along the ground, 90 straight up, 180 left. */
  angle: number;
  /** MIN_POWER–MAX_POWER. */
  power: number;
  /** Positive blows right. */
  wind: number;
}

export interface Flight {
  /** Where the ball was, as x, y pairs (whole meters): the muzzle, then every PATH_EVERY ticks, then where it ended. */
  path: number[];
  /** How long it flew, in ticks (TICK_MS each). */
  ticks: number;
  /** It burst on the ground, hit a cannon, or left the world. */
  end: "ground" | "cannon" | "off";
  /** Where it ended (whole meters). */
  x: number;
  y: number;
  /** The cannon hit (an index into `cannons`), if any. */
  hit: number | null;
}

/** The whole flight of one shot. */
export function flight(input: FlightInput): Flight {
  const { terrain, cannons } = input;
  const { cos, sin } = dir(input.angle);
  const power = Math.max(MIN_POWER, Math.min(MAX_POWER, Math.round(input.power)));
  const speed = speedOf(power);
  const push = Math.round(input.wind) * WIND_FORCE;
  const pivot = pivotOf(terrain, cannons[input.shooter]!.x);
  const middles = cannons.map((c) => ({ x: c.x, y: groundAt(terrain, c.x) + BODY, alive: c.alive }));

  let x = pivot.x + cos * BARREL;
  let y = pivot.y + sin * BARREL;
  let vx = cos * speed;
  let vy = sin * speed;
  // Your own cannon can only be hit once the ball has got clear of it.
  let clear = false;
  const path = [whole(x), whole(y)];
  const done = (end: Flight["end"], ex: number, ey: number, ticks: number, hit: number | null = null): Flight => {
    path.push(whole(ex), whole(ey));
    return { path, ticks, end, x: whole(ex), y: whole(ey), hit };
  };

  for (let tick = 1; tick <= MAX_TICKS; tick++) {
    vx += push * DT;
    vy -= GRAVITY * DT;
    const [x0, y0] = [x, y];
    const dx = (vx * DT) / SUBSTEPS;
    const dy = (vy * DT) / SUBSTEPS;
    for (let s = 1; s <= SUBSTEPS; s++) {
      const [px, py] = [x0 + dx * (s - 1), y0 + dy * (s - 1)];
      const [nx, ny] = [x0 + dx * s, y0 + dy * s];
      // A cannon first: the ball can graze one on its way into the ground beside it.
      for (let i = 0; i < middles.length; i++) {
        const m = middles[i]!;
        if (!m.alive || (i === input.shooter && !clear)) continue;
        const near = closest(px, py, nx, ny, m.x, m.y);
        if (near.d2 <= HIT_RADIUS * HIT_RADIUS) return done("cannon", near.x, near.y, tick, i);
      }
      if (ny <= groundAt(terrain, nx)) {
        // Narrow down where it went in, between the last point above ground and this one.
        let [ax, ay, bx, by] = [px, py, nx, ny];
        for (let k = 0; k < 6; k++) {
          const [mx, my] = [(ax + bx) / 2, (ay + by) / 2];
          if (my <= groundAt(terrain, mx)) [bx, by] = [mx, my];
          else [ax, ay] = [mx, my];
        }
        return done("ground", bx, Math.max(0, groundAt(terrain, bx)), tick);
      }
      if (!clear) {
        const own = middles[input.shooter]!;
        const ox = nx - own.x;
        const oy = ny - own.y;
        if (ox * ox + oy * oy > (HIT_RADIUS + 6) * (HIT_RADIUS + 6)) clear = true;
      }
    }
    x = x0 + dx * SUBSTEPS;
    y = y0 + dy * SUBSTEPS;
    // Off the side and down in the sea it can't come back up; far off to the side it's gone.
    if (((x < 0 || x > WIDTH) && y < SEA_LEVEL) || x < -LOST_BEYOND || x > WIDTH + LOST_BEYOND) return done("off", x, y, tick);
    if (tick % PATH_EVERY === 0) path.push(whole(x), whole(y));
  }
  return done("off", x, y, MAX_TICKS);
}

/** The point of the segment (ax, ay)–(bx, by) closest to (cx, cy), and its squared distance. */
function closest(ax: number, ay: number, bx: number, by: number, cx: number, cy: number) {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((cx - ax) * dx + (cy - ay) * dy) / len2));
  const x = ax + dx * t;
  const y = ay + dy * t;
  return { x, y, d2: (x - cx) * (x - cx) + (y - cy) * (y - cy) };
}

/** The ball's position along a flight's path at `ms` into it (straight between points), and whether it's arrived. */
export function along(f: Pick<Flight, "path" | "ticks">, ms: number): { x: number; y: number; done: boolean } {
  const n = f.path.length / 2;
  const t = ms / TICK_MS;
  if (t >= f.ticks || n < 2) return { x: f.path[(n - 1) * 2]!, y: f.path[(n - 1) * 2 + 1]!, done: true };
  // Point k (before the last) is at tick k * PATH_EVERY; the last is at `ticks`.
  const timeOf = (k: number) => (k === n - 1 ? f.ticks : k * PATH_EVERY);
  let k = Math.min(n - 2, Math.floor(t / PATH_EVERY));
  while (k < n - 2 && timeOf(k + 1) < t) k++;
  const [t0, t1] = [timeOf(k), timeOf(k + 1)];
  const u = t1 > t0 ? Math.max(0, Math.min(1, (t - t0) / (t1 - t0))) : 1;
  return { x: f.path[k * 2]! + (f.path[k * 2 + 2]! - f.path[k * 2]!) * u, y: f.path[k * 2 + 1]! + (f.path[k * 2 + 3]! - f.path[k * 2 + 1]!) * u, done: false };
}

/** Angle 0–180 as people say it: degrees up from the ground, and which way. */
export function elevation(angle: number): { up: number; way: "left" | "right" | "up" } {
  return angle === 90 ? { up: 90, way: "up" } : angle < 90 ? { up: angle, way: "right" } : { up: 180 - angle, way: "left" };
}
