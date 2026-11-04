# Go

How it's built, for working on it: the platform it sits on (rooms, the game contract, the
kit, bots) is in [docs/ARCHITECTURE.md](../../../docs/ARCHITECTURE.md).

Go for two on 9×9, 13×13 or 19×19, built like Othello (seating, colors swapping every
game, calling the game off if you leave before moving), with byo-yomi clocks.
- **The rules** (`rules.ts`) work on the board as a string of size² cells ("b", "w",
  "."), points named the Go way (a column letter skipping I, the row from the
  bottom: A1 is the bottom left). No suicide, and positional superko: no move may
  bring back any earlier position. The state keeps every position as a short hash
  (`positionKey`, two 32-bit hashes) rather than whole boards. Scoring is by area
  (stones plus surrounded points, dead stones taken off), with 7.5 komi for White.
  The view lists the points ko forbids (`ko`) for the board's marker.
- **Counting** is a phase of its own. Two passes in a row stop play; the server
  guesses the dead stones (`estimateDead`, random playouts from the final position),
  and either player can mark a group dead or alive (which withdraws both
  acceptances). When both accept, the game is scored as marked. Either can resume
  play instead (the other side moves first). Counting has no clock but a deadline:
  quiet for 3 minutes and it's scored as marked. A counted game keeps its marking
  after it's over, so the board shows the territory under the end screen.
- **Clocks** are byo-yomi: main time, then periods of a few seconds; a move made
  within a period keeps it, letting one run out uses it up. One flag timer per turn,
  at main time plus all periods; `spend` works out what's left when the move comes.
- **The bot** (`montecarlo.ts`, `bot.ts`) is Monte Carlo: fast playouts on typed
  arrays (random moves that never fill their own eyes and take stones left in atari
  by the last move) score each candidate move, steered by UCB and RAVE (credit for a
  point played anywhere later in a playout), within 5000 playouts or 350 ms on the
  page. It skips edge moves with nothing near, passes when every open point is
  settled one way (by playout ownership) or when the other side has passed and it's
  ahead, and resigns hopeless games late on. While counting it corrects the marking
  only where it's clearly wrong against it, then accepts; two bots can't fight over
  a group. With `quick` (tests, set-up positions) it uses 40 playouts.
- **The board** (`ui/Board.tsx`): an SVG grid with stones as gradient discs (tokens
  `--go-*`, `--stone-*`). Pointing shows your stone; on a touch screen a 13×13 or
  19×19 board takes two taps on the same point (the stone appears lightly first).
  A new stone clacks down and captured ones lift off; the last stone has a ring.
  While counting, dead stones fade, each side's area gets small squares, and
  clicking a stone marks its group.

- **Bounded games.** Play-resumes from counting are limited to 3 per game, and any game that
  reaches 4 moves per point (324 on 9×9) is counted, so no-progress pass/resume cycles can't
  grow a game without bound.

## QA

Manual checks for after a change to this game (how to run them: [docs/QA.md](../../../docs/QA.md)).

- [ ] Setup: 9×9, 13×13 and 19×19 each offer their own clock presets; *No clock* hides the clocks.
- [ ] Nobody seated: a "Take a seat" prompt over a greyed board; the second player sitting starts the game; seat 0 has Black, who moves first.
- [ ] On your move, pointing at a point shows your stone there (not on taken points, suicide or a ko). On a phone, 13×13 and 19×19 need a second tap on the same point.
- [ ] A move: the stone clacks down; captured stones lift off; the last stone has a ring. The panel says it ("Bob played D4 and captured 2 stones."), and each plate counts the stones taken.
- [ ] Ko (`/try/go/ko`): the point you can't retake has a red square; clicking it does nothing. Play elsewhere, and after White answers it can be taken.
- [ ] Passing: "Bob passed. Pass too and play stops for counting."; the button says *Pass & count*.
- [ ] Counting (`/try/go/counting`): dead stones fade, territory shows as small squares, the score bar and the plates show points (White with komi). Clicking a group marks it dead or alive and withdraws both acceptances; *Accept score* from both ends it; *Resume play* goes back to playing with the other side to move. A countdown says when it's scored as marked.
- [ ] The end (`/try/go/game-over`): the end screen with points; under it, the board still shows the territory. *Play again* swaps colors.
- [ ] Clocks: main time, then "byo-yomi · 3 left" counting down a period; moving in time keeps the period, letting it run out uses one up; out of periods loses. *Resign* asks first. Leaving before your first move calls the game off.
- [ ] Against a built-in bot on 9×9: it answers in under a second, captures stones left in atari, and passes when the game is decided. In counting it fixes a marking that's wrong against it and accepts.
- [ ] Laptop (1440×900): board, players, clocks and panel fit without scrolling. Phone: 19×19 (`/try/go/big-board`) is playable with two taps. Both modes: stones, lines, coordinates and territory readable.
