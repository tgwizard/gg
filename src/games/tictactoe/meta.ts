import type { GameMeta } from "../types";

export const ticTacToeMeta: GameMeta = {
  id: "tictactoe",
  name: "Tic-tac-toe",
  tagline: "Three in a row. Quick rounds, sides alternate.",
  minPlayers: 2,
  maxPlayers: 2,
  rules: `Two players take turns marking squares on a 3×3 grid, X and O. Three in a row (across, down or diagonally) wins the round; a full grid with no line is a draw.
- X moves first in the first round, and the opening side alternates each round.
- Run out of time and you forfeit the round. A new round starts a few seconds after one ends.`,
  botNotes: `Squares are numbered 0–8 row by row: 0 1 2 / 3 4 5 / 6 7 8. In the view, board[i] is 0 for X, 1 for O, or null when empty, and you.seat is your mark (0 = X, 1 = O).`
};
