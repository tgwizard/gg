# Luffarschack

How it's built, for working on it: the platform it sits on (rooms, the game contract, the
kit, bots) is in [docs/ARCHITECTURE.md](../../../docs/ARCHITECTURE.md).

The Swedish pen-and-paper five in a row, for two, on a sheet of squared paper of 15×15, 19×19
(the default) or 25×25, built like Four in a Row (seating, calling the game off if you leave
before your first mark, the first cross alternating between games) with a turn timer.
- **The rules** (`rules.ts`) work on the sheet as a string of n² cells ("x" for whoever starts
  this game, "o", "."), row by row from the top. Squares are named like spreadsheet cells: a
  column letter and a row from 1 at the top ("A1" is the top left), which is also the move:
  `{type: "mark", square: "J10"}`. Five or more in a row wins (the Swedish way, with no
  setting for exactly five), across, down or diagonally. `winningRuns` gives each winning
  line's ends (two at once included); a full sheet is a draw.
- **The turn timer** (`turnSeconds`, default 60, 0 for none) is per mark: run out and you lose.
- **The sheet** (`ui/Sheet.tsx`) is one SVG in squares of 100 units: faint blue rulings over
  the whole paper (with grain and a little light from tokens), a red margin, letters and
  numbers in pencil and a ruled pencil frame around the playing area. Marks are hand-drawn
  (`ui/ink.ts`): each cross is two slightly bowed strokes ending in a flick, each circle one
  lopsided loop that runs on past its start, with jitter from a seed made from the game, the
  move and the square, so every mark is different but the same on every render and refresh.
  An SVG filter roughens their edges and makes the ink uneven. Ink is the player's color at a
  pen's lightness (`oklch(from …)`, dark on light paper, light on the dim paper of dark mode;
  clashing colors are split as in Four in a Row). A new mark is drawn stroke by stroke
  (`stroke-dashoffset`) with a soft pen scratch (sound `pen`), live moves only; the last mark
  gets a stroke of highlighter, and a winning five is ringed by hand, in a rough loop, in the winner's
  ink. Pointing at a square pencils your mark in; on touch screens the first tap pencils it in, boxed in the
  accent color with its row and column shaded (nothing goes over the sheet), and a second tap
  inks it (or *Mark J10* under the sheet); the
  arrow keys move a dotted cursor and Enter marks. Colors are tokens (`--lfs-*`).
- **The built-in bot** (`bot.ts`) reads threats rather than searching: for each empty square
  near the marks it asks what a mark there makes, line by line, for itself and (as a block)
  for the other side: five, an open four, a four, an open three, a closed three, or room to
  grow, with extra for a four and an open three at once or two open threes. It takes a five,
  then stops one, then plays a win by fours (VCF: fours the other side must answer, until one
  can't be), and otherwise takes the best square (a little randomness among near-equals),
  with a bonus for the first square of the other side's win by fours. It takes a few
  milliseconds a move.

## QA

Manual checks for after a change to this game (how to run them: [docs/QA.md](../../../docs/QA.md)).

- [ ] Setup: sheet size (15×15, 19×19, 25×25) and the turn timer with *Disable timer*; the gear shows them during the game.
- [ ] Nobody seated: a "Take a seat" prompt over a faded sheet; the second player sitting starts the game; seat 0 draws the first cross.
- [ ] The sheet looks like squared paper in both modes: faint blue squares, a red margin, letters and numbers in pencil, a pencil frame round the playing area; dark mode is dim paper with light ink.
- [ ] On your move, pointing at a square pencils your mark in faintly; clicking inks it. On a phone the first tap pencils it in and a second tap on the same square inks it. Out of turn nothing shows. Keyboard: focus the sheet, the arrows move a dotted cursor (from the last mark), Enter or Space marks.
- [ ] A mark: drawn stroke by stroke (a cross's two strokes one after the other, a circle in one loop) with a soft pen scratch, live only (not after a refresh). Every cross and circle looks a little different and doesn't change on refresh. The last mark has a stroke of highlighter; the panel says it ("Bob drew a circle on H8. Mark 12.").
- [ ] Ink is the players' colors, readable on the paper in both modes (also for dark colors like Charcoal, and light ones like Mustard); two similar colors are split.
- [ ] Blocking (`/try/luffarschack/block`, `/try/luffarschack/open-three`) and winning (`/try/luffarschack/win`): five in a row gets a rough hand-drawn loop around it in the winner's ink, and the results follow a moment later. *See the board* shows it. Six in a row wins too.
- [ ] A full sheet (`/try/luffarschack/nearly-full`) ends in a draw.
- [ ] Turn timer: the bar runs down, with the heartbeat in the last 10 s; running out loses. *Resign* asks first. Leaving before your first mark calls the game off; after, it's a loss.
- [ ] Against a built-in bot: it answers within about a second, never misses a five or a four to block, blocks open threes, and finishes with fours when it can.
- [ ] Laptop (1440×900): sheet, players and panel fit without scrolling, on 19×19 and 25×25 (`/try/luffarschack/big-sheet`). Phone: opponent above the sheet, you below; squares are small, so the first tap pencils the square in, boxed, its row and column shaded, with nothing covering the sheet; the status line says "J10 is pencilled in: tap it again to ink it." with *Mark J10* and *Pick another* under it. No turn chime in Luffarschack, only the pen.
