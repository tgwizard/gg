# Four in a Row

How it's built, for working on it: the platform it sits on (rooms, the game contract, the
kit, bots) is in [docs/ARCHITECTURE.md](../../../docs/ARCHITECTURE.md).

Four in a Row for two on an upright board of 7×6, 8×7 or 9×7, built like Othello (seating,
calling the game off if you leave before moving, Fischer clocks).
- **The rules** (`rules.ts`) work on the board as a string of columns × rows cells ("x" for
  whoever starts this game, "o", "."), row by row from the top; columns are numbered from 1 on
  the left, rows from 1 at the bottom. A disc falls to the lowest empty cell. A disc that makes
  four or more in a line wins (`fourThrough` gives every disc in such lines, two lines at
  once included); a full board is a draw. A move is `{type: "drop", column}`.
- **Who starts:** by default players take turns; with `opener: "loser"` the loser of each game
  starts the next (after a draw, the other player). The next opener is kept in state
  (`nextXSeat`), so a game called off is replayed with the same one.
- **Colors:** discs are drawn in the players' own colors. If the two are too alike (OKLab
  distance under 0.16, `ui/colors.ts`), the viewer keeps theirs and the other side's discs get
  the palette color furthest from it.
- **The board** (`ui/Board.tsx`): an SVG wooden front with a hole per cell, over the discs.
  Pointing at a column (or ←/→, Home/End) holds your disc over it and marks where it would
  land; click, tap, Enter, Space or a digit drops it (shown at once, taken back if refused). A
  new disc falls in behind the front with gravity and a small bounce (sound `drop`, timed to
  the landing), live moves only. The last disc has a dot; at the end a gold line joins the
  winning discs, which glow while the rest dim, and the results come up 1.6 s later. Colors
  are tokens (`--fiar-*`) plus the players' colors.
- **The built-in bot** (`search.ts`, `bot.ts`) searches: negamax with alpha-beta (principal
  variation search), iterative deepening, a transposition table and move ordering, within 450
  ms and 14 moves on the page. It always takes a win it can see, blocks a threat without using
  up depth, and never drops under the other side's winning spot. Its evaluation counts the
  lines of four still open to each side and the threats, which count most on rows of the right
  parity (with an even number of rows) and not at all above the other side's lower threat in
  the same column. It opens in the middle and varies its first moves among near-best ones.
  With `quick` it looks 4 moves ahead with no time limit, so set-up positions are repeatable.

## QA

Manual checks for after a change to this game (how to run them: [docs/QA.md](../../../docs/QA.md)).

- [ ] Setup: board size (7×6, 8×7, 9×7), who starts (take turns / loser starts) and clock presets; *No clock* hides the clocks.
- [ ] Nobody seated: a "Take a seat" prompt over a greyed board; the second player sitting starts the game; seat 0 starts.
- [ ] On your move, pointing at a column holds your disc over it, lights the column and shows a faint disc where it would land; a full column shows the disc faded and can't be clicked. Out of turn nothing shows and clicks do nothing. Keyboard: focus the board, ←/→ (or Home/End) and Enter/Space drop; a digit drops straight into that column.
- [ ] A move: the disc falls behind the front of the board (seen through the holes), bounces a little and knocks; the last disc has a dot. The panel says it ("Bob dropped a disc in column 4.") and the move list follows.
- [ ] Discs are the players' colors and easy to tell apart in both modes; with two similar profile colors (e.g. Terracotta and Tomato) the other side's discs switch to a contrasting color, and the plates' small discs match.
- [ ] Blocking (`/try/fourinarow/block`) and winning (`/try/fourinarow/win`): dropping the four draws a gold line through it, the four glow and the rest dim, and the results follow a moment later. *See the board* shows the line. *Play again* says who starts (taking turns, or the loser).
- [ ] A full board (`/try/fourinarow/nearly-full`) ends in a draw.
- [ ] Clocks: only the side to move runs, the increment is added per move; running out loses. *Resign* asks first. Leaving before your first disc calls the game off; after, it's a loss.
- [ ] Against a built-in bot: it answers within a couple of seconds, never misses a win or a block, and is hard to beat.
- [ ] Laptop (1440×900): board, players, clocks and panel fit without scrolling, on 7×6 and 9×7 (`/try/fourinarow/big-board`). Phone: opponent above the board, you below, columns easy to tap. Both modes: wood, holes, discs and the winning line readable.
