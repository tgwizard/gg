# QA playbook

Run this after big changes (protocol, room server, client networking, game engines,
layout). Automated layers come first; the manual scenarios cover what automation
covers poorly: real browsers, real network weirdness, and how things look.

## 1. Automated (always)

```sh
pnpm test:all           # typecheck + unit + integration + e2e
```

| layer | where | what it covers |
| --- | --- | --- |
| unit | `src/**/*.test.ts` | game kit, hand evaluator, poker and tic-tac-toe rules, redaction, and the conformance fuzzer every game must pass (including a table of its built-in bots) |
| integration | `test/integration` | the real Worker + Room DO in workerd over WebSockets: joining, identity, chat catch-up, idempotency, stale ops, secret redaction on the wire, eviction, alarms, rate limits, room expiry |
| e2e | `test/e2e/*.spec.ts` | real browsers, multiple players: rooms, chat, refresh, offline, dropped and half-open sockets, a full poker hand, turn timer, how limits look, playing a bot |

Visual snapshot of the main screens (desktop and mobile), for eyeballing layout changes:

```sh
pnpm dev --port 5311 &
node test/e2e/screens.ts http://localhost:5311 ./screens        # rooms + poker
node test/e2e/screens-fish.ts http://localhost:5311 ./screens   # Finns i sjön
node test/e2e/screens-battleship.ts http://localhost:5311 ./screens   # Battleship, light + dark
node test/e2e/screens-ticket.ts http://localhost:5311 ./screens       # Coast to Coast, light + dark
node test/e2e/screens-chess.ts http://localhost:5311 ./screens        # Chess, light + dark
node test/e2e/screens-othello.ts http://localhost:5311 ./screens      # Othello (from /try), light + dark
node test/e2e/screens-go.ts http://localhost:5311 ./screens           # Go (from /try), light + dark
node test/e2e/screens-fourinarow.ts http://localhost:5311 ./screens   # Four in a Row (from /try), light + dark
node test/e2e/screens-luffarschack.ts http://localhost:5311 ./screens # Luffarschack (from /try), light + dark
node test/e2e/screens-cannons.ts http://localhost:5311 ./screens      # Cannons (from /try), light + dark
node test/e2e/screens-femkort.ts http://localhost:5311 ./screens      # Fem kort (from /try), light + dark
```

End screens and late-game situations, without playing a whole game (local dev server
only; not on gg.tgwizard.com): `/try` (linked from the home page footer in dev) sets up a practice room in a chosen position with
built-in bots, e.g. `http://localhost:5311/try/chess/checkmate`. `pnpm scenario` lists
every link (`pnpm scenario coast game-over --open` opens one; `--base` for another
server). Each opens a new room, so it's also a quick way to get a fresh table.

## 2. Manual scenarios

Use separate browser profiles or incognito windows for separate players (each
profile is a separate identity). With Claude: "run the QA playbook". It drives
these through the browser and reports back.

### Rooms & identity
- [ ] Home, new browser: Profile (name + color, saved in the browser, a random color to start), Start a room (optional name), Join a room.
- [ ] Home, once you have a name: your avatar and name in the corner (click to edit) by a settings cog; Start a room and Join a room side by side (stacked on a phone, with *Create a room* on the first screen); *Your rooms* lists rooms you've been in, newest first, with the game that was on (a waiting table before one) and who you played with, bots too (avatars, and "(bot)" in the line); one click goes back in. A room that's gone drops off the list once you've tried it.
- [ ] Two people pick the same color: whoever joined first keeps it, the other sees "X is taken here, so you're Y" and gets the next free color; taken colors are marked in the profile picker (top right).
- [ ] Rename the room from the top bar: everyone sees the new name and a chat note; clearing it shows "Name this room".
- [ ] Create a room from the home page. The URL is `/r/<10-char code>`, and the status light in the top bar is green; hovering or clicking it shows latency, since when, and reconnects.
- [ ] The people icon by the room's name shows the code and Copy invite link on hover, and stays open on click. Before a game, "Invite friends to play" shows the link, who's here (click yourself or your bots to edit), and *+ Invite a bot*.
- [ ] The top bar: the status light, the sound switch (not on a phone) and a cog (sound, dark mode, *All settings*) by your name. On a phone it's one row: the room name shortens and your name is just your avatar.
- [ ] Type the code (lower-case, with a space) into *Room code or link* on the home page: it shows upper-case and joins the room.
- [ ] With 1Password (or another password manager) installed, the name, code and chat inputs don't offer to autofill.
- [ ] Open the invite link in another profile: you're asked for a name once, then you join. Both member lists show two people online.
- [ ] Reload: same member, no new "joined" message, chat history intact.
- [ ] Open the same room in a second tab of the same profile: still one member.
- [ ] Rename: the other player sees "X is now known as Y", and the new name sticks in new rooms.
- [ ] Mistyped room link: "Room not found" with a way out.
- [ ] *Hide chat* folds the members and chat into a slim rail (people online, a chat button counting new messages); it stays folded after a reload, and *Show chat* brings it back. Narrow windows always show it under the game.

### Connection resilience
- [ ] DevTools → Network → *Offline*: the pill goes red and a banner appears. Chat typed now shows as pending. Back online: it's delivered, missed messages arrive, and the banner goes away.
- [ ] Network throttling *Slow 3G*: actions still work, with no duplicates after rapid clicks.
- [ ] Kill the dev server mid-hand and restart it: clients reconnect on their own (backoff, then *Retry now* works) and the hand continues where it was.
- [ ] Close the laptop lid or background the tab for 5+ minutes: on return, it reconnects within seconds and catches up.
- [ ] Phone: switch between Wi-Fi and cellular mid-game.
- [ ] The other player sees you go grey (away) while you're disconnected, and green again after.

### Poker rules (3+ players where relevant)
- [ ] Heads-up: the button posts the small blind and acts first preflop, last after.
- [ ] Three-handed: the big blind gets the option when everyone limps.
- [ ] Min-raise: after a raise of X, the next raise must be at least X more. The UI's *Min* matches.
- [ ] A short all-in that isn't a full raise: players who already acted can only call or fold.
- [ ] All-in with different stack sizes: side pots are paid to the right people (check the chat announcements).
- [ ] Split pot (board plays): the odd chip goes to the first winner left of the button.
- [ ] All-in before the river: hands flip and the board deals street by street.
- [ ] Turn timer: idle player is checked/folded and marked *Sitting out*; *I'm back* resumes dealing.
- [ ] Bust out → *Rebuy* appears between hands.
- [ ] *Fold & leave seat* mid-hand: you fold, your blind stays in the pot, and the hand carries on.
- [ ] Sitting down mid-hand: you're dealt in on the next hand.
- [ ] Motion: dealing sends cards from the middle to each seat in turn; when a betting round ends the bets slide into the pot; new board cards (and hands shown at the showdown) turn over; the pot flies to the winner. A refresh mid-hand shows the table still. Nothing moves with reduced motion.
- [ ] *Your hand* in the tray names what you hold so far ("Pair of Nines", "Two Pair, Kings and Nines"), only to you, while you're in the hand.
- [ ] Once the game's going, seated players don't see open-seat boxes; someone watching still sees *Sit here*.

### Secrets
- [ ] DevTools → Network → WS → Messages on player A: no card codes from B's hand ever appear before showdown, and no `deck`.
- [ ] Spectator sees only card backs until showdown. At showdown, only hands that reached it are shown.

### Limits & expiry
- [ ] Mash Cmd+R ~15 times on a room: you land connected with no banner or toast, and you're one member, not several.
- [ ] Paste 20 chat messages as fast as possible: a "going a bit fast" toast appears, and the refused text is back in the input.
- [ ] Create 11 rooms within a minute: the 11th shows a friendly "try again in a minute" message.
- [ ] (Automated only) a connection told to back off shows the server's reason, hides "Retry now", and reconnects after the requested delay. Expiry runs in integration tests, by back-dating the room's stored timestamps.

### Finns i sjön
- [ ] When cards change hands, everyone sees exactly which cards (in the strip under the table and the history), as at a real table.
- [ ] Seats stay where people sat (no rotating so you're at the bottom); step away / leave are small links under the tray, not in it.
- [ ] 2–3 players get 7 cards, 4–6 get 5; the lake count matches.
- [ ] Pick a card, then an opponent; *Ask X for Ys*. If they have some, they move to your hand and it's still your turn.
- [ ] "Finns i sjön!": you draw (only you see the card under "You drew"); catching the asked rank shows it to everyone and gives you another turn.
- [ ] Four of a kind is laid down at once (book badge + chat announcement).
- [ ] Let the turn timer run out: your move is made for you and you're marked away; later turns are auto-played until *I'm back*. Coming back mid-turn gives you what's left of that turn, not a fresh clock.
- [ ] *Leave game* mid-game: your cards go back to the lake and the others play on (with two players, the other wins).
- [ ] Play to the end: all 13 books down, winner(s) announced, *Play again* deals a new game with whoever's seated.
- [ ] Phone layout: opponents, lake, news line and your hand all fit, and cards are tappable.
- [ ] Motion: the deal flies from the lake to each seat (into your hand for you); cards handed over after an ask fly from one player to the other; "Finns i sjön!" splashes the lake and the catch flies to whoever fished (face up only for them, or for everyone when it was the rank asked for); a book's four cards fly to its badge, which pops in. Nothing moves with reduced motion.
- [ ] Your hand groups cards of a rank together; three of a kind is marked "one more!". Once the game's going, seated players don't see open-seat boxes.

### Fem kort
- [ ] Setup: deals to win (buttons), turn timer, and the överstick (off by default) / two in a row / bättre kort checkboxes; the gear shows them during the game. Played cards sit on the felt, clear of every seat's hand, with 2 to 6 players.
- [ ] Two to six sit down; *Deal* gives five cards each (three, then two, flying from the middle). Nobody sees anyone else's cards (DevTools → WS: no card codes from other hands, no stock). Once the game's going the table closes up around the players.
- [ ] Your lead: "Your lead: any card." Following: only legal cards are lit, the rest dimmed; the hint says "Follow hearts and beat the K♥: you have to if you can", "Follow hearts: you can't beat the K♥" or "No hearts: play any card". With överstick off, any card of the suit led.
- [ ] Played cards fly to the felt in front of each player; the card winning so far is ringed in gold; a taken trick stays a moment, then is gathered to its winner, who leads (the news strip says so).
- [ ] The last trick (`/try/femkort/last-trick`): the fifth pip lights gold, "Last trick!" pops in, the felt ring glows, and the hint says "Last trick!". Taking it: the card pulses gold, a star pops onto the plate, "You win deal N"; the next deal comes after a few seconds with the dealer chip moved on.
- [ ] *Keep the king?* (`/try/femkort/fourth-trick`): leading the 4♥ keeps the K♠ to take the last trick; leading the K♠ loses it.
- [ ] The end (`/try/femkort/game-over`): the end screen with deals and the cards that took each last trick; *Play again* deals a new game.
- [ ] Bättre kort (`/try/femkort/better-cards`): *Ask for better cards* on your lead; the others' plates glow while they answer; all yes deals again, any no plays on ("Bot said no to new cards: play on"). Once a deal each.
- [ ] Let the turn clock run out: a card is played for you and you're marked away; later turns are quick until *I'm back*. *Leave game* mid-deal deals the cards again without you.
- [ ] Phone: the plates, the cards on the felt, the pips and your five cards all fit; cards are tappable. Both modes readable.

### Tic-tac-toe
- [ ] Entering with no side picked: the board is greyed out with a "Pick a side" prompt (buttons in your color); seated alone, it says you're waiting for an opponent; watching a full game, the board is live and the status says you're watching.
- [ ] Two players take X and O; the round starts at once; a win highlights the line, scores it and announces it in chat.
- [ ] Motion: the mark just played pops in, and a win gets a line drawn across it in the winner's color; neither replays after a refresh, and with reduced motion the line is just there.
- [ ] The next round starts on its own with the other player opening. Draws are counted.
- [ ] Leaving mid-round forfeits it. Leaving and coming back keeps your win count.

### Battleship
- [ ] Nobody seated: the seas are greyed out with a "Take a seat" prompt; seated alone, it says you're waiting for an opponent.
- [ ] Placing: the next ship goes where you click (green/red preview on hover), *Rotate* or <kbd>R</kbd> turns it, clicking a placed ship picks it up, *Random* deals a fleet, *Ready* needs all five. With "ships may touch" off, touching ships are refused.
- [ ] The other player only sees "placing…" / "ready" over a blank sea. DevTools → WS: no `row`/`col` of the opponent's ships ever arrives before game over.
- [ ] Firing: misses get a cream peg, hits a terracotta one; a hit doesn't show the ship; a sinking shows the ship and says "You sank Bob's Cruiser". The defender is told which of their ships was hit.
- [ ] Motion: the newest shot drops in with a splash for a miss and a burst for a hit, and a sunk ship rocks and settles dark; only shots that arrive live (not after a refresh or reconnect), none with reduced motion.
- [ ] Strict alternation by default; with "a hit earns another shot" on, you keep shooting until you miss.
- [ ] Let the clock run out: a random shot is fired for you; three in a row forfeits. The placement clock completes unfinished fleets at random.
- [ ] Sink the fleet: winner announced in chat, both fleets revealed, *Play again* starts placing with the other player shooting first.
- [ ] Leaving while placing calls the game off; leaving while firing forfeits.
- [ ] Phone: while placing, your sea and the dock fit with the other side as just a nameplate; while firing, the sea you aim at comes first.

### Cannons
- [ ] Setup: players (2–4), landscape (gentle, hilly, mountains), wind (none, light, strong) and the turn timer. The game starts when every seat is taken; a new field each game.
- [ ] Nobody seated: a "Take a seat" prompt over a greyed field; seated alone, "Waiting for an opponent".
- [ ] The field: layered ground with grass tufts, cliffs into the sea at both edges (seen when a shot flies off the side: it splashes in, and the camera stays on it a moment), field guns that face the way they aim with the trail resting on the ground; the gun whose turn it is has a ring of light under it.
- [ ] Aiming on your turn: dragging from your cannon sets the angle and power (a dotted line with the numbers); the ◀ ▶ and − + steppers and sliders, and ← → / ↑ ↓ (Shift for 5) do too; Space or *Fire!* fires. Out of turn there are no controls. Each dial has its label and value above its slider, with the steppers either side; your last shot is in a line under them.
- [ ] A shot: everyone sees the ball fly with a trail, a soft thump, then a burst and a crater where it lands; a ball high or wide makes the camera widen to follow it. The news says where it went ("Your shot landed 40 m short of Bob (to the left)"), and the shooter's faint trail stays until their next shot.
- [ ] The wind badge shows the flag, a number and an arrow; it changes between turns, and the clouds drift with it.
- [ ] A hit (`/try/cannons/one-more`): a fireball, flying wreckage, a flash and a shake; the cannon is left a burning wreck with black smoke, the chat says who hit whom only once the ball has landed, and the end screen comes up after the burst. Refresh mid-flight: the field shows the result, nothing replays.
- [ ] Game over: one *Play again*, on the result (no second one in the tray below); if a seat emptied, it says it's waiting for every seat instead.
- [ ] Free for all (`/try/cannons/free-for-all`): plates left to right as the cannons stand, knocked-out cannons are skipped, last standing wins.
- [ ] Clock: let it run out and the turn goes by without a shot ("ran out of time: no shot"); three in a row and your cannon is out. Leaving before anyone fires calls it off; after, your cannon is out.
- [ ] Against a built-in bot: its first shot is off, then it closes in, usually hitting within 3–5 shots.
- [ ] Laptop (1440×900): field, plates and controls fit without scrolling. Phone: the field fills the width with the controls below; dragging aims without scrolling the page. Both modes: sky, ground, cannons, trails and labels readable.

### Chess
- [ ] Setup: the time-control presets fill in minutes and increment; *No clock* hides the clocks.
- [ ] Nobody seated: a "Take a seat" prompt over a greyed board; seated alone, "Waiting for an opponent". The second player sitting starts the game; seat 0 has White first.
- [ ] Moving: click a piece then a square, or drag it. Legal squares get dots (rings for captures); a second click on the piece puts it down. Out of turn nothing picks up. Black's board is upside down; ⇅ flips it.
- [ ] Castling both ways (king two squares, or king onto the rook), en passant, and promotion (a picker of four pieces on the file; Escape cancels). The check square glows red with a pulse.
- [ ] After each move the panel says it in words with little pieces ("Alice's bishop took your pawn on f7. You're in check!"), from your side ("Your…", "your…"). A taken piece is knocked off its square; captures show the taken piece in the move list, checks are red.
- [ ] Clocks: only the side to move runs, the increment is added after each move, tenths show under 10 s and it turns red under 20 s. Let one run out: a loss on time (a draw if the other side has only a king).
- [ ] Draws: *Offer draw* shows Accept/Decline to the other side; moving declines it; you can't offer again until the next move. Repetition, stalemate and insufficient material end the game on their own.
- [ ] *Resign* asks first. The result shows in the panel and in chat; *Play again* swaps colors. Captured pieces and the material lead show under each name.
- [ ] Leaving before your first move calls the game off; after, it's a loss.
- [ ] *Copy PGN* pastes into an analysis board (e.g. lichess.org/paste).
- [ ] Against a built-in bot: it answers within a couple of seconds and rarely leaves a piece to be taken for free.
- [ ] Laptop (1440×900 and 1280×800): board, players, clocks and moves fit without scrolling. Phone: opponent above the board, you below, moves in a strip.

### Othello
- [ ] Setup: the presets fill in minutes and increment; *No clock* hides the clocks.
- [ ] Nobody seated: a "Take a seat" prompt over a greyed board; the second player sitting starts the game; seat 0 has Black, who moves first.
- [ ] On your move the playable squares show a faint disc; pointing at one shows your disc and rings the discs it would turn over (the rest of the time, nothing). Out of turn nothing is marked and clicks do nothing.
- [ ] A move: the disc drops in with a soft click and the trapped discs flip one after another outward from it; the last disc has a small dot. The panel says it in words ("Bob played f5 and turned over 3 discs."), the score bar and the counts under each name follow.
- [ ] Passing (`/try/othello/pass`): the panel says "Bob has no move: your turn again.", the move list shows the pass, and it stays your turn.
- [ ] The last square (`/try/othello/last-move`): filling it ends the game; the end screen shows the discs. *Play again* swaps colors.
- [ ] Clocks: only the side to move runs, the increment is added per move; running out loses. *Resign* asks first. Leaving before your first move calls the game off; after, it's a loss.
- [ ] Against a built-in bot: it answers within a couple of seconds and grabs corners when it can.
- [ ] Laptop (1440×900): board, players, clocks and panel fit without scrolling. Phone: opponent above the board, you below. Both modes: discs, hints and coordinates readable.

### Four in a Row
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

### Luffarschack
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

### Go
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

### Coast to Coast
- [ ] Two to five sit down; *Start* deals 4 cards and offers 3 tickets to each. Hovering a ticket points out its cities on the map; *Keep* needs at least 2. Others only see "choosing tickets".
- [ ] Draw two cards: face up or from the deck. A face-up locomotive ends the draw and can't be the second card. Three locomotives face up are replaced (the log says so). Only you see what you drew blind ("From the deck last turn").
- [ ] On your turn, routes you can pay for are outlined; clicking one opens a bubble by the route (the rest of the board dims) with every way to pay (color, with or without locomotives); Cancel, Escape or a click elsewhere on the map backs out. Claimed routes show the player's trains (taller, with windows), distinct from the printed board in both modes.
- [ ] Double routes: with 2–3 players, claiming one track fades the other; with 4–5 the other stays open, but not to you.
- [ ] *Tickets* draws 3; keep at least 1. Completed tickets turn green with a ✓.
- [ ] Get someone to 2 or fewer trains: "last round" in chat and on the plates; each player gets one more turn, then the score table shows routes, tickets (each ✓/✗), the longest railway bonus and totals.
- [ ] Let the clock run out: two cards are drawn for you and you're marked away; *I'm back* gives you the rest of your turn. The first tickets' clock (twice as long) keeps the cheapest two.
- [ ] Hovering a player's nameplate fades everything but their trains; hovering a ticket joins its two cities with a dotted line.
- [ ] Cards you take fly from the face-up row or the deck to your hand (not with reduced motion). The news and the log show the cards taken (face up in color, blind ones as backs, yours in color) and the cards paid for routes.
- [ ] On a laptop screen (1440×900) the players, the map, the market, your cards and your tickets all fit without scrolling; narrower windows stack them under the map.
- [ ] Phone: the map scrolls sideways; the market, your cards and tickets stay usable.

### Turns, sound and the end of a game
- [ ] In every game the header shows "Your turn" (gold, with a pulsing dot) or "Bob's turn"; becoming your turn chimes and the tab title starts with "● Your turn". The player to move has a breathing gold ring.
- [ ] Sounds: cards, chips, checks (knocks), moves and captures, splashes, hits and sinkings, a claimed route, wins. A heartbeat in your last 10 s on a timed turn (not on others' turns). The speaker in the top bar (and /settings) turns them off and it sticks after a reload. /ui plays each one.
- [ ] End screens (Coast to Coast, chess, Othello, Go, Four in a Row, Luffarschack, Battleship, Cannons, Finns i sjön, Fem kort): the winner under a crown, how it ended, everyone's scores best first; confetti and a fanfare only when you won it live (not after a refresh); *See the board* tucks it into a bar with *Show results*; *Play again* works from it.

### Bots
- [ ] With no bots yet, *+ Invite a bot* in the members panel opens a new bot's form (a free name and color, a personality); *Make and invite* joins it (chat: "X added a bot, Y."), tagged *bot*, with a robot avatar and a × only for its owner. With bots, it lists the ones not in the room (one click invites), plus *+ New bot* and a link to *Your bots*.
- [ ] Settings, *Bots & AI* (`/settings#bots`): your bots with their kind, rooms and usage; *+ New bot*, *Edit* inline, *Delete* (confirm; it leaves its rooms right away, also ones not open). *Delete all bots* bottom right, with a confirmation sliding in. AI keys: added without a check; the card's light shows whether the provider takes it, which bots use it and the tokens used with it; removing a key turns its bots built-in.
- [ ] Settings, *Profile*: name and color, the players on this device (if any), then Sound effects and Dark mode (On/Off), then Delete all data, which clears everything, your player identity too (you're someone new in rooms you've been in), and takes you to the home page as someone new.
- [ ] The same bot in two rooms is the same player; editing it in one room changes it in both. × takes it out of one room only (it's still in settings).
- [ ] Click your own name in the members panel or *Here now*: edit your name and color there.
- [ ] Click your bot's name: rename and recolor it, mid-game too. Chat says "Y is now known as Z" and the board updates.
- [ ] On every game board, bots' nameplates show the robot avatar; people show their initial.
- [ ] Start each game with a bot in the room: once you sit down it takes a free seat within a couple of seconds and plays its turns (poker: after someone deals; Battleship: places and readies its fleet by itself). If nobody sits, bots wait about 10 s before sitting down.
- [ ] Refresh: your bots come back online with you. Close the tab: they go offline. Open the room in two tabs: each bot is online once, and closing the tab playing it hands it to the other.
- [ ] × removes the bot: it gives up its seat (forfeiting a round in progress) and leaves the members list. Removed while offline, it shows *leaving…* and goes once you're back.
- [ ] Another player sees your bot as *bot* without a ×; clicking it shows what it is (built-in easy or hard, or AI with model, effort, provider; personality), never the key.
- [ ] *Plays*: new bots are *Built-in, easy*; *Built-in, hard* is the strong one (bots made before there was a choice are hard). Play Four in a Row or Luffarschack against each: easy misses things and can be beaten by a beginner, hard can't be beaten without a plan.
- [ ] While a built-in bot thinks (Four in a Row, Go on hard), the page stays smooth: hovering columns, the chat and animations don't stutter.
- [ ] Hot seat with Play again: make the first move, resign as the other, *Play again*: the new opener can move straight away (no ghost of the old move).

### Hot seat
- [ ] Game cards for chess, Othello, Go, Four in a Row, Luffarschack, tic-tac-toe and Cannons show a *Hot seat* tag (hover: why); the others don't.
- [ ] *+ Player on this device* (members panel or *Here now*): with nobody saved yet, a name-and-color form; *Add* joins them (chat: "Sam joined on Alice's device."), tagged *with you* (others see *with Alice*). Next time it lists who's played here before, plus *+ Someone new*.
- [ ] Start a hot-seat game: *On this device* shows you and Sam, you selected. Sit down, click Sam, sit him down. Each move turns the game to whoever's next (board flipped to their side, "Your move."), the turn pill says *Sam's turn*, and there's no chime between you two. Against a remote player or a bot, it stays on whichever of you last moved.
- [ ] Click Sam's name to rename or recolor him; × takes him out (he gives up his seat); *Settings → Profile → Players on this device* lists him, with *Edit* and *Forget*.
- [ ] Up to 4 bots and players on your device together in a room.
- [ ] In a game that isn't hot seat (poker), guests are just members: the game shows only you.

### AI bots (needs an AI key in `/settings`)
- [ ] Add a bot, *Plays*: your key. Model and effort default to the cheapest model at low effort; the preview says so. The bot form links to *Your bots and AI keys* (or *Add an AI key*); your profile popup links to all settings, and settings has *Back to the room*.
- [ ] Say hello before any game: it answers in character. Start a game: it sits, plays its moves within a few seconds, and chats now and then (not after every move).
- [ ] While its model works, a bubble over its nameplate says what it's doing, and dots show on its avatar in the members list (the name stays readable).
- [ ] Edit it: tokens used so far; change model or effort and it uses them from its next move.
- [ ] Remove the key in settings (or use a bad one): the bot shows *AI problem* and the built-in bot plays its moves, so the game never waits.
- [ ] *?* in a game's header shows How to play.

### End screens (via `/try`)
- [ ] Every game's "won"/"game over" scenario: the result reads right, winners are marked, *Play again* (or *Start*) works, in light and dark mode and on a phone.
- [ ] The "last move" scenarios: make the move, and the end comes up live (animations, chat announcements), as it would in a real game.
- [ ] Coast to Coast *Last round*: claiming with your last trains announces the last round; the bots take their turns and the score table shows tickets done and failed.
- [ ] A practice room shows *Practice* by the room code; a normal room doesn't.

### Lifecycle & layout
- [ ] The gear next to *End game* shows the running game's settings (turn timer, and for poker chips and blinds).
- [ ] *End game* asks for confirmation and returns everyone to the picker. A new game can start.
- [ ] Picking a game: its card grows into the set-up (art, name and pitch stay), with *?* for the rules and *← All games* shrinking it back. With reduced motion it just switches.
- [ ] Every timed game's set-up has *Disable timer*; once it's 0 the button looks spent, and pressing it again says "Timer already disabled".
- [ ] A spectator can't end a game while its players are online; the game's starter or a player can.
- [ ] Desktop 1280×800: the whole table and action bar fit without scrolling.
- [ ] Mobile portrait: seats don't overlap badly, and chat sits below the table.
- [ ] Long names (24 chars) and 9 seated players.
- [ ] Light and dark mode (the settings cog, /settings, or Ctrl+Shift+L anywhere, ⌃⇧L on a Mac): every screen readable, the choice survives a reload, and a fresh browser follows the system setting.
- [ ] `/ui` style guide: nothing broken after design changes, in both modes.
- [ ] Bump `PROTOCOL_VERSION` with a tab open: the tab shows "gg has been updated, reload".
