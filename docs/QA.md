# QA playbook

Run this after big changes (protocol, room server, client networking, game engines,
layout). Automated layers come first; the manual scenarios cover what automation
covers poorly: real browsers, real network weirdness, and how things look.

## 1. Automated (always)

```sh
npm run test:all        # typecheck + unit + integration + e2e
```

| layer | where | what it covers |
| --- | --- | --- |
| unit | `src/**/*.test.ts` | game kit, hand evaluator, poker and tic-tac-toe rules, redaction, and the conformance fuzzer every game must pass |
| integration | `test/integration` | the real Worker + Room DO in workerd over WebSockets: joining, identity, chat catch-up, idempotency, stale ops, secret redaction on the wire, eviction, alarms, rate limits, room expiry |
| e2e | `test/e2e/*.spec.ts` | real browsers, multiple players: rooms, chat, refresh, offline, dropped and half-open sockets, a full poker hand, turn timer, how limits look |

Visual snapshot of the main screens (desktop and mobile), for eyeballing layout changes:

```sh
npm run dev -- --port 5311 &
node test/e2e/screens.ts http://localhost:5311 ./screens        # rooms + poker
node test/e2e/screens-fish.ts http://localhost:5311 ./screens   # Finns i sjön
node test/e2e/screens-battleship.ts http://localhost:5311 ./screens   # Battleship, light + dark
```

## 2. Manual scenarios

Use separate browser profiles or incognito windows for separate players (each
profile is a separate identity). With Claude: "run the QA playbook". It drives
these through the browser and reports back.

### Rooms & identity
- [ ] Home: Profile (name + color, saved in the browser), Start a room (optional name), Join a room. A new browser starts with a random color.
- [ ] Two people pick the same color: whoever joined first keeps it, the other sees "X is taken here, so you're Y" and gets the next free color; taken colors are marked in the profile picker (top right).
- [ ] Rename the room from the top bar: everyone sees the new name and a chat note; clearing it shows "Name this room".
- [ ] Create a room from the home page. The URL is `/r/<10-char code>`, the code shows in the top bar, and the status pill says *Connected*.
- [ ] Type the code (lower-case, with a space) into *Room code or link* on the home page: it shows upper-case and joins the room.
- [ ] With 1Password (or another password manager) installed, the name, code and chat inputs don't offer to autofill.
- [ ] Open the invite link in another profile: you're asked for a name once, then you join. Both member lists show two people online.
- [ ] Reload: same member, no new "joined" message, chat history intact.
- [ ] Open the same room in a second tab of the same profile: still one member.
- [ ] Rename: the other player sees "X is now known as Y", and the new name sticks in new rooms.
- [ ] Mistyped room link: "Room not found" with a way out.

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

### Secrets
- [ ] DevTools → Network → WS → Messages on player A: no card codes from B's hand ever appear before showdown, and no `deck`.
- [ ] Spectator sees only card backs until showdown. At showdown, only hands that reached it are shown.

### Limits & expiry
- [ ] Mash Cmd+R ~15 times on a room: you land connected with no banner or toast, and you're one member, not several.
- [ ] Paste 20 chat messages as fast as possible: a "going a bit fast" toast appears, and the refused text is back in the input.
- [ ] Create 11 rooms within a minute: the 11th shows a friendly "try again in a minute" message.
- [ ] (Automated only) a connection told to back off shows the server's reason, hides "Retry now", and reconnects after the requested delay. Expiry runs in integration tests, by back-dating the room's stored timestamps.

### Finns i sjön
- [ ] When cards change hands, the asker and the giver see the exact cards in the strip under the table; others see only how many.
- [ ] Seats stay where people sat (no rotating so you're at the bottom); step away / leave are small links under the tray, not in it.
- [ ] 2–3 players get 7 cards, 4–6 get 5; the lake count matches.
- [ ] Pick a card, then an opponent; *Ask X for Ys*. If they have some, they move to your hand and it's still your turn.
- [ ] "Finns i sjön!": you draw (only you see the card under "You drew"); catching the asked rank shows it to everyone and gives you another turn.
- [ ] Four of a kind is laid down at once (book badge + chat announcement).
- [ ] Let the turn timer run out: your move is made for you and you're marked away; later turns are auto-played until *I'm back*.
- [ ] *Leave game* mid-game: your cards go back to the lake and the others play on (with two players, the other wins).
- [ ] Play to the end: all 13 books down, winner(s) announced, *Play again* deals a new game with whoever's seated.
- [ ] Phone layout: opponents, lake, news line and your hand all fit, and cards are tappable.

### Tic-tac-toe
- [ ] Entering with no side picked: the board is greyed out with a "Pick a side" prompt (buttons in your color); seated alone, it says you're waiting for an opponent; watching a full game, the board is live and the status says you're watching.
- [ ] Two players take X and O; the round starts at once; a win highlights the line, scores it and announces it in chat.
- [ ] The next round starts on its own with the other player opening. Draws are counted.
- [ ] Leaving mid-round forfeits it. Leaving and coming back keeps your win count.

### Battleship
- [ ] Nobody seated: the seas are greyed out with a "Take a seat" prompt; seated alone, it says you're waiting for an opponent.
- [ ] Placing: the next ship goes where you click (green/red preview on hover), *Rotate* or <kbd>R</kbd> turns it, clicking a placed ship picks it up, *Random* deals a fleet, *Ready* needs all five. With "ships may touch" off, touching ships are refused.
- [ ] The other player only sees "placing…" / "ready" over a blank sea. DevTools → WS: no `row`/`col` of the opponent's ships ever arrives before game over.
- [ ] Firing: misses get a cream peg, hits a terracotta one; a hit doesn't show the ship; a sinking shows the ship and says "You sank Bob's Cruiser". The defender is told which of their ships was hit.
- [ ] Strict alternation by default; with "a hit earns another shot" on, you keep shooting until you miss.
- [ ] Let the clock run out: a random shot is fired for you; three in a row forfeits. The placement clock completes unfinished fleets at random.
- [ ] Sink the fleet: winner announced in chat, both fleets revealed, *Play again* starts placing with the other player shooting first.
- [ ] Leaving while placing calls the game off; leaving while firing forfeits.
- [ ] Phone: while placing, your sea and the dock fit with the other side as just a nameplate; while firing, the sea you aim at comes first.

### Lifecycle & layout
- [ ] The gear next to *End game* shows the running game's settings (turn timer, and for poker chips and blinds).
- [ ] *End game* asks for confirmation and returns everyone to the picker. A new game can start.
- [ ] A spectator can't end a game while its players are online; the game's starter or a player can.
- [ ] Desktop 1280×800: the whole table and action bar fit without scrolling.
- [ ] Mobile portrait: seats don't overlap badly, and chat sits below the table.
- [ ] Long names (24 chars) and 9 seated players.
- [ ] Light and dark mode (toggle in the top bar and on the home page): every screen readable, the choice survives a reload, and a fresh browser follows the system setting.
- [ ] `/ui` style guide: nothing broken after design changes, in both modes.
- [ ] Bump `PROTOCOL_VERSION` with a tab open: the tab shows "gg has been updated, reload".
