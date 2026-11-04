# Othello

How it's built, for working on it: the platform it sits on (rooms, the game contract, the
kit, bots) is in [docs/ARCHITECTURE.md](../../../docs/ARCHITECTURE.md).

Othello for two, built like chess (the two share the seating, colors swapping every
game, calling the game off if you leave before moving, and Fischer clocks).
- **The rules** (`rules.ts`) work on the board as a 64-character string ("b", "w",
  "."), a1 at the top left as Othello boards are written: what a disc would turn
  over, the legal moves, playing one. The browser uses the same code for the hints.
- **Passing** is never a choice: after a move, if the other side has no move but the
  mover does, the server records a pass for them and it's the mover's turn again, so
  the game only waits on someone who can move. When neither can, it's over: most discs
  wins, equal is a draw. Moves record what they turned over, and the view has the last
  disc set down (`lastMove`, with `flipped`) and who passed after it (`passed`).
- **The board** (`ui/Board.tsx`): your legal squares get a faint disc; pointing at one
  shows your disc and marks what it would turn over; click to play (shown at once,
  taken back if refused). A new disc drops in and the trapped ones flip in 3D (two
  faces back to back), outward from it one step at a time, live moves only. Colors are
  tokens (`--othello-*`, `--disc-*`).
- **The built-in bot** weighs squares the classic way (corners high, the squares next to
  an empty corner low), likes leaving few replies, and avoids opening a corner.

## QA

Manual checks for after a change to this game (how to run them: [docs/QA.md](../../../docs/QA.md)).

- [ ] Setup: the presets fill in minutes and increment; *No clock* hides the clocks.
- [ ] Nobody seated: a "Take a seat" prompt over a greyed board; the second player sitting starts the game; seat 0 has Black, who moves first.
- [ ] On your move the playable squares show a faint disc; pointing at one shows your disc and rings the discs it would turn over (the rest of the time, nothing). Out of turn nothing is marked and clicks do nothing.
- [ ] A move: the disc drops in with a soft click and the trapped discs flip one after another outward from it; the last disc has a small dot. The panel says it in words ("Bob played f5 and turned over 3 discs."), the score bar and the counts under each name follow.
- [ ] Passing (`/try/othello/pass`): the panel says "Bob has no move: your turn again.", the move list shows the pass, and it stays your turn.
- [ ] The last square (`/try/othello/last-move`): filling it ends the game; the end screen shows the discs. *Play again* swaps colors.
- [ ] Clocks: only the side to move runs, the increment is added per move; running out loses. *Resign* asks first. Leaving before your first move calls the game off; after, it's a loss.
- [ ] Against a built-in bot: it answers within a couple of seconds and grabs corners when it can.
- [ ] Laptop (1440×900): board, players, clocks and panel fit without scrolling. Phone: opponent above the board, you below. Both modes: discs, hints and coordinates readable.
