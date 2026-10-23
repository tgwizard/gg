/**
 * The North American map of the standard game: 36 cities, 100 routes (22 of them
 * doubled) and 30 destination tickets.
 *
 * Cities have three-letter codes; a route's id is its two cities' codes ("SEA-HEL"),
 * with "/1" and "/2" for the two tracks of a double route. Positions are in the map's
 * own coordinates (a 1000 × 667 board), for drawing and nothing else.
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
}

export interface Ticket {
  id: number;
  a: string;
  b: string;
  points: number;
}

export const CITIES: City[] = [
  { id: "VAN", name: "Vancouver", x: 108, y: 103 },
  { id: "SEA", name: "Seattle", x: 104, y: 155 },
  { id: "POR", name: "Portland", x: 82, y: 206 },
  { id: "SFO", name: "San Francisco", x: 68, y: 399 },
  { id: "LAX", name: "Los Angeles", x: 145, y: 500 },
  { id: "CAL", name: "Calgary", x: 235, y: 86 },
  { id: "HEL", name: "Helena", x: 333, y: 215 },
  { id: "SLC", name: "Salt Lake City", x: 263, y: 336 },
  { id: "LAS", name: "Las Vegas", x: 208, y: 443 },
  { id: "PHX", name: "Phoenix", x: 262, y: 507 },
  { id: "ELP", name: "El Paso", x: 378, y: 543 },
  { id: "SAF", name: "Santa Fe", x: 383, y: 455 },
  { id: "DEN", name: "Denver", x: 390, y: 366 },
  { id: "WIN", name: "Winnipeg", x: 453, y: 97 },
  { id: "DUL", name: "Duluth", x: 564, y: 210 },
  { id: "OMA", name: "Omaha", x: 535, y: 299 },
  { id: "KAN", name: "Kansas City", x: 555, y: 349 },
  { id: "OKC", name: "Oklahoma City", x: 535, y: 433 },
  { id: "DAL", name: "Dallas", x: 555, y: 520 },
  { id: "HOU", name: "Houston", x: 595, y: 558 },
  { id: "SSM", name: "Sault St. Marie", x: 688, y: 145 },
  { id: "CHI", name: "Chicago", x: 684, y: 269 },
  { id: "STL", name: "Saint Louis", x: 638, y: 350 },
  { id: "LIT", name: "Little Rock", x: 623, y: 437 },
  { id: "NOR", name: "New Orleans", x: 686, y: 547 },
  { id: "TOR", name: "Toronto", x: 795, y: 166 },
  { id: "PIT", name: "Pittsburgh", x: 812, y: 255 },
  { id: "NAS", name: "Nashville", x: 731, y: 388 },
  { id: "ATL", name: "Atlanta", x: 781, y: 422 },
  { id: "CHA", name: "Charleston", x: 872, y: 429 },
  { id: "MIA", name: "Miami", x: 904, y: 583 },
  { id: "MON", name: "Montreal", x: 875, y: 82 },
  { id: "BOS", name: "Boston", x: 945, y: 138 },
  { id: "NYC", name: "New York", x: 894, y: 211 },
  { id: "WAS", name: "Washington", x: 902, y: 300 },
  { id: "RAL", name: "Raleigh", x: 845, y: 365 },
];

// [a, b, length, colors, bend?]: one color, or two for a double route. "bend" bows the track as on the printed board.
const TRACKS: [string, string, number, RouteColor[], number?][] = [
  ["VAN", "CAL", 3, ["gray"]],
  ["VAN", "SEA", 1, ["gray", "gray"]],
  ["SEA", "CAL", 4, ["gray"]],
  ["SEA", "HEL", 6, ["yellow"]],
  ["SEA", "POR", 1, ["gray", "gray"]],
  ["POR", "SFO", 5, ["green", "pink"], 0.1],
  ["POR", "SLC", 6, ["blue"], -0.08],
  ["SFO", "SLC", 5, ["orange", "white"]],
  ["SFO", "LAX", 3, ["yellow", "pink"], 0.1],
  ["LAX", "LAS", 2, ["gray"]],
  ["LAX", "PHX", 3, ["gray"]],
  ["LAX", "ELP", 6, ["black"], 0.33],
  ["LAS", "SLC", 3, ["orange"]],
  ["PHX", "DEN", 5, ["white"]],
  ["PHX", "SAF", 3, ["gray"]],
  ["PHX", "ELP", 3, ["gray"]],
  ["CAL", "HEL", 4, ["gray"]],
  ["CAL", "WIN", 6, ["white"], -0.27],
  ["HEL", "WIN", 4, ["blue"]],
  ["HEL", "DUL", 6, ["orange"]],
  ["HEL", "OMA", 5, ["red"]],
  ["HEL", "DEN", 4, ["green"]],
  ["HEL", "SLC", 3, ["pink"]],
  ["SLC", "DEN", 3, ["red", "yellow"]],
  ["DEN", "OMA", 4, ["pink"]],
  ["DEN", "KAN", 4, ["black", "orange"]],
  ["DEN", "OKC", 4, ["red"], 0.1],
  ["DEN", "SAF", 2, ["gray"]],
  ["SAF", "OKC", 3, ["blue"]],
  ["SAF", "ELP", 2, ["gray"]],
  ["ELP", "OKC", 5, ["yellow"], 0.2],
  ["ELP", "DAL", 4, ["red"]],
  ["ELP", "HOU", 6, ["green"], 0.28],
  ["WIN", "DUL", 4, ["black"]],
  ["WIN", "SSM", 6, ["gray"], -0.03],
  ["DUL", "SSM", 3, ["gray"]],
  ["DUL", "TOR", 6, ["pink"]],
  ["DUL", "CHI", 3, ["red"]],
  ["DUL", "OMA", 2, ["gray", "gray"]],
  ["OMA", "CHI", 4, ["blue"]],
  ["OMA", "KAN", 1, ["gray", "gray"]],
  ["KAN", "STL", 2, ["blue", "pink"]],
  ["KAN", "OKC", 2, ["gray", "gray"]],
  ["OKC", "LIT", 2, ["gray"]],
  ["OKC", "DAL", 2, ["gray", "gray"]],
  ["DAL", "LIT", 2, ["gray"]],
  ["DAL", "HOU", 1, ["gray", "gray"]],
  ["HOU", "NOR", 2, ["gray"]],
  ["LIT", "STL", 2, ["gray"]],
  ["LIT", "NAS", 3, ["white"]],
  ["LIT", "NOR", 3, ["green"]],
  ["NOR", "ATL", 4, ["yellow", "orange"], -0.2],
  ["NOR", "MIA", 6, ["red"], -0.42],
  ["STL", "CHI", 2, ["green", "white"]],
  ["STL", "PIT", 5, ["green"]],
  ["STL", "NAS", 2, ["gray"]],
  ["CHI", "PIT", 3, ["orange", "black"]],
  ["CHI", "TOR", 4, ["white"]],
  ["SSM", "TOR", 2, ["gray"]],
  ["SSM", "MON", 5, ["black"], -0.15],
  ["TOR", "MON", 3, ["gray"]],
  ["TOR", "PIT", 2, ["gray"]],
  ["MON", "BOS", 2, ["gray", "gray"]],
  ["MON", "NYC", 3, ["blue"]],
  ["BOS", "NYC", 2, ["yellow", "red"]],
  ["NYC", "PIT", 2, ["white", "green"]],
  ["NYC", "WAS", 2, ["orange", "black"]],
  ["PIT", "WAS", 2, ["gray"]],
  ["PIT", "RAL", 2, ["gray"]],
  ["PIT", "NAS", 4, ["yellow"]],
  ["WAS", "RAL", 2, ["gray", "gray"]],
  ["RAL", "NAS", 3, ["black"]],
  ["RAL", "ATL", 2, ["gray", "gray"]],
  ["RAL", "CHA", 2, ["gray"]],
  ["NAS", "ATL", 1, ["gray"]],
  ["ATL", "CHA", 2, ["gray"]],
  ["ATL", "MIA", 5, ["blue"]],
  ["CHA", "MIA", 4, ["pink"]],
];

export const ROUTES: Route[] = TRACKS.flatMap(([a, b, length, colors, bend = 0]): Route[] => {
  const base = `${a}-${b}`;
  if (colors.length === 1) return [{ id: base, a, b, length, color: colors[0]!, twin: null, bend }];
  return colors.map((color, i) => ({ id: `${base}/${i + 1}`, a, b, length, color, twin: `${base}/${2 - i}`, bend }));
});

export const TICKETS: Ticket[] = (
  [
    ["LAX", "NYC", 21],
    ["DUL", "HOU", 8],
    ["SSM", "NAS", 8],
    ["NYC", "ATL", 6],
    ["POR", "NAS", 17],
    ["VAN", "MON", 20],
    ["DUL", "ELP", 10],
    ["TOR", "MIA", 10],
    ["POR", "PHX", 11],
    ["DAL", "NYC", 11],
    ["CAL", "SLC", 7],
    ["CAL", "PHX", 13],
    ["LAX", "MIA", 20],
    ["WIN", "LIT", 11],
    ["SFO", "ATL", 17],
    ["KAN", "HOU", 5],
    ["LAX", "CHI", 16],
    ["DEN", "PIT", 11],
    ["CHI", "SAF", 9],
    ["VAN", "SAF", 13],
    ["BOS", "MIA", 12],
    ["CHI", "NOR", 7],
    ["MON", "ATL", 9],
    ["SEA", "NYC", 22],
    ["DEN", "ELP", 4],
    ["HEL", "LAX", 8],
    ["WIN", "HOU", 12],
    ["MON", "NOR", 13],
    ["SSM", "OKC", 9],
    ["SEA", "LAX", 9],
  ] as const
).map(([a, b, points], id) => ({ id, a, b, points }));

/** Points for claiming a route, by length. */
export const ROUTE_POINTS: Record<number, number> = { 1: 1, 2: 2, 3: 4, 4: 7, 5: 10, 6: 15 };

export const cityById = new Map(CITIES.map((c) => [c.id, c]));
export const routeById = new Map(ROUTES.map((r) => [r.id, r]));
export const ticketById = new Map(TICKETS.map((t) => [t.id, t]));
export const ROUTE_IDS = ROUTES.map((r) => r.id) as [string, ...string[]];

export const cityName = (id: string) => cityById.get(id)?.name ?? id;
export const routeName = (r: Route) => `${cityName(r.a)}–${cityName(r.b)}`;
export const ticketName = (t: Ticket) => `${cityName(t.a)}–${cityName(t.b)}`;
