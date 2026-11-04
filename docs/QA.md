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
these through the browser and reports back. The checks for each game are in its README
(below).

### Rooms & identity
- [ ] Home, new browser: Profile (name + color, saved in the browser, a random color to start), Start a room (optional name), Join a room.
- [ ] Home, once you have a name: your avatar and name in the corner (click to edit) by a settings cog; Start a room and Join a room side by side (stacked on a phone, with *Create a room* on the first screen); *Your rooms* lists rooms you've been in, newest first, with the game that was on (a waiting table before one) and who you played with, bots too (avatars, and "(bot)" in the line); one click goes back in. A room that's gone drops off the list once you've tried it.
- [ ] Two people pick the same color: whoever joined first keeps it, the other sees "X is taken here, so you're Y" and gets the next free color; taken colors are marked in the profile picker (top right).
- [ ] Rename the room from the top bar: everyone sees the new name and a chat note; clearing it shows "Name this room".
- [ ] Create a room from the home page. The URL is `/r/<10-char code>`, and the status light in the top bar is green; hovering or clicking it shows latency, since when, and reconnects.
- [ ] The people icon by the room's name shows the code and Copy invite link on hover, and stays open on click. Before a game, "Invite friends to play" shows the link, who's here (click yourself or your bots to edit; × takes your bots and players on your device out, as in the sidebar), *+ Invite a bot* and *+ Player on this device*.
- [ ] Phone: pick a game, scroll down to its set-up and start it: the game opens scrolled to its top. Wide: the same, in the stage.
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
- [ ] On a phone, switch to another app for a minute or two, then back: the room is live again within ~3s (one new connection, not a burst), with your bots.
- [ ] Phone: switch between Wi-Fi and cellular mid-game.
- [ ] The other player sees you go grey (away) while you're disconnected, and green again after.

### Each game

Each game's README (`src/games/<folder>/README.md`) ends with its own checks: run them for
a game you changed, or all of them after a change to the kit or the game contract.

### Secrets
- [ ] DevTools → Network → WS → Messages on player A: no card codes from B's hand ever appear before showdown, and no `deck`.
- [ ] Spectator sees only card backs until showdown. At showdown, only hands that reached it are shown.

### Limits & expiry
- [ ] Mash Cmd+R ~15 times on a room: you land connected with no banner or toast, and you're one member, not several.
- [ ] Paste 20 chat messages as fast as possible: a "going a bit fast" toast appears, and the refused text is back in the input.
- [ ] Create 11 rooms within a minute: the 11th shows a friendly "try again in a minute" message.
- [ ] (Automated only) a connection told to back off shows the server's reason, hides "Retry now", and reconnects after the requested delay. Expiry runs in integration tests, by back-dating the room's stored timestamps.

### Turns, sound and the end of a game
- [ ] In every game the header shows "Your turn" (gold, with a pulsing dot) or "Bob's turn"; becoming your turn chimes and the tab title starts with "● Your turn". The player to move has a breathing gold ring.
- [ ] Sounds: cards, chips, checks (knocks), moves and captures, splashes, hits and sinkings, a claimed route, wins. A heartbeat in your last 10 s on a timed turn (not on others' turns). The speaker in the top bar (and /settings) turns them off and it sticks after a reload. /ui plays each one.
- [ ] End screens (Coast to Coast, chess, Othello, Go, Four in a Row, Luffarschack, Battleship, Cannons, Finns i sjön, Fem kort): the winner under a crown, how it ended, everyone's scores best first; confetti and a fanfare only when you won it live (not after a refresh); *See the board* tucks it into a bar with *Show results*; *Play again* works from it.

### Bots
- [ ] With no bots yet, *+ Invite a bot* in the members panel opens a new bot's form (a free name and color, a personality); *Make and invite* joins it (chat: "X added a bot, Y."), tagged *bot*, with a robot avatar and a × only for its owner. Until it's in (throttle the network in devtools), it shows as *joining…*; if it can't come in, *can't join*, which says why when pressed (with *Reload the page* after a deploy). With bots, it lists the ones not in the room (one click invites), plus *+ New bot* and a link to *Your bots*.
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
- [ ] Game cards for chess, Othello, Go, Four in a Row, Luffarschack, tic-tac-toe, Cannons and Unicorn race show a *Hot seat* tag (hover: why); the others don't.
- [ ] *+ Player on this device* (members panel or *Here now*): with nobody saved yet, a name-and-color form; *Add* joins them (chat: "Sam joined on Alice's device."), tagged *with you* (others see *with Alice*). Next time it lists who's played here before, plus *+ Someone new*.
- [ ] Start a hot-seat game: *On this device* shows you and Sam, you selected. Sit down: the game turns to Sam (still standing), so sit him down too (with more of you, each in turn); clicking a name switches by hand. Each move turns the game to whoever's next (board flipped to their side, "Your move."), the turn pill says *Sam's turn*, and there's no chime between you two. Against a remote player or a bot, it stays on whichever of you last moved.
- [ ] Click Sam's name to rename or recolor him; × takes him out (he gives up his seat); *Settings → Profile → Players on this device* lists him, with *Edit* and *Forget*.
- [ ] Up to 4 bots and players on your device together in a room.
- [ ] In a game that isn't hot seat (poker), guests are just members: the game shows only you.

### AI bots (needs an AI key in `/settings`)
- [ ] Add a bot, *Plays*: your key. Model and effort default to the cheapest model at low effort; the preview says so. The bot form links to *Your bots and AI keys* (or *Add an AI key*); your profile popup links to all settings, and settings has *Back to the room*.
- [ ] Say hello before any game: it answers in character. Start a game: it sits, plays its moves within a few seconds, and chats now and then (not after every move).
- [ ] While its model works, a bubble over its nameplate says what it's doing, and dots show on its avatar in the members list (the name stays readable).
- [ ] Edit it: tokens used so far; change model or effort and it uses them from its next move.
- [ ] Remove the key in settings (or use a bad one): the bot shows *AI problem* and the built-in bot plays its moves, so the game never waits.
- [ ] *?* in a game's header shows How to play. Texas Hold'em's ends with the hands, best to worst, each with five cards (the ones that don't count greyed), readable on a phone and in dark mode.

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
- [ ] Mobile portrait: seats don't overlap badly, and chat sits below the table. Bets sit in front of each seat, never under its cards (`/try/poker/full-table`, at 320px wide too).
- [ ] Phone, your move in poker, Fem kort or Finns i sjön: the tray stays at the bottom of the screen (with your cards in it in poker) until you scroll past the game; not your move, it sits under the table.
- [ ] Phone: scroll down through the chat and back up: reaching the top of the chat carries on up to the game in the same swipe (the chat isn't a box of its own there). A long chat shows the latest 30, with *Show N earlier messages*. Reading at the bottom, new messages come into view.
- [ ] Phone: buttons are comfortably big to tap (44px; small ones 38px), and nothing wraps badly because of it (top bar, tray, footer, chat).
- [ ] Long names (24 chars) and 9 seated players.
- [ ] Light and dark mode (the settings cog, /settings, or Ctrl+Shift+L anywhere, ⌃⇧L on a Mac): every screen readable, the choice survives a reload, and a fresh browser follows the system setting.
- [ ] `/ui` style guide: nothing broken after design changes, in both modes.
- [ ] Bump `PROTOCOL_VERSION` with a tab open: the tab shows "gg has been updated, reload".
- [ ] Deploy (or `pnpm build && pnpm preview`, then build again) with tabs open: a room with no game on reloads by itself; one with a game on shows the Reload bar, and reloads when you switch away from the tab; text typed in the chat is never lost to it. A game whose rules changed shows "<game> has been updated" in its place, while the chat still works. (Automated: `test/e2e/updates.spec.ts`.)
