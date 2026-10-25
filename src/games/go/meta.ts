import type { GameMeta } from "../types";

export const goMeta: GameMeta = {
  id: "go",
  name: "Go",
  tagline: "Surround territory, capture stones. The oldest board game there is.",
  minPlayers: 2,
  maxPlayers: 2,
  tags: ["hot-seat"],
  rules: `Two players, Black and White, take turns putting a stone of their color on an empty point of the board (where the lines cross), or passing. Black moves first. Stones never move once they're down.
- Stones of one color that touch along the lines form a group. The empty points next to a group are its liberties. Take away a group's last liberty and it's captured: it comes off the board.
- You can't play where your stone would have no liberties, unless it captures something.
- Ko: you can't make a move that brings back a position the board has had before (so you can't take back a single stone straight away; play elsewhere first).
- When both players pass in a row, play stops and the game is counted. Groups that can't escape being captured are dead: they're marked and taken off. Either player can mark a group dead or alive, and when both accept the marking the score is final. Either can resume play instead, to settle it on the board.
- Score: your stones on the board plus the empty points only you surround. White gets 7.5 points of komi for moving second. Most points wins; there are no draws.
- A group needs two separate eyes (enclosed empty points) to live for good. Corners and edges are easiest to make territory in.
- Each player has main time and then a few short byo-yomi periods (if the game has a clock): a move within a period keeps it, letting one run out uses it up, and running out of the last loses. You can also resign.
- Colors swap every game.`,
  botNotes: `Points are named like D4: a column letter (A to T, skipping I, left to right) and a row number counted from the bottom (1 is the bottom row). In the view, "rows" is the board as strings, the top row first (so rows[0] is the row numbered with the board size), with "b" for Black, "w" for White and "." for empty; "you.color" is your color; "turn" whose move it is; "captures" the stones each side has taken; "moves" the game so far (point null for a pass); "lastMove" the last stone played and what it captured; "passed" who passed last, if the very last move was a pass; "ko" points you can't play now because of ko; "clock" each side's main time (ms) and byo-yomi periods left. A move is {"type":"play","point":"D4"}, or {"type":"pass"}; you're given every legal point. Pass when there's nothing left worth playing; if the other side has just passed, passing too ends play and goes to counting. While counting ("phase":"scoring"), {"type":"mark","point":...} marks the group on that point dead (or alive again), {"type":"accept"} accepts the marking as shown in "scoring" (dead stones, the score), and {"type":"resume"} goes back to playing.`,
};
