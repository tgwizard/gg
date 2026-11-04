# Chess

How it's built, for working on it: the platform it sits on (rooms, the game contract, the
kit, bots) is in [docs/ARCHITECTURE.md](../../../docs/ARCHITECTURE.md).

Standard chess for two, with chess clocks.
- **The rules** (`rules.ts`) are pure functions over a position (64 squares, a1 = 0):
  legal moves (castling through or out of check refused, en passant, promotions,
  pins), making a move, SAN and FEN, threefold-repetition keys (an en passant square
  only counts when a pawn can take there) and insufficient material. It's checked
  against the standard perft counts, and the board in the browser uses the same code
  to show legal moves without asking the server.
- **State** keeps the position as a FEN string, the moves (UCI and SAN), and the
  position keys since the last capture or pawn move for repetition. A move op is UCI
  (`{type: "move", move: "e7e8q"}`), which is also what AI bots send.
- **Games** start when both seats fill; *Play again* starts the next with colors
  swapped. They end on the board (mate, stalemate, repetition, fifty moves, too
  little material) or off it (resigning, an accepted draw, time, leaving). Leaving
  before your first move calls the game off unscored. One draw offer per move; it
  stands until the other side answers or moves.
- **Clocks** are Fischer: `minutes` each plus `increment` seconds per move. Only the
  side to move's clock runs (`clock` is the time left as of `clockSince`), and its flag
  is the game's one timer. Running out loses, or draws if the other side has only a
  king. `minutes: 0` means no clock.
- **The board** (`ui/Board.tsx`): click-click or drag, legal-move dots and capture
  rings, last move and check highlights, a promotion picker on the file, and moves
  slide into place (not the ones you dragged, nor with reduced motion) while a taken
  piece is knocked off its square. The king can castle by moving two squares or onto
  its rook: with the king picked up, both squares are marked (the rook tagged
  *castle*), pointing at one shows the king and rook where they'd end up, and the panel
  says how, or why not now (`castlingOptions`: pieces between, in check, crossing an
  attacked square). Each move records the piece and what it took (`moveFacts`), so the panel
  says the last move in words ("Rivet's queen took your bishop on d5. Check!") and the
  move list marks captures and checks. Your move
  shows at once and is taken back if the server refuses it.
- **Premoves** are the browser's alone: the server only ever sees an ordinary move.
  While the other side is to move (or your own move is on its way), picking up a piece
  queues one up, from `premoves` (how the pieces move whatever the other side does
  first: your own pieces block a line but can be aimed at, to take back; one of theirs
  may step aside; castling if only their pieces are in the way). One at a time, shown
  in blue squares with its piece faint where it's going, and in the panel, called off by clicking an empty square, a right-click, Escape
  or *Cancel*. It's sent the moment the view says it's your turn, if it's legal then
  (otherwise the panel says it couldn't be). It belongs to the position, game and
  player it was made by, so a failed move of yours, a new game or a hot-seat hand-over
  drops it. Pieces are Cburnett's
  SVGs (BSD) in `public/pieces`; square colors are tokens (`--board-*`).

- **The built-in bot** looks one move ahead (mates, material, no free pieces for the other
  side) with some randomness; easy doesn't look ahead.

## QA

Manual checks for after a change to this game (how to run them: [docs/QA.md](../../../docs/QA.md)).

- [ ] Setup: the time-control presets fill in minutes and increment; *No clock* hides the clocks.
- [ ] Nobody seated: a "Take a seat" prompt over a greyed board; seated alone, "Waiting for an opponent". The second player sitting starts the game; seat 0 has White first.
- [ ] Moving: click a piece then a square, or drag it. Legal squares get dots (rings for captures); a second click on the piece puts it down. Out of turn only premoves (below); the other side's pieces never pick up. Black's board is upside down; ⇅ flips it.
- [ ] Castling both ways (king two squares, or king onto the rook), en passant, and promotion (a picker of four pieces on the file; Escape cancels). The check square glows red with a pulse.
- [ ] Castling is easy to find (`/try/chess/castling`): picking up the king rings both squares in gold and tags the rook *castle*; pointing at either shows the king and rook where they'd end up; the panel says how ("put your king on g1, or on the rook on h1") or why not ("Clear b1, c1 and d1 first", "Not while your king is in check", an attacked square).
- [ ] Premoves: while the other side thinks, move a piece as usual: blue dots, then its two squares in blue, the piece faint on the square it's going to (the rook too, castling) and "Premove: …" in the panel. It's played the moment they move (the clock barely ticks); if it's no longer legal, the panel says it couldn't be. An empty square, a right-click, Escape or *Cancel* calls it off (Escape in the promotion picker only closes the picker); a piece picked up while waiting stays picked up when your turn comes. Recapturing works (premove onto your own piece that they're about to take).
- [ ] After each move the panel says it in words with little pieces ("Alice's bishop took your pawn on f7. You're in check!"), from your side ("Your…", "your…"). A taken piece is knocked off its square; captures show the taken piece in the move list, checks are red.
- [ ] Clocks: only the side to move runs, the increment is added after each move, tenths show under 10 s and it turns red under 20 s. Let one run out: a loss on time (a draw if the other side has only a king).
- [ ] Draws: *Offer draw* shows Accept/Decline to the other side; moving declines it; you can't offer again until the next move. Repetition, stalemate and insufficient material end the game on their own.
- [ ] *Resign* asks first. The result shows in the panel and in chat; *Play again* swaps colors. Captured pieces and the material lead show under each name.
- [ ] Leaving before your first move calls the game off; after, it's a loss.
- [ ] *Copy PGN* pastes into an analysis board (e.g. lichess.org/paste).
- [ ] Against a built-in bot: it answers within a couple of seconds and rarely leaves a piece to be taken for free.
- [ ] Laptop (1440×900 and 1280×800): board, players, clocks and moves fit without scrolling. Phone: opponent above the board, you below, moves in a strip.
