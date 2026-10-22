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
| unit | `src/**/*.test.ts` | hand evaluator, poker rules (blinds, min-raise, side pots, splits, timers, redaction), chip-conservation fuzzing |
| integration | `test/integration` | the real Worker + Room DO in workerd over WebSockets: joining, identity, chat catch-up, idempotency, stale ops, secret redaction on the wire, eviction, alarms |
| e2e | `test/e2e/*.spec.ts` | real browsers, multiple players: rooms, chat, refresh, offline, dropped and half-open sockets, a full poker hand, turn timer |

Visual snapshot of the main screens (desktop and mobile), for eyeballing layout changes:

```sh
npm run dev -- --port 5311 &
node test/e2e/screens.ts http://localhost:5311 ./screens
```

## 2. Manual scenarios

Use separate browser profiles or incognito windows for separate players (each
profile is a separate identity). With Claude: "run the QA playbook". It drives
these through the browser and reports back.

### Rooms & identity
- [ ] Create a room from the home page. The URL is `/r/<uuid>` and the status pill says *Connected*.
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

### Lifecycle & layout
- [ ] *End game* asks for confirmation and returns everyone to the picker. A new game can start.
- [ ] Desktop 1280×800: the whole table and action bar fit without scrolling.
- [ ] Mobile portrait: seats don't overlap badly, and chat sits below the table.
- [ ] Long names (24 chars) and 9 seated players.
- [ ] Bump `PROTOCOL_VERSION` with a tab open: the tab shows "gg has been updated, reload".
