/**
 * What every Coast to Coast map is made of, and the cards and scoring they share. The
 * maps themselves are in `maps/` (`maps/index.ts` lists them).
 *
 * Cities have short codes; a route's id is its two cities' codes ("SEA-HEL"), with
 * "/1" and "/2" for the two tracks of a double route. Positions are in the map's own
 * coordinates, for drawing and nothing else.
 */

export const TRAIN_COLORS = ["red", "orange", "yellow", "green", "blue", "pink", "white", "black"] as const;
export type TrainColor = (typeof TRAIN_COLORS)[number];
/** A train card: one of the eight colors, or a locomotive (wild). */
export type CardColor = TrainColor | "loco";
export const CARD_COLORS = [...TRAIN_COLORS, "loco"] as const;
/** Gray routes can be claimed with any one color. */
export type RouteColor = TrainColor | "gray";

export interface City {
  id: string;
  name: string;
  x: number;
  y: number;
}

export interface Route {
  id: string;
  a: string;
  b: string;
  length: number;
  color: RouteColor;
  /** The other track of a double route. */
  twin: string | null;
  /** For drawing: how far the track bows sideways, as a fraction of its length. */
  bend: number;
  /** A ferry: how many of the cards paid must be locomotives (0 for a railway). */
  ferry: number;
}

export interface Ticket {
  id: number;
  a: string;
  b: string;
  points: number;
}

/** Points for claiming a route, by length. */
export const ROUTE_POINTS: Record<number, number> = { 1: 1, 2: 2, 3: 4, 4: 7, 5: 10, 6: 15 };
export const LONGEST_ROUTE = 6;

/**
 * How far along a map is: ready for anyone; wip, offered to anyone but marked as still
 * being tuned; dev, only offered when running locally.
 */
export type MapStatus = "ready" | "wip" | "dev";

/** [a, b, length, colors, bend?, ferry?]: one color, or two for a double route; ferry is the locomotives it takes. */
export type TrackSpec = readonly [string, string, number, readonly RouteColor[], number?, number?];

export interface MapSpec {
  /** Stored in a game's config: never change one. */
  id: string;
  name: string;
  /** Where it is, for "claim routes across …". */
  region: string;
  /** What its places are: "cities", "stations". */
  places: string;
  status: MapStatus;
  /** Trains each player starts with. */
  trains: number;
  cities: City[];
  tracks: readonly TrackSpec[];
  /** [a, b, points]; a ticket's id is its place in the list. */
  tickets: readonly (readonly [string, string, number])[];
}

export interface TtrMap extends Omit<MapSpec, "tracks" | "tickets"> {
  routes: Route[];
  tickets: Ticket[];
  cityById: Map<string, City>;
  routeById: Map<string, Route>;
  ticketById: Map<number, Ticket>;
  cityName(id: string): string;
  routeName(r: Route): string;
  ticketName(t: Ticket): string;
}

export function defineMap(spec: MapSpec): TtrMap {
  const routes = spec.tracks.flatMap(([a, b, length, colors, bend = 0, ferry = 0]): Route[] => {
    const base = `${a}-${b}`;
    if (colors.length === 1) return [{ id: base, a, b, length, color: colors[0]!, twin: null, bend, ferry }];
    return colors.map((color, i) => ({ id: `${base}/${i + 1}`, a, b, length, color, twin: `${base}/${2 - i}`, bend, ferry }));
  });
  const tickets = spec.tickets.map(([a, b, points], id) => ({ id, a, b, points }));
  const cityById = new Map(spec.cities.map((c) => [c.id, c]));
  const cityName = (id: string) => cityById.get(id)?.name ?? id;
  return {
    id: spec.id,
    name: spec.name,
    region: spec.region,
    places: spec.places,
    status: spec.status,
    trains: spec.trains,
    cities: spec.cities,
    routes,
    tickets,
    cityById,
    routeById: new Map(routes.map((r) => [r.id, r])),
    ticketById: new Map(tickets.map((t) => [t.id, t])),
    cityName,
    routeName: (r) => `${cityName(r.a)}–${cityName(r.b)}`,
    ticketName: (t) => `${cityName(t.a)}–${cityName(t.b)}`,
  };
}
