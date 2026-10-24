import type { GameMeta } from "../types";

export const luffarschackMeta: GameMeta = {
  id: "luffarschack",
  name: "Luffarschack",
  tagline: "Crosses and circles on squared paper. First to five in a row wins.",
  minPlayers: 2,
  maxPlayers: 2,
  wip: true,
  rules: `The Swedish pen-and-paper game, also called five in a row. Two players take turns marking an empty square on a sheet of squared paper: one draws crosses (X), the other circles (O). X goes first.
- The first to get five of their marks in an unbroken line wins: across, up and down, or diagonally.
- Six or more in a row wins too.
- If the sheet fills up with no five in a row, it's a draw.
- Watch for the other player's open threes (three in a row with room at both ends) and fours: an open four can't be stopped, since it can be finished at either end. Try to make two threats with one mark.
- If the game has a turn timer and you run out of time, you lose. You can also resign.
- Players take turns drawing the first cross from one game to the next.`,
  botNotes: `Squares are named like spreadsheet cells: a column letter (A is the left column) and a row number (1 is the top row), so "A1" is the top-left square and, on a 19×19 sheet, "S19" the bottom right. In the view, "size" is the sheet's width and height in squares; "rows" is the sheet as strings, row 1 (the top) first, the first character of each string being column A, with "x" for crosses (whoever started this game), "o" for circles and "." for empty squares; "you.piece" is yours; "turn" whose move it is; "moves" the game so far (square names, in order); "lastMove" the latest mark. Five or more in a row wins. A move is {"type":"mark","square":"J10"} on any empty square. Win at once if you can; otherwise block the other player's four (a line of four with an empty square to finish it, gaps included, like "xx.xx") and open threes (".xxx." with room to spare); play near the action rather than at the edges.`,
};
