import type { GameMeta } from "../types";
import { CITIES, ROUTES, TICKETS } from "./map";

const routeList = ROUTES.map((r) => `${r.id} ${r.length} ${r.color}`).join(", ");
const cityList = CITIES.map((c) => `${c.id} ${c.name}`).join(", ");

export const ticketMeta: GameMeta = {
  id: "ticket",
  name: "Ticket to Ride",
  tagline: "Collect train cards, claim railway routes across North America, connect your tickets.",
  minPlayers: 2,
  maxPlayers: 5,
  rules: `Build railways across North America for 2–5 players. Score by claiming routes, completing your destination tickets and having the longest railway.
- Everyone starts with 45 trains, 4 train cards and 3 destination tickets, and keeps at least 2 of the tickets. Five train cards lie face up.
- On your turn, do one of three things.
- Draw train cards: take two, each from the face-up five or blind from the deck. A face-up locomotive counts as both (and can't be your second card). Three face-up locomotives at once and all five are replaced.
- Claim a route: pay as many cards of the route's color as it is long (any one color for a gray route), with locomotives standing in for any color, and put your trains on it. Routes score 1, 2, 4, 7, 10 and 15 points for 1–6 trains.
- Draw destination tickets: draw 3 and keep at least 1.
- Double routes: nobody can have both tracks, and with 2–3 players only one of them is used.
- When someone ends a turn with 2 or fewer trains, everyone (them included) gets one last turn.
- At the end, each ticket whose two cities your routes connect adds its points; each one that doesn't subtracts them. The longest continuous railway earns 10 more. Ties go to the most completed tickets, then the longest railway.
- Run out of time and your turn is played for you (cards from the deck), and you're marked away.`,
  botNotes: `Cities have three-letter codes; a route's id is its two cities' codes, with /1 and /2 for the two tracks of a double route. The routes (id, length, color): ${routeList}. The cities: ${cityList}. There are ${TICKETS.length} tickets.
In the view, "claims" maps claimed route ids to who has them; any route not in it is free (but see bothTracks for double routes). "you.hand" is your cards by color ("loco" = locomotive), "you.tickets" your tickets (done = already connected), and "you.offered" tickets to choose from. Moves: {"type":"draw","from":"deck"} or {"type":"draw","from":<face-up slot 0–4>}; {"type":"claim","route":"SEA-HEL","color":"yellow","locos":0} pays route length minus locos cards of that color plus locos locomotives (color "loco" pays with locomotives only); {"type":"tickets"} draws tickets; {"type":"keep","tickets":[ids]} keeps some of the offered ones. Plan routes that connect your tickets, collect the colors they need, and claim the routes others are likely to block first.`,
};
