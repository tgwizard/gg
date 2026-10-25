import type { GameMeta } from "../types";

export const chessMeta: GameMeta = {
  id: "chess",
  name: "Chess",
  tagline: "The classic, with chess clocks. Colors swap every game.",
  minPlayers: 2,
  maxPlayers: 2,
  tags: ["hot-seat"],
  rules: `Two players, White and Black, take turns moving one piece; White moves first. Checkmate the other king (attack it so it has no way out) to win.
- Kings move one square any way; queens any distance in a straight line or diagonal; rooks straight; bishops diagonally; knights in an L, jumping over pieces. Pawns move one square forward (two from their starting square) and take diagonally forward.
- Castling: the king moves two squares toward a rook and the rook jumps over it. Only if neither has moved, nothing is between them, and the king isn't in check, doesn't pass through check and doesn't land in it. To castle here, move your king two squares toward the rook, or onto the rook.
- En passant: right after a pawn steps two squares past an enemy pawn beside it, that pawn can take it as if it had stepped one.
- A pawn reaching the far end becomes a queen, rook, bishop or knight.
- You can't make a move that leaves your own king in check. With no legal move and not in check, it's stalemate: a draw.
- Also draws: the same position three times, fifty moves each with no capture or pawn move, too little material for anyone to mate, or a draw offer accepted.
- Each player has a clock and gains a few seconds for every move (if the game has a clock). Run out of time and you lose, unless the other side has only a king left: then it's a draw. You can also resign.
- Colors swap every game.`,
  botNotes: `Squares are named a1 (White's bottom left) to h8. Moves are in UCI: the from square and the to square, plus the piece letter when a pawn promotes: {"type":"move","move":"e2e4"}, castling as the king's two-square move {"type":"move","move":"e1g1"}, promotion {"type":"move","move":"e7e8q"}. In the view, "fen" is the position, "board" the same as 8 rows from rank 8 down to rank 1 (files a to h, White uppercase, Black lowercase, "." empty), "moves" the game so far in SAN (with "took": the piece taken), "lastMove" the last move (UCI, SAN, the piece that moved and what it took), "you.color" your color ("w" or "b"), "clock" the milliseconds left on each clock, and "drawOffer" whose draw offer is standing. Other moves: {"type":"offerDraw"}, {"type":"acceptDraw"}, {"type":"declineDraw"}. Check that a capture doesn't lose the piece back for more, and look for checks, captures and threats on both sides before you move.`,
};
