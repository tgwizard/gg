# Texas Hold'em

How it's built, for working on it: the platform it sits on (rooms, the game contract, the
kit, bots) is in [docs/ARCHITECTURE.md](../../../docs/ARCHITECTURE.md).

No-limit hold'em for 2–9 seats: blinds (heads-up rules included), min-raise
tracking, incomplete all-in raises that don't re-open betting, side pots, split
pots with odd chips going clockwise from the button, uncalled bets returned, dead
money from players who leave, street-by-street all-in runouts, a turn clock
(auto check/fold, then sit out), rebuys, and automatic next hands.

- **Blind levels** (`blindsUpEvery`): the blinds can go up a level every so many hands,
  through `BLIND_LEVELS` (×1, 2, 3, 4, 6, 8…: doubling every two levels), announced in the
  chat. Each hand keeps the blinds it was dealt at (`hand.blinds`), and the minimum bet and
  raise follow them. The table shows the blinds and when they go up next.
- **Buy-ins**: `rebuys: false` makes a freezeout (out of chips, you're out; standing up and
  sitting down again doesn't top you up), and the table says who has all the chips at the end.
  Every buy-in is counted per player (`buyIns`); a rebuy is announced in the chat ("Sam buys
  back in for 1,000 (rebuy #2)."), and *Buy-ins* under the table shows each player's bought
  in (and rebuys), has now, and up or down, for settling up after a home game.
- **Sizing a bet**: presets (min, ½ pot, pot, all-in), − and + that step by the small blind
  (stops: the minimum, round multiples of the small blind, all-in; `ui/amounts.ts`), and on
  wide screens a slider over the same stops. The rules still take any whole amount from the
  minimum raise up. On a phone, *Raise…* opens the sizing as a step of its own, and the tray
  shows your two cards, as it may be covering your seat.

- **The built-in bot** plays loose and passive with a rough sense of hand strength; easy
  plays with less thought.

## QA

Manual checks for after a change to this game (how to run them: [docs/QA.md](../../../docs/QA.md)).
Use 3+ players where it matters.

- [ ] Heads-up: the button posts the small blind and acts first preflop, last after.
- [ ] Three-handed: the big blind gets the option when everyone limps.
- [ ] Min-raise: after a raise of X, the next raise must be at least X more. The UI's *Min* matches.
- [ ] A short all-in that isn't a full raise: players who already acted can only call or fold.
- [ ] All-in with different stack sizes: side pots are paid to the right people (check the chat announcements).
- [ ] Split pot (board plays): the odd chip goes to the first winner left of the button.
- [ ] All-in before the river: hands flip and the board deals street by street.
- [ ] Turn timer: idle player is checked/folded and marked *Sitting out*; *I'm back* resumes dealing.
- [ ] Bust out → *Rebuy* appears between hands. With *Rebuys* off in the set-up: no *Rebuy*, "You're out of chips…" in the tray, and once one player has every chip the table says so.
- [ ] *Blinds go up every* 2 hands: hands 1–2 at 5/10, then 10/20 (announced in chat), 15/30…; the felt shows the blinds and when they go up next, and *Min* follows them.
- [ ] *Buy-ins* under the table: everyone's bought in / has / up or down, rebuys counted, adding up. A rebuy says so in the chat ("… buys back in for 1,000 (first rebuy)."), and busting out at a table without rebuys says you're out of the game.
- [ ] Sizing a bet: − and + step by the small blind (from the minimum to round amounts, up to all-in), the slider (wide screens) lands on the same stops, and typing any amount still works. On a phone, *Raise…* opens presets, −/+ and *Raise to N* with *Back*.
- [ ] *Fold & leave seat* mid-hand: you fold, your blind stays in the pot, and the hand carries on.
- [ ] Sitting down mid-hand: you're dealt in on the next hand.
- [ ] Motion: dealing sends cards from the middle to each seat in turn; when a betting round ends the bets slide into the pot; new board cards (and hands shown at the showdown) turn over; the pot flies to the winner. A refresh mid-hand shows the table still. Nothing moves with reduced motion.
- [ ] *Your hand* in the tray names what you hold so far ("Pair of Nines", "Two Pair, Kings and Nines"), only to you, while you're in the hand.
- [ ] Once the game's going, seated players don't see open-seat boxes; someone watching still sees *Sit here*.
