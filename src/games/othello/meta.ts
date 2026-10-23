import type { GameMeta } from "../types";

export const othelloMeta: GameMeta = {
  id: "othello",
  name: "Othello",
  tagline: "Trap their discs and turn them over. Most discs wins.",
  minPlayers: 2,
  maxPlayers: 2,
  rules: `Two players, Black and White, take turns putting a disc of their color on an 8×8 board. It starts with four discs in the middle, and Black moves first.
- Every disc you put down must trap at least one line of the other color: in a straight row, column or diagonal, between the new disc and one of yours already there, with no gaps. All the discs you trap, in every direction, turn over to your color.
- If you have no such move, you pass and the other player goes again (that happens on its own). When neither of you can move, usually because the board is full, the game is over.
- Whoever has more discs on the board wins; the same number is a draw.
- Corners can never be turned over, so they're worth a lot; the squares next to an empty corner often hand it to the other player.
- Each player has a clock and gains a few seconds for every move (if the game has a clock). Run out of time and you lose. You can also resign.
- Colors swap every game.`,
  botNotes: `Squares are named a1 (top left) to h8 (bottom right): the letter is the column (a to h, left to right), the number the row (1 to 8, from the top). In the view, "rows" is the board as 8 strings, row 1 first, with "b" for Black, "w" for White and "." for empty; "you.color" is your color; "turn" whose move it is; "score" the discs each has now; "moves" the game so far (square null for a pass); "lastMove" the last disc put down and the discs it turned over; and "clock" the milliseconds left on each clock. A move is {"type":"move","square":"f5"}; only squares that turn something over are allowed, and the list of moves you're given has every one. Prefer corners, edges and moves that leave the other player few moves; avoid the squares diagonally next to an empty corner (b2, g2, b7, g7).`,
};
