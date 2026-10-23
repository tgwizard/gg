/**
 * The map as a graph: which routes a player may still claim, whether their routes
 * join two cities, their longest continuous path, and the cheapest way to finish a
 * ticket. Shared by the engine (scoring) and the built-in bot (planning).
 */
import { ROUTES, type Route, routeById } from "./map";

/** Who has claimed each route: route id → player id. */
export type Claims = Record<string, string>;

/**
 * Whether `player` may claim `route` now, ignoring their cards and trains: it's free,
 * and if it's half of a double route, they don't have the other half, and (in games
 * of 2–3 players, where only one half is used) nobody does.
 */
export function routeOpen(claims: Claims, route: Route, player: string, bothTracks: boolean): boolean {
  if (claims[route.id]) return false;
  if (!route.twin) return true;
  const twin = claims[route.twin];
  return !twin || (bothTracks && twin !== player);
}

/** Both tracks of a double route are used with 4 or more players. */
export const bothTracksFor = (players: number) => players >= 4;

/** Whether the routes join cities a and b. */
export function connects(routeIds: string[], a: string, b: string): boolean {
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let root = x;
    while (parent.has(root) && parent.get(root) !== root) root = parent.get(root)!;
    parent.set(x, root);
    return root;
  };
  for (const id of routeIds) {
    const r = routeById.get(id)!;
    parent.set(find(r.a), find(r.b));
  }
  return find(a) === find(b);
}

/**
 * The longest continuous path through the routes, in trains: it may pass through a
 * city more than once but use each route only once.
 */
export function longestPath(routeIds: string[]): number {
  const edges = routeIds.map((id) => routeById.get(id)!);
  const used = new Array<boolean>(edges.length).fill(false);
  const from = (city: string): number => {
    let best = 0;
    edges.forEach((e, i) => {
      if (used[i] || (e.a !== city && e.b !== city)) return;
      used[i] = true;
      best = Math.max(best, e.length + from(e.a === city ? e.b : e.a));
      used[i] = false;
    });
    return best;
  };
  const cities = new Set(edges.flatMap((e) => [e.a, e.b]));
  let best = 0;
  for (const c of cities) best = Math.max(best, from(c));
  return best;
}

/**
 * The cheapest way to join a and b for `player`: the routes still to claim (their own
 * cost nothing, others' are closed), or null if there's no way left.
 */
export function cheapestPath(claims: Claims, player: string, bothTracks: boolean, a: string, b: string): { cost: number; routes: Route[] } | null {
  const dist = new Map<string, number>([[a, 0]]);
  const via = new Map<string, Route>();
  const done = new Set<string>();
  for (;;) {
    let city: string | null = null;
    for (const [c, d] of dist) if (!done.has(c) && (city === null || d < dist.get(city)!)) city = c;
    if (city === null) return null;
    if (city === b) break;
    done.add(city);
    for (const r of ROUTES) {
      if (r.a !== city && r.b !== city) continue;
      const cost = claims[r.id] === player ? 0 : routeOpen(claims, r, player, bothTracks) ? r.length : null;
      if (cost === null) continue;
      const next = r.a === city ? r.b : r.a;
      const d = dist.get(city)! + cost;
      if (d < (dist.get(next) ?? Infinity)) {
        dist.set(next, d);
        via.set(next, r);
      }
    }
  }
  const routes: Route[] = [];
  for (let c = b; c !== a; ) {
    const r = via.get(c)!;
    if (claims[r.id] !== player) routes.push(r);
    c = r.a === c ? r.b : r.a;
  }
  return { cost: dist.get(b)!, routes };
}
