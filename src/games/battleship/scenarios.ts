import { type Scenario, scenarioContext } from "../kit/scenario";
import type { GameContext } from "../types";
import { type BsState, CELLS, coord, type ShipPlacement, shipCells } from "./engine";
import { battleship as game } from "./index";

const YOURS: ShipPlacement[] = [
  { id: "carrier", row: 1, col: 1, vertical: false },
  { id: "battleship", row: 3, col: 6, vertical: true },
  { id: "cruiser", row: 6, col: 1, vertical: false },
  { id: "submarine", row: 8, col: 4, vertical: false },
  { id: "destroyer", row: 4, col: 2, vertical: true },
];
const THEIRS: ShipPlacement[] = [
  { id: "carrier", row: 9, col: 5, vertical: false },
  { id: "battleship", row: 0, col: 2, vertical: false },
  { id: "cruiser", row: 2, col: 8, vertical: true },
  { id: "submarine", row: 5, col: 0, vertical: true },
  { id: "destroyer", row: 6, col: 5, vertical: false },
];
const cellsOf = (ships: ShipPlacement[]) => ships.flatMap((s) => shipCells(s)!);
/** The one cell of their fleet still afloat: the destroyer's stern. */
const LAST = shipCells(THEIRS[4]!)![1]!;

/**
 * Firing, your shot: everything of theirs is sunk but the destroyer, which is hit
 * once. They've hit some of yours (the carrier three times, nothing sunk).
 */
function oneLeft(players: string[], ctx: GameContext): BsState {
  const c = scenarioContext(ctx);
  const [you, bot] = players as [string, string];
  const state = game.create(game.configSchema.parse({}), c);
  game.apply(state, you, { type: "sit", seat: 0 }, c);
  game.apply(state, bot, { type: "sit", seat: 1 }, c);
  game.apply(state, you, { type: "arrange", ships: YOURS }, c);
  game.apply(state, bot, { type: "arrange", ships: THEIRS }, c);
  game.apply(state, you, { type: "ready" }, c);
  game.apply(state, bot, { type: "ready" }, c);

  // Your shots: their ships (but the last cell) with a few misses mixed in.
  const theirs = new Set(cellsOf(THEIRS));
  const misses = [44, 77, 23, 91, 7].filter((cell) => !theirs.has(cell));
  const hits = cellsOf(THEIRS).filter((cell) => cell !== LAST);
  const mine = hits.flatMap((cell, i) => (i % 4 === 3 && misses.length ? [misses.pop()!, cell] : [cell]));
  // Theirs: three hits on your carrier, the rest misses.
  const yours = new Set(cellsOf(YOURS));
  const open = Array.from({ length: CELLS }, (_, i) => (i * 37) % CELLS).filter((cell) => !yours.has(cell));
  const shots = [11, 12, 13, ...open.slice(0, mine.length - 3)];
  mine.forEach((cell, i) => {
    game.apply(state, you, { type: "fire", cell }, c);
    game.apply(state, bot, { type: "fire", cell: shots[i]! }, c);
  });
  return state;
}

export const scenarios: Scenario<BsState>[] = [
  {
    id: "one-left",
    name: "One cell to go",
    description: `Your shot: only their destroyer is left, hit once. ${coord(LAST)} sinks it and wins.`,
    bots: 1,
    build: oneLeft,
  },
  {
    id: "won",
    name: "You won",
    description: "Game over: you sank their whole fleet. Both fleets are revealed, and Play again is offered.",
    bots: 1,
    build(players, ctx) {
      const state = oneLeft(players, ctx);
      game.apply(state, players[0]!, { type: "fire", cell: LAST }, scenarioContext(ctx));
      return state;
    },
  },
];
