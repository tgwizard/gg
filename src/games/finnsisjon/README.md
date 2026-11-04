# Finns i sjön

How it's built, for working on it: the platform it sits on (rooms, the game contract, the
kit, bots) is in [docs/ARCHITECTURE.md](../../../docs/ARCHITECTURE.md).

Go Fish, the Swedish way, for 2–6 players. You ask an opponent for a rank you
hold. If they have none ("Finns i sjön!"), you draw from the lake and go again
only if you catch what you asked for. Fours are laid down as books; most books
wins.
- **Hidden information:** hands and drawn cards are private; asks and answers,
  including exactly which cards were handed over, are public, as at a real table.
  A lucky catch is shown, since you have to show it.
- **Running out of cards:** with an empty hand you draw at the start of your turn.
  If nobody you could ask has cards, you draw and pass. With no cards and an empty
  lake, you're out.
- **Away players:** running out of time plays your turn for you and marks you away.
  After that your turns are played quickly (asking for what you hold most of)
  until you're back. A dropped player never stalls the table. Going away and back
  never extends a turn: the turn's end (`turnEndsAt`) is set once, when it begins.
- **Leaving mid-game** shuffles your hand back into the lake. Your books stay on
  the table, but you can't win.

This was the generality test: the room and protocol needed no changes. The
shared deck and card UI moved from poker into the kit.

- **The built-in bot** asks for what it holds most of and remembers some of the asks it
  has seen; easy has no memory.

## QA

Manual checks for after a change to this game (how to run them: [docs/QA.md](../../../docs/QA.md)).

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
