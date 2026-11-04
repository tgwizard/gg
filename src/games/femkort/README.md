# Fem kort

How it's built, for working on it: the platform it sits on (rooms, the game contract, the
kit, bots) is in [docs/ARCHITECTURE.md](../../../docs/ARCHITECTURE.md).

The old Swedish last-trick game for 2–6 players, built like Finns i sjön (kit seats, away
players auto-played, new players dealt in at the next deal). Five cards each (three, then
two, from the dealer's left), ace high, no trumps. You must follow suit if you can and,
with överstick (the modern rule, on by default), beat the best card of that suit so far
if you can; with none of the suit you play anything. Only the fifth trick counts: its
winner wins the deal, and the first to win `dealsToWin` deals (default 3) wins the game.
- **The rules** (`rules.ts`) are pure functions over a hand and the trick on the table
  (`playable`, `winningPlay`), shared by the engine, the bot and the board, which marks
  the cards you may play.
- **State** keeps each player's hand, the trick on the table, the tricks taken this deal
  and the undealt cards (secret, for the card-count invariant). After the last trick
  there's a `nextDeal` pause (5 s, `dealOver`) with the trick still on the table; then
  the deal passes clockwise.
- **Settings:** deals to win, överstick (off: the older rule, just follow suit), two deals
  in a row wins, and bättre kort: once a deal, the player on lead (not to the last trick)
  may ask for better cards; everyone else answers (`vote`, a `concurrentOp`), and only a
  unanimous yes deals again. No answer within 30 s, or anyone away, is a no.
- **Hidden information:** hands and the undealt cards. Played cards are public. The view
  lists `you.playable`, so the board and bots (built-in and AI) don't need the rules.
- **Leaving mid-deal** deals the cards again without you; with fewer than two left at the
  table the game ends.
- **The table** (`ui/FemKortGame.tsx`) closes up around who's playing. Played cards sit on
  the felt in front of each seat (the card winning so far ringed in gold); a taken trick
  stays a moment and is gathered to its winner. Five pips count the tricks, the last one a
  gold star. The last trick gets a "Last trick!" banner, a glowing felt ring and a chime,
  and the card that takes it pulses gold while a star pops onto the winner's plate.
- **The built-in bot** rates each card by its chance to stand up as the last trick's lead
  (unseen higher cards of its suit against the cards the others hold), keeps its best,
  dumps its weakest early and follows cheaply; on the fourth trick it weighs winning the
  lead for the last against keeping the better card. It votes for better cards with
  nothing strong to keep.

- Fem kort forgets people who left without winning a deal (so its state stays bounded).

## QA

Manual checks for after a change to this game (how to run them: [docs/QA.md](../../../docs/QA.md)).

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
