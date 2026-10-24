import type { GameMeta } from "../types";

export const fourInARowMeta: GameMeta = {
  id: "fourinarow",
  name: "Four in a Row",
  tagline: "Drop discs into the columns. First to line up four wins.",
  minPlayers: 2,
  maxPlayers: 2,
  wip: true,
  rules: `Two players take turns dropping a disc of their color into one of the columns of an upright board (7 columns and 6 rows, or bigger). A disc falls to the lowest empty spot in its column.
- The first to get four of their discs in a line wins: across, up and down, or diagonally.
- If the board fills up with no four in a row, it's a draw.
- You can't drop into a full column, and you can't pass.
- Block the other player's threes, and try to make two threats at once: they can only block one. A threat they can't block yet (the spot under it is empty) can win the game later, when someone is forced to fill the spot below it.
- Each player has a clock and gains a few seconds for every move (if the game has a clock). Run out of time and you lose. You can also resign.
- Who starts the next game depends on the setup: players take turns starting, or the loser starts.`,
  botNotes: `Columns are numbered 1 (left) to the board's width, and rows 1 (the bottom) to its height. In the view, "size" is the board's width (columns) and height (rows); "rows" is the board as strings, the top row first (so the last string is the bottom row, row 1, and the first character of each is column 1), with "x" for the discs of whoever started this game, "o" for the other player's and "." for empty; "you.piece" is yours; "turn" whose move it is; "moves" the game so far (the column of each disc); "lastMove" where the last disc landed; and "clock" the milliseconds left on each clock. A move is {"type":"drop","column":4}: the disc falls to the lowest empty spot of that column; full columns aren't allowed, and the list of moves you're given has every column you can play. Win at once if you can; otherwise block the other player's immediate win (a spot that completes four for them and that a disc dropped now would land on); don't play directly under a spot where the other player would complete four; and prefer the middle columns.`,
};
