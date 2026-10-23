import type { GameMeta } from "../types";

export const battleshipMeta: GameMeta = {
  id: "battleship",
  name: "Battleship",
  tagline: "Hide your fleet, then take turns firing blind. Sink theirs first.",
  minPlayers: 2,
  maxPlayers: 2,
  rules: `Two players each hide a fleet on their own 10×10 grid, then take turns firing at the other's grid. First to sink the whole enemy fleet wins.
- The fleet: a Carrier (5 squares), a Battleship (4), a Cruiser (3), a Submarine (3) and a Destroyer (2), each in a straight line, across or down. Ships can't overlap (and can't touch, if the game was set up that way).
- Place your ships yourself or at random, then press Ready. Firing starts when both are ready.
- Each shot is a hit or a miss, and everyone sees which. A ship sinks when all its squares are hit, and then its position is shown.
- Shots alternate (unless the game was set up so a hit earns another shot). Run out of time and a shot is fired at random for you.`,
  botNotes: `Cells are numbered 0–99: row × 10 + column, so A1 (top left) is 0, J1 is 9, A2 is 10 and J10 is 99. In the view, boards[i].shots are the shots fired at player i's grid, and "sunk" lists sunk ships with their cells. Your own board includes your ships; the enemy's doesn't. Fire at cells next to hits that haven't sunk yet, along the line of the hits. While placing, send {"type":"random"} and then {"type":"ready"} (or lay out your own fleet with "arrange").`
};
