# Architecture

gg is a small platform for turn-based games played with friends: create a room,
share the link, pick a game, chat. It is built on Cloudflare primitives only:
one Worker, Workers Assets for the SPA, and one Durable Object per room.

```
 browser (React SPA)                       Cloudflare
 ┌───────────────────────┐   HTTPS   ┌──────────────────────────┐
 │ Home / Room pages     │──────────▶│ Worker (src/worker)      │
 │ RoomClient (WS)       │           │  POST /api/rooms         │
 │ Game UI modules       │◀═════════▶│  GET  /api/rooms/:id/ws ─┼──┐
 └───────────────────────┘ WebSocket └──────────────────────────┘  │
                                       ┌───────────────────────────▼──┐
                                       │ Room Durable Object (1/room) │
                                       │  SQLite: members, chat, ops, │
                                       │          game state          │
                                       │  hibernatable WebSockets     │
                                       │  alarm: timers + sweeping    │
                                       │  game engines (src/games)    │
                                       └──────────────────────────────┘
```

## Rooms

- `POST /api/rooms` makes a random **room code** and calls `create()` on the Durable
  Object `idFromName(code)`. Rooms only exist once created, so a mistyped link shows
  "Room not found" instead of silently making a new empty room. There is no room
  listing; the code is the only capability.
- Codes are 10 characters of Crockford's base32 (digits and upper-case letters
  without I, L, O, U): 50 bits, easy to read aloud and type. Lookups are
  case-insensitive, ignore spaces and dashes, and map look-alikes (O→0, I/L→1),
  so a typed code can't land in a different room (`src/shared/roomCode.ts`).
  With per-IP rate limits on lookups and connections, guessing a live room isn't
  practical: even 1,000 IPs guessing nonstop against 10,000 live rooms would expect
  one hit about every 50 years.
- A room can have a **name** (`POST /api/rooms {name}`, or `renameRoom` from
  anyone in it). It's only for display: rooms are still joined by code or link.
- A **practice room** (`POST /api/rooms {practice: true}`, made by `/try`) is one whose
  game can be set up in a given position; see "Practice rooms and scenarios" under
  Games. Only practice rooms take that, and a room can't become one later. They're
  for local development only: the worker makes them (and answers `/scenario`) only
  when served on localhost or a `.test` host, and `/try` is only in dev builds.
- The DO stores everything in its SQLite database (`kv`, `members`, `chat`, `ops`),
  so it can be evicted or hibernate at any time and come back intact.

## Identity

There is no sign-in. Each browser makes a random **secret** (localStorage
`gg.secret`) and sends it in `hello`. The server derives the public **player id**
as `sha256(secret)[:16 hex]`. Player ids are visible to everyone, but you can't
claim someone's id (and so see their hole cards) without their secret.

Your **profile** is global and local to the browser: a **name** (`gg.name`) and a
preferred **color** (`gg.color`, an index into the 16 `PLAYER_COLORS` in
`src/shared/colors.ts`; new browsers get a random one). Both are sent on every
hello and can be changed any time (`setProfile`). In a room, colors are resolved in
join order: the first member to want a color gets it, later ones get the next free
color around the palette (`assignColors`). Members carry their resolved `color`,
and the UI uses it everywhere: avatars, names in chat, nameplates, tic-tac-toe
marks (via `PlayerColorsProvider` / `usePlayerColors` in `src/ui/players.tsx`).

`/settings` edits the profile, holds the AI connections (below), and can delete
everything gg keeps in the browser (`deleteLocalData`): every `gg.*` key except
`gg.secret`, so the player stays the same person in rooms they've joined.

## Protocol (`src/shared/protocol.ts`)

Client → server messages are validated with zod. Every mutation carries a
client-generated `cid`.

| client → server | purpose |
| --- | --- |
| `hello {protocol, secret, name, color, chatCursor}` | (re)join; `chatCursor` = last chat seq seen |
| `setProfile {name, color}` | change your name or preferred color |
| `renameRoom {cid, name}` | name (or unname) the room |
| `chat {cid, text}` | chat message |
| `selectGame {cid, gameId, config}` / `endGame {cid, instanceId}` | game lifecycle |
| `gameOp {cid, instanceId, op, ifVersion?}` | a move |

| server → client | purpose |
| --- | --- |
| `welcome` | full snapshot: you, members, chat since cursor (or latest page), game view |
| `members` / `room` / `chat` / `game` | incremental updates (`room` = the room's name) |
| `ack {cid, ok, error?}` | result of a mutation |
| `error` | protocol-level errors (`room_not_found`, `outdated`, …) |

Plus `"ping"`/`"pong"` text frames, answered by the runtime's WebSocket
auto-response so heartbeats don't wake a hibernating DO.

## Resilience

The design goal: a bad network, a refresh, a sleeping laptop or a redeploy should
all look like a short blip, never lost or duplicated actions.

- **Snapshot on (re)connect.** A reconnect is just another `hello`. The welcome
  carries everything needed to render, and chat is caught up from the client's
  cursor (or reset to the latest page if it's too far behind).
- **Whole views, not diffs.** Every game change sends each player their full
  (redacted) view, stamped with a version. Turn-based state is small, and clients
  can't drift.
- **Idempotent mutations.** Results are stored per `(player, cid)` in the `ops`
  table (1h retention). Chat dedupes on `(player, cid)` in the chat table.
- **Outbox.** The client keeps un-acked mutations and resends them after
  reconnecting. Chat typed while offline is queued and shown as pending, and kept
  in the tab's sessionStorage so it survives a refresh (resent with the same cid;
  dropped after an hour, past the server's dedupe memory). Game
  ops need a live connection, and every op carries `ifVersion` (the game version
  the player was looking at), so it's rejected (`stale`) instead of applied to a
  game the player hasn't seen, whether it's a first send or a resend.
- **Liveness.** The client pings every 10s and treats 8s of silence as a dead
  connection (catching half-open sockets), reconnecting with jittered
  exponential backoff (max 10s), immediately on `online`, and on tab focus. The
  server's alarm sweeps every 5 minutes while anyone is connected, closing sockets
  that haven't pinged for 2 minutes (other people's presence dots can lag a few
  minutes for a hard-dead client; each wake-up is billed, so this stays lazy).
- **Upgrades.** `PROTOCOL_VERSION` mismatch → close code 4426 → the client shows
  "reload to update" instead of misbehaving.

## Look and feel (`src/ui`)

The design system shared by the platform and every game: a cozy family board game
(warm linen, forest green, terracotta, gold, wood, cream cards), with Fraunces for
display type and Nunito for everything else.

- `tokens.css`: every color, shadow, font and radius, as named variables. Light
  by default; `data-mode="dark"` on `<html>` swaps the palette, and `.on-brand`
  remaps them for the forest-green surfaces (top bar, nameplates, action tray).
  Components use only these names, so a palette change is one file.
- `components.css` + `Panel`, `Meter`, `Spinner`: boxes, panels with titles set
  into the border, buttons (`primary`, `subtle`, `ghost`, `danger`), fields, tags,
  status lights, banners, toasts.
- `mode.ts`: light/dark. Follows the system until you use the toggle; the choice is
  remembered per browser. `index.html` applies it before first paint.
- Artwork lives in `public/icons/` (generated illustrations for gg and each game;
  a game's `GameUI.icon` points at its own).
- Small panels behind a button (your profile, a member, inviting a bot, the game's rules
  and settings, the connection) are all `components/Popover.tsx`: kept within what's
  visible (on a phone, above the browser's bars and the keyboard), scrolling inside
  without scrolling the page, and closed by clicking elsewhere or Escape.
- `/ui` is a style guide with every component, in either mode.
- The room's members-and-chat sidebar can be folded into a rail (people online, a
  count of new messages) to give a game the whole width; it's remembered per
  browser (`gg.sidebar`). While it's folded, new messages pop up beside the rail
  for a few seconds and are counted on its chat button.
- The running game's header (icon, name, help, settings, *End game*) sits in the
  room's top bar on wide screens (`components/TopbarSlot.tsx`, a portal), leaving
  the page to the game.

## Games (`src/games`)

A game is a server-side `GameDefinition` (`src/games/types.ts`) plus a client
`GameUI` (`src/games/ui.ts`), registered in `registry.ts` and `ui-registry.ts`.
A new game still being tuned sets `meta.wip`, which puts a small "WIP" tag next to
its name in the picker and the game header. In the picker, the chosen game's card
grows (a view transition) into its set-up, with its rules behind a "?".

```ts
interface GameDefinition<State, Op, View, Config> {
  meta; configSchema; opSchema;              // zod-validated config + ops
  create(config, ctx): State;
  apply(state, actor, op, ctx): void;        // mutate a private copy or throw GameError
  view(state, viewer): View;                 // per-player redaction
  players(state): string[];                  // who's taking part (e.g. seated)
  removePlayer(state, player, ctx): void;    // gone for good (a removed bot): give up their place
  concurrentOp?(op): boolean;                // ops that skip the version check (own fleet)
  waitingOn(state): string[];                // whose move it is
  legalOps(state, player): Op[];             // what they could do now (bots, fuzzing)
  nextDeadline?(state): number | null;       // timers, via the DO alarm
  onDeadline?(state, ctx): void;
  checkInvariants?(state): void;             // e.g. chips are conserved
  bot: { easy(view, ops, rand): Op | null }; // the no-AI bot (see Bots)
}
```

`apply` is the authority on who may do what: `legalOps` is a list for bots, not a
gate, and a custom client can send any op that parses. So `apply` refuses table
moves from people who aren't seated (a spectator can't deal), and no-op toggles
(sitting in twice). The conformance test sends such unoffered table moves.

The room is game-agnostic: it never looks inside a game's state. Everything it
needs (who's playing, whose turn it is, when to wake up) comes through the
contract. Only the game's players, or whoever started it, can end a game (anyone
can once none of its players are online).

**Shared kit (`src/games/kit`)** for what most turn-based games need:

- `seating.ts`: seats with per-player data (a stack, a score) that's kept when a
  player stands up and restored when they return (the 32 most recent; older ones
  are forgotten, poker taking their chips off the table); sitting out; clockwise
  turn order.
- `lobby.ts`: the table moves games share (`sit`, `leave`, `sitOut`, `sitIn`,
  `start`), as op schemas to build a game's `opSchema` from and `legalLobbyOps`.
  Because every game spells them the same way, generic players (bots, the
  conformance tests) can tell table moves from game moves.
- `bot.ts`: `botMove`, one decision for any bot in any game (below).
- `duel.ts`: the table for two-player board games (chess, Othello, Go, Four in a Row,
  Luffarschack). Two seats with a running score and a series of games: the first starts
  when both seats fill, "Play again" the next; `colors[0]` opens, alternating or (an
  option) the loser opening; leaving forfeits a game you've moved in and calls off one
  you haven't; a finished game is scored and announced. A game's state extends `Duel`,
  its view `DuelView` (`openerSeat`, `sides`, `you.color`, ...), and it calls these from
  its own ops (`sitDuel`, `actingColor`, `leaveDuel`, `endDuel`, ...), keeping its board,
  rules and results. `fischer` is a chess clock (minutes plus an increment). Its page
  is `ui/Duel.tsx`: `DuelTable` (the board, a player above and below it or beside it on
  a wide screen, a panel), `DuelSide`, `SeatPrompt`, `DuelStatus`, `DuelControls`
  (resigning behind a confirm), `DuelMoves`, `DuelResult` and `DuelFooter`; the game
  brings its board and what's its own (chess's draw offers, Go's counting).
- `timers.ts`: named deadlines in state (`turn`, `nextRound`, ...).
  `nextDeadline`/`onDeadline` become `nextTimer` plus a switch over
  `takeDueTimer`.
- `cards.ts`: a standard 52-card deck, shuffling, rank names.
- `ui/`: the card-game base. `CardTable` (a wood-and-felt table with seats spaced
  around it, you at the bottom, bets and a dealer button in front of seats (`betAt`
  sets how far in: played cards sit nearer the middle than chips), content in the
  middle), `PlayerPlate` (nameplate), `Cards` (faces, backs, slots, fans),
  `Chips`/`Pot`/`DealerButton`, `TurnTimer`, `TimerField` (a set-up's seconds with
  a "Disable timer" button), `Herald`/`ActionTray`/`GameLog`
  for the strip, tray and history under the table, and `useSend` (`sendOp` plus a `busy`
  flag for disabling buttons while a move is on its way). `Flights` moves things across
  the table (dealt cards, chips, a catch from the lake): a game compares the new
  view with the last one, measures both ends on screen (`CardTable` marks seats with
  `data-seat` and bet spots with `data-bet-spot`), launches flights, and hides what's
  arriving until it lands (`arrivalStyle`). Only changes that arrive live animate,
  never a first view or a refresh, and nothing moves with reduced motion. Coast to
  Coast, Texas Hold'em and Finns i sjön use it. `GameOver` is the end of a game for every game
  that has one: the winners' avatars under a crown, a title and how it ended, everyone's
  scores best first (columns the game chooses, with an optional line of detail per
  player), and the game's own buttons (play again). A game that ends while you watch
  gets a sound, and confetti if you won; "See the board" tucks it into a bar. Tic-tac-toe
  (short rounds that restart on their own) and Texas Hold'em (hands, no end) don't use it.
  `Clock` is a two-player game clock (chess, Othello) from a view's `{w|b ms, since,
  running}`, counting down between server ticks; `ByoYomiClock` (Go) is the same for
  main time followed by byo-yomi periods (`{b|w: {main, periods}, since, running, period}`).

**Whose turn, and sound.** The game header (in the top bar) shows "Your turn" or
"Bob's turn" for every game from the snapshot's `waitingOn`, chimes when it becomes
your turn (unless the game's UI sets `quietTurn`, as Luffarschack does: the other
side's pen scratch says so already), and puts it in the tab's title. With 10 s or less left on the snapshot's
`deadline` while it's your turn, a heartbeat plays, quicker for the last 4 s
(`src/client/heartbeat.ts`). The active player's nameplate breathes a
gold glow. Sound effects (`src/ui/sound.ts`) are synthesized with the Web Audio API
(tones and filtered noise, no audio files), quiet, and on unless turned off with the
speaker in the top bar or on /settings (remembered per browser). Games play them for
what just happened (`play("chip")`, a flight's landing `sound`, `useOnChange` for live
changes only); in a background tab only the "your turn" chime plays. /ui lists them all
to audition.
- `testing.ts`: a seeded RNG for tests.

**Conformance (`src/games/conformance.test.ts`).** Every registered game is
fuzzed with random legal moves from random people (mostly whoever's turn it is),
timers firing, and players removed for good. After each step it checks that legal
ops are accepted and unoffered table moves refused, `removePlayer` works, state
and views are plain JSON, `waitingOn` ⊆ `players`, deadlines make progress (no
alarm hot-loops), and the game's invariants hold. For poker that's about 3,000
hands per run, with people joining, leaving and sitting out mid-hand.

- **Server-authoritative.** Clients send ops, and the DO validates and applies them
  to a `structuredClone` of the state. If `apply` throws, nothing changes.
- **Secrets never leave the server.** Only `view(state, viewer)` is sent, built per
  player. The poker view is built field by field (never spread from state), so a
  new secret field can't leak by accident. Integration tests check every byte each
  client receives.
- **Randomness** comes from `ctx.randomInt` (crypto-backed in production, seeded
  in tests).
- **Time** comes from `ctx.now`; deadlines are executed by the DO alarm, which
  also catches up if several are overdue. A deadline that has passed is also
  applied before any op, so a move can't beat its clock by arriving before the
  alarm runs (it finds the game changed, and is refused as stale).
- **History is bounded** in stored state, not just in views (Finns i sjön can go
  round in circles indefinitely once the lake is empty).
- Games can post to room chat via `ctx.announce()`. Chat is shared by the room and
  the game.

**Practice rooms and scenarios (`/try`).** To try a game (or check its end screens)
without playing it through, `/try` lists **scenarios**: a game set up at an
interesting moment, mostly the move before the end and the end itself (mate in one,
the last book, an all-in on the river, Coast to Coast's last round and final
scores). Each game has a `scenarios.ts` (`kit/scenario.ts` has the type and a seeded
`playUntil` that plays moves by policy or the built-in bot; `scenarios.ts` collects
them). A scenario's `build(players, ctx)` makes its state through the game's own
`create` and `apply` (seating everyone with real ops, then playing or editing it
into shape), with its own seeded randomness, so it's the same position every time;
`scenarios.test.ts` builds each one with different ids and checks invariants, JSON
and that determinism. `/try/<game>/<scenario>` (`pages/Try.tsx`, loaded on demand)
then:

1. creates a **practice room** (`POST /api/rooms {practice: true}`; the usual room
   limits apply). Practice is fixed when a room is created and shows as a small
   *Practice* tag by the room code;
2. joins it (your saved name, or "You"), invites the built-in bots the scenario needs
   (yours, or new ones made if you haven't enough), and waits for them to join;
3. builds the state with the real member ids and sends it to
   `POST /api/rooms/:code/scenario {secret, gameId, name, state}`;
4. goes to the room, where the bots play from your tab as usual.

The room is still game-agnostic about it: it takes the state as JSON and starts it
like a new game (new instance, version bumped, views broadcast, timers scheduled,
"You set up Chess: Mate in one." in the chat). Because the state comes from a
browser, it's only taken in a practice room (403 for any other room, so no real
game can be tampered with), from a person in the room, and only if the game's
`checkInvariants` pass, everyone in it is a member, every view and `legalOps` can be
built, and no timer is long overdue. The worst a bad state can do is break its own
practice room. `pnpm scenario [game] [scenario] [--open] [--base URL]` prints (or
opens) the links.

### Tic-tac-toe (`src/games/tictactoe`)

The smallest complete game, and the template to copy: kit seats (scores survive
standing up), a turn clock that forfeits the round and the seat (so an empty
chair doesn't keep losing rounds, and an abandoned table stops), alternating
openers, and a pause between rounds. It has no hidden information, so the view is the state.

### Finns i sjön (`src/games/finnsisjon`)

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

### Fem kort (`src/games/femkort`)

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

### Battleship (`src/games/battleship`)

Classic Battleship for two: each player hides a fleet (Carrier 5, Battleship 4,
Cruiser 3, Submarine 3, Destroyer 2) on a 10×10 sea, then they take turns firing.
- **Placing** is server-validated one ship at a time (`arrange` sends the whole,
  possibly unfinished layout), or `random` lets the server deal a valid fleet.
  `ready` needs all five; `unready` is allowed until both are ready. Placing ops
  are `concurrentOp`s: both players place at once, so one's placing never makes
  the other's click stale. The other
  side only learns "placing…" or "ready".
- **Hidden information:** a fleet's layout is only in its owner's view until the
  game is over, when both are revealed. Shots and their results are public, and
  a sunk ship's cells are shown (as at a real table). A plain hit doesn't say
  which ship it was, not even in the log. Tests check that the opponent's and a
  spectator's views don't change when the untouched ships are moved.
- **Settings:** ships may touch (default yes; never overlap), a hit earns another
  shot (default no), a placement clock (unfinished fleets are completed at
  random) and a turn clock (a random shot is fired for you; three in a row
  forfeits).
- Leaving while placing calls the game off unscored; leaving while firing
  forfeits. *Play again* starts the next game with the opener alternating.

### Cannons (`src/games/cannons`)

Gorillas / Scorched Earth for 2–4, kept simple: every player is a cannon on a side-view
landscape; take turns firing; one hit knocks a cannon out and the last one standing wins.
- **The physics** (`physics.ts`) is pure and shared: one shot's whole flight from (angle,
  power, wind, ground), on a fixed 20 ms step, and the crater it leaves. It only adds,
  multiplies and divides (sines come from a Taylor-series table of whole degrees, square
  roots from Newton's method), so a flight is the same to the last bit in any engine.
  Distance goes with power (speed with its square root), the wind pushes sideways (more
  on long, high shots), and a ball passing within 15 m of a cannon knocks it out (your own
  too, once the ball has got clear of it). Balls can fly off the top and come back, or off
  the sides for good. A crater takes what's inside its circle out of each column and lets
  what's above settle (no overhangs); cannons sink with the ground.
- **The field** (`terrain.ts`) is made from a seed per game (gentle, hilly, or mountains
  with a ridge between neighbours): heights every 4 m, kept in the state, with a flat patch
  under each cannon. Who stands where is shuffled each game.
- **Moves are continuous**, whole numbers checked by the engine: `{type: "fire", angle:
  0–180, power: 5–100}`. `legalOps` offers 9 example aims towards the nearest cannon
  (a representative sample, as the contract allows), and the AI is told any angle and power
  in range will do. No contract change was needed.
- **A shot** is worked out on the server at once (crater and knock-out included), then the
  game is `flying` (waiting on nobody) for as long as the ball takes on screen plus a beat;
  a `land` timer then announces any hit, ends the game or moves to the next turn, with a
  new wind (it drifts each turn, within the game's strength). So nobody reads about a hit
  in the chat before seeing it. The view keeps each player's latest shot with its path
  (whole-meter points); the browser replays that path rather than recomputing it.
- **The view** has a `situation`, the position in words from the viewer's cannon (where
  everyone is, the ground between, the wind, where the last shots landed: "landed 40 m
  short of player X (to the left)"), for AI bots.
- **Turn clock**: running out passes your turn without a shot (firing for you could win
  you the game); three in a row and your cannon is out. Leaving before anyone has fired calls the game off; after, your cannon is out.
- **The scene** (`ui/Scene.tsx`) is SVG in world meters: sky, clouds drifting with the
  wind, hazy mountains and wooded hills far off, the ground in layers (topsoil, clay,
  rock) ending in cliffs down to the sea at both edges (`SEA_LEVEL`: a ball off the side
  ends there, with a splash), 1940s-style field guns painted in their players' colors
  (a ring of light on the ground under whoever's aiming), and each player's last shot as
  a faint trail. A miss throws up dirt; a hit is a fireball with flying wreckage, a shake
  and a flash, and leaves a burning wreck. Only a shot that arrives live flies (ball,
  trail, a burst where it lands, a camera that widens to keep the ball in view); after a
  refresh the field is just as it is. Aim by dragging from your cannon, with the steppers
  and sliders, or ←/→ and ↑/↓ (Space fires). Colors are tokens (`--cannons-*`).
- **The built-in bot** aims like a person: the nearest cannon, an angle that looks like it
  clears the hills, a first power from a rough sense of distance and wind (deliberately
  6–18% off), then corrections by eye from where its shots landed (how far off, and roughly
  how many meters a point of power is worth), allowing for the wind roughly. It aims higher
  when a hill catches its shot. It hits in about 3 shots (rarely the first).

### Chess (`src/games/chess`)

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
  its rook. Each move records the piece and what it took (`moveFacts`), so the panel
  says the last move in words ("Rivet's queen took your bishop on d5. Check!") and the
  move list marks captures and checks. Your move
  shows at once and is taken back if the server refuses it. Pieces are Cburnett's
  SVGs (BSD) in `public/pieces`; square colors are tokens (`--board-*`).

### Othello (`src/games/othello`)

Othello for two, built like chess (the two share the seating, colors swapping every
game, calling the game off if you leave before moving, and Fischer clocks).
- **The rules** (`rules.ts`) work on the board as a 64-character string ("b", "w",
  "."), a1 at the top left as Othello boards are written: what a disc would turn
  over, the legal moves, playing one. The browser uses the same code for the hints.
- **Passing** is never a choice: after a move, if the other side has no move but the
  mover does, the server records a pass for them and it's the mover's turn again, so
  the game only waits on someone who can move. When neither can, it's over: most discs
  wins, equal is a draw. Moves record what they turned over, and the view has the last
  disc set down (`lastMove`, with `flipped`) and who passed after it (`passed`).
- **The board** (`ui/Board.tsx`): your legal squares get a faint disc; pointing at one
  shows your disc and marks what it would turn over; click to play (shown at once,
  taken back if refused). A new disc drops in and the trapped ones flip in 3D (two
  faces back to back), outward from it one step at a time, live moves only. Colors are
  tokens (`--othello-*`, `--disc-*`).
- **The built-in bot** weighs squares the classic way (corners high, the squares next to
  an empty corner low), likes leaving few replies, and avoids opening a corner.

### Four in a Row (`src/games/fourinarow`)

Four in a Row for two on an upright board of 7×6, 8×7 or 9×7, built like Othello (seating,
calling the game off if you leave before moving, Fischer clocks).
- **The rules** (`rules.ts`) work on the board as a string of columns × rows cells ("x" for
  whoever starts this game, "o", "."), row by row from the top; columns are numbered from 1 on
  the left, rows from 1 at the bottom. A disc falls to the lowest empty cell. A disc that makes
  four or more in a line wins (`fourThrough` gives every disc in such lines, two lines at
  once included); a full board is a draw. A move is `{type: "drop", column}`.
- **Who starts:** by default players take turns; with `opener: "loser"` the loser of each game
  starts the next (after a draw, the other player). The next opener is kept in state
  (`nextXSeat`), so a game called off is replayed with the same one.
- **Colors:** discs are drawn in the players' own colors. If the two are too alike (OKLab
  distance under 0.16, `ui/colors.ts`), the viewer keeps theirs and the other side's discs get
  the palette color furthest from it.
- **The board** (`ui/Board.tsx`): an SVG wooden front with a hole per cell, over the discs.
  Pointing at a column (or ←/→, Home/End) holds your disc over it and marks where it would
  land; click, tap, Enter, Space or a digit drops it (shown at once, taken back if refused). A
  new disc falls in behind the front with gravity and a small bounce (sound `drop`, timed to
  the landing), live moves only. The last disc has a dot; at the end a gold line joins the
  winning discs, which glow while the rest dim, and the results come up 1.6 s later. Colors
  are tokens (`--fiar-*`) plus the players' colors.
- **The built-in bot** (`search.ts`, `bot.ts`) searches: negamax with alpha-beta (principal
  variation search), iterative deepening, a transposition table and move ordering, within 450
  ms and 14 moves on the page. It always takes a win it can see, blocks a threat without using
  up depth, and never drops under the other side's winning spot. Its evaluation counts the
  lines of four still open to each side and the threats, which count most on rows of the right
  parity (with an even number of rows) and not at all above the other side's lower threat in
  the same column. It opens in the middle and varies its first moves among near-best ones.
  With `quick` it looks 4 moves ahead with no time limit, so set-up positions are repeatable.

### Luffarschack (`src/games/luffarschack`)

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
  ink. Pointing at a square pencils your mark in; on touch screens the first tap pencils it in, boxed, with a *Mark J10* button by
  it (or tap the square again); the
  arrow keys move a dotted cursor and Enter marks. Colors are tokens (`--lfs-*`).
- **The built-in bot** (`bot.ts`) reads threats rather than searching: for each empty square
  near the marks it asks what a mark there makes, line by line, for itself and (as a block)
  for the other side: five, an open four, a four, an open three, a closed three, or room to
  grow, with extra for a four and an open three at once or two open threes. It takes a five,
  then stops one, then plays a win by fours (VCF: fours the other side must answer, until one
  can't be), and otherwise takes the best square (a little randomness among near-equals),
  with a bonus for the first square of the other side's win by fours. It takes a few
  milliseconds a move.

### Go (`src/games/go`)

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

### Coast to Coast (`src/games/ticket`)

Ticket to Ride's rules on its North American map, under our own name: fan-made,
not affiliated with Days of Wonder, and credited as such in its tagline, setup and
rules. The art (map, cards, icon) is our own.

The standard game on the North American map, for 2–5 players: 45 trains each, 110
train cards (12 of each of eight colors, 14 locomotives), five face up (three
locomotives showing and all five are replaced), 30 destination tickets, 100 routes.
- **The map** (`map.ts`) is data: cities with three-letter codes, routes with ids like
  `SEA-HEL` (`DUL-OMA/1`, `/2` for double routes), lengths and colors, and the
  tickets, checked against a published route list. `graph.ts` answers questions
  about it: whether a route is open to a player (double-route rules), whether routes
  connect two cities, the longest continuous path, and the cheapest way to finish a
  ticket (for the built-in bot).
- **A turn** has stages: `start`, `second` (one card drawn, one to go) and `tickets`
  (choosing drawn tickets). Choosing the first tickets is simultaneous (`keep` is a
  `concurrentOp`). A claim names a color and a number of locomotives
  (`{route, color, locos}`; color `"loco"` for locomotives only); `legalOps` lists the
  fewest-locomotive way per color, the UI every way.
- **Hidden information:** hands, kept and offered tickets, cards drawn blind, the
  decks. Card, ticket and train counts are public, and so are face-up draws and the
  cards paid for a route. Tickets are revealed in the final score.
- **The end:** finishing a turn with 2 or fewer trains starts the last round, kept
  as the list of players still to play (`finalTurns`), so leaving or being skipped
  can't stall it. A player who can't do anything at all (no cards to draw, no route
  they can pay for, no tickets) is passed over; if nobody can, the game ends.
- **Away players** work as in Finns i sjön: running out of time draws two cards from
  the deck for you (or whatever's possible) and marks you away. Leaving mid-game
  discards your cards and returns your tickets; your trains stay on the map.
- **Geography** (`ui/geography.ts`) is generated by `tools/ttr-geography.ts` from
  Natural Earth's 1:50m countries, lakes and borders (public domain). The board
  isn't a real projection, so the outlines are bent onto it with a thin-plate spline
  fitted to the 36 cities' real coordinates (every city lands within a few pixels of
  its board position, so coastal cities stay on their coasts), then clipped and
  simplified to ~28 KB of SVG paths.
- The map is drawn as SVG (`ui/TicketMap.tsx`, `ui/geometry.ts`) in two layers: the
  printed board (coasts, lakes, borders, relief shading, paper texture), drawn once
  in its own layer so the costly filters aren't redrawn on hover, and the live
  tracks and cities on top. Train cars are spaced along straight or bowed tracks,
  curved where the printed board curves them, with label offsets per city. Train
  colors and the board's land and water are tokens (`--train-*`, `--map-*`).

### Texas Hold'em (`src/games/poker`)

No-limit hold'em for 2–9 seats: blinds (heads-up rules included), min-raise
tracking, incomplete all-in raises that don't re-open betting, side pots, split
pots with odd chips going clockwise from the button, uncalled bets returned, dead
money from players who leave, street-by-street all-in runouts, a turn clock
(auto check/fold, then sit out), rebuys, and automatic next hands.

## LLM connections (`src/client/llm`)

Model credentials never touch gg's server. A player pastes an API key on
`/settings`, it's kept in their browser's localStorage, and requests go straight from
the tab to the provider. That works because Anthropic, OpenAI and Meta all allow
cross-origin requests with an API key (`access-control-allow-origin: *`; Anthropic
needs its `anthropic-dangerous-direct-browser-access` opt-in, which its SDK sends).

- **`LLMClient`** (`types.ts`) is the provider-neutral surface: `listModels()` and
  `generate({ model, instructions, messages, tools, effort, cache, onText })`,
  returning text, tool calls and usage (with cached input tokens), with errors
  mapped to `LLMError` codes (`auth`, `rate_limit`, `refused`, …). Messages carry
  text, tool calls and tool results; an assistant turn also keeps the provider's
  own record of it (`native`: Anthropic content blocks, Responses output items with
  encrypted reasoning), sent back as-is so multi-turn conversations stay intact.
  `cache` sets Anthropic's top-level `cache_control`; OpenAI and Meta cache shared
  prefixes on their own.
  `clientFor(connection)` (`connections.ts`) picks the adapter and loads its SDK on
  first use, so the provider SDKs stay out of the main bundle.
- **Adapters:** `openai.ts` (Responses API, official SDK) serves an OpenAI key and a
  Meta Model API key (Muse models; the same API at `api.meta.ai/v1`); `anthropic.ts`
  (Messages API, official SDK) serves an Anthropic key. A provider that speaks the
  Responses API is a base URL and a model filter; anything else is another adapter.
  Either way, plus a `Provider` entry.
- **Not supported: Sign in with ChatGPT** (running models on a ChatGPT plan). We
  tried it (2026-10-22). OpenAI only accepts a loopback redirect, which a website
  can work around by having the player paste the address back. But with a ChatGPT
  token, `api.openai.com` only sends CORS headers to OpenAI's own origins, so a
  browser on gg's origin can't read the replies, and the alternative is proxying
  the token through our server. OpenAI also offers plan usage only to local apps,
  with hosted apps going through an interest form.

## Bots

A bot is just another member of the room, played from its owner's browser:

- **Identity.** Your bots are kept in localStorage like your own name (`gg.bots`,
  `src/client/bots/store.ts`, on `src/client/local.ts`, the store for every player kept
  in this browser besides you, shared with hot-seat players): each has its own secret, so it's the same player in
  every room, and a name, color, personality and (optionally) an AI key, model and
  effort. You make, edit and delete them in /settings (the *Bots & AI* tab), or make
  one on the spot from a room. In a room, *+ Invite a bot* lists your bots that aren't
  there yet; each bot remembers the rooms it's in (`rooms`). Clicking yourself or one
  of your bots (members panel, or *Here now* before a game) edits it; a bot's change
  applies in every room. Others click a bot to see what it is: built-in or AI, model,
  effort, provider and personality (`BotInfo`; never the key). Changes go to the room
  like anyone's (`setProfile`). The token usage of AI bots is counted per bot and per
  key. Bots made per room by older versions become one bot per name.
  The bot connects with its own `RoomClient` and says hello with that secret plus
  its owner's (`hello.owner`), so the room records it as `kind: "bot"` with an
  `ownerId`. The owner must be a person in the room (bots can't own bots, so one
  person's identities are bounded): up to 4 bots and hot-seat players together each
  (`MAX_OWNED_PER_PLAYER`), added at a bounded rate. What a member is gets settled when they first join.
- **Playing** (`BotPlayer`). The bot gets only its own redacted view, like
  anyone, plus `legalOps` (the server adds them to bots' snapshots). After every
  change it waits a moment, like a person (never under `BOT_MIN_MOVE_MS`, 1 s, for
  built-in and AI bots alike, so people see each move before the next lands), then
  makes one move through the same
  path as a click (with `ifVersion`, so a move against an old situation is refused
  and it looks again). It plays on the same turn clocks as everyone. Seats are left
  to people first: bots follow quickly once a person sits down, and otherwise wait
  10 s before taking one (the snapshot's `players` says who's seated).
- **One decision for every game** (`kit/bot.ts`, `botMove`). Table moves are the
  same everywhere: take a free seat, sit back in if it was sat out, stand up when
  leaving, never start a game (that's for people). The game's own moves are up to
  the game's `bot.easy(view, ops, rand)`: tic-tac-toe takes wins and blocks half
  the time, poker plays loose and passive with a rough sense of hand strength,
  Finns i sjön asks for what it holds most of and remembers some asks, Battleship
  places at random and hunts around hits, Coast to Coast keeps its cheapest
  tickets and claims routes on the cheapest path to them, chess looks one move ahead
  (mates, material, no free pieces for the other side) with some randomness, Othello
  weighs squares (corners, edges) and the replies it leaves, Go runs a few
  thousand random playouts per move, Four in a Row searches with alpha-beta, Luffarschack
  answers threats and looks for a win by fours, Fem
  kort keeps its strongest card for the last trick and dumps low cards early, and
  Cannons aims like a person, correcting from where its last shots landed. The bot runs on the page, so it decides within
  a few hundred ms; `{ quick: true }` (the conformance suite, building /try
  positions) asks a searching bot to cut its search short. It decides from the view
  only, so it can't cheat. The conformance suite seats a table of built-in bots in every game and
  fails if the game ever waits on a bot that has no move.
- **Where it runs.** While the owner has the room open. One tab plays each bot
  (a Web Lock per bot); other tabs of the room wait and take over if it closes.
  When the owner leaves, the bot is a disconnected member, back when they return.
- **Looks.** Bots' avatars are a robot in their color instead of an initial, in
  the members list and on every game board (`PlayerPlate` reads who's a bot from
  `PlayersProvider`).
- **Removing** a bot from a room (× in the members panel) marks that room `removing`;
  the tab playing it sends `leaveRoom` once connected. The room takes it out of the
  game (`removePlayer`) and the room in one step, and closes its connections with
  `Left`. Only then does the bot forget the room (it stays yours, and can be invited
  back). **Deleting** a bot (in settings, one or all) marks all its rooms `removing`
  and leaves them at once from the settings page (`leave.ts`); a room it can't
  reach is left the next time you open it. The bot is forgotten once it's out of
  every room.

### AI bots (`src/client/bots/ai`)

An AI bot is the same bot, with the owner's model deciding instead of `bot.easy`.
When adding one you pick one of your AI keys, a model and an effort (the cheapest
model at low effort by default; a key's model list is saved with it), and
optionally a personality. The room's chat and the bot's own view of the game go to
the model's provider; only its moves and messages go to the room. "Never reveal
your cards" is an instruction, not a boundary: people in the chat can try to talk
it out of it (the bot form says so).

- **One tool**, `act({ op?, say? })`: `op` is the game's own `opSchema` as JSON
  Schema, minus table moves (those stay with `botMove`'s table logic), checked
  with the schema before it's sent; `say` is one chat message; neither is a pass.
  Tool choice stays `auto` (the newest Claude models reject forced tool use), and a
  pass on its own move gets one nudge before the built-in bot moves for it. It's
  "its move" only when the game waits on it (`waitingOn`); moves it has otherwise (a
  draw offer, playing again) are offered as optional, with no nudge. Bots never
  resign: it isn't among their moves, and `act` refuses it.
- **An append-only conversation** per game (`prompt.ts`): instructions (being a bot
  in gg, the persona, the game's `rules` and `botNotes`), the tool, then one user
  turn per wake-up: chat and game news since the last one, the bot's view if it
  changed, and its legal moves (`describeMoves` writes many moves differing in one
  field once, with the choices listed, so 361 Go points are one line). The `act`
  call's result opens the next update.
  Nothing earlier ever changes, so each request is mostly a cache hit. A new game,
  a changed setup, or 80 messages start a fresh conversation with recent chat.
  Between games there's a lobby conversation with a chat-only tool.
- **Woken by events** (`AiBrain`): its move (right away), people talking (after a
  2.5 s pause, so a burst is one call), other bots talking (on a budget of 3 that
  people and game news refill, so bots can banter but not forever), and a 60 s
  heartbeat while there's unseen news. One call at a time, at most 8 a minute;
  unprompted chat at most every 30 s; replies to people aren't limited.
- **Never stalls a table:** a failed call, a call that runs too long (90 s, or for
  its own move, until 3 s before its clock runs out: snapshots carry the game's
  next `deadline`), a pass on its own move (chat alone counts) after one nudge, or
  a refused move (after a few tries), and the built-in bot plays that move.
- **Decisions are bound to their game.** Moves carry the game instance and version
  the model saw, so a move for a situation that's moved on is refused as stale and
  the bot looks again. A new game starts a new conversation and cancels the call in
  flight; an answer that still arrives is dropped, never played into the new game.
- **What it's doing** (`activity`): while its model works, the bot tells the room
  ("Thinking about its move", "Reading the chat"), which relays it to everyone as
  `Member.activity` (kept in memory, cleared on disconnect). It shows as a bubble
  over its nameplate and dots on its avatar in the members list.
- **Usage** (tokens in, cached, out, calls) and the last error are kept on the
  bot's record and shown when editing it.

Every game has `meta.rules` (also shown in the game's "How to play" help) and
optional `meta.botNotes` (how its view and moves are written, for models).

**Dev logs.** Bots live in the browser, so in dev they (and every room connection)
report through `devLog` to a Vite dev-server endpoint, which writes
`logs/<YYYY-MM-DD>/<room>.log` and a line to the terminal: each wake-up and why, the
update sent, the answer with timing and tokens, what came of it, stand-ins and
errors. Production builds drop it; e2e runs turn it off (`GG_DEV_LOGS=0`).

## Hot seat

People can take turns on one device, in games tagged `hot-seat` (`GameMeta.tags`: nothing
in them is hidden, so one screen can show it to everyone; chess, Othello, Go, Four in a
Row, Luffarschack, tic-tac-toe, Cannons). Tags show on the game cards ("Hot seat"), with
room for more kinds later (`GAME_TAGS` in `games/types.ts`).

- **Who.** Someone playing on your device is a player kept in this browser, like a bot
  (`gg.guests`, `src/client/guests.ts`, on `local.ts`): a name, a color and a secret of
  their own, added in a room (*+ Player on this device*, listing who's played here
  before), edited by clicking them, removed with ×, and forgotten in /settings. In the
  room they're a member of their own, `kind: "guest"` (`hello.owner` plus
  `hello.guest`), with an `ownerId`: "Sam joined on Alice's device", tagged "with you"
  or "with Alice". They count towards the owner's `MAX_OWNED_PER_PLAYER`, and leave a
  room for good the way bots do (`leaveRoom`).
- **Connections.** While the room is open, the page connects each of its guests
  (`useGuestClients`), so each gets their own view, sends their own moves and shows as
  online. Nothing on the server knows about turns at a screen: it's players and moves,
  as ever.
- **The game.** In a hot-seat game with guests here, `GameStage` shows the game as
  whichever of you on the device it's waiting on (`useActing`: the view, `me` and moves
  all come from that player's connection), following each turn, so the board turns to
  them (chess, Othello and Go put your side at the bottom). A bar over the game (*On
  this device*) shows who it's shown as and switches to someone else until the game
  next changes, which is how a guest takes a seat. The turn pill says "Sam's turn", as
  yours, and doesn't chime as the turn passes between you. In other games guests are
  just members.

## Limits

Strict enough to stop scripts, loose enough that people never notice them. A
frustrated Cmd+R loop on a bad connection must never trip anything (there's an
e2e test for exactly that). All values are in `src/worker/limits.ts` and
`wrangler.jsonc`.

| limit | where | value | normal use for comparison |
| --- | --- | --- | --- |
| room creation | worker, per IP (rate-limit binding) | 10/min | one room at a time |
| connection attempts | worker, per IP (rate-limit binding) | 120/min | refreshing every second is 60/min; reconnects back off exponentially |
| chat + renames | DO, per connection (token bucket) | burst 15, then 1/s | chat queued while offline is flushed at once |
| moves and everything else | DO, per connection | burst 30, then 5/s | far above click speed |
| chat / moves, shared by one network in a room | DO, per IP | burst 40 then 3/s / burst 80 then 12/s | a household playing together; stops "more sockets = more throughput" |
| new identities (fresh browsers) | DO, per IP per room | 6, then 1/min | a group of friends joining at once |
| new bots | DO, per owner | 4 at once, then 1 per 30 s (and 4 at a time) | adding a few bots |
| message size | DO, before parsing | 16,384 characters | a full chat message is ~2,000 |
| room creation body | worker, while reading | 2 KB | a room name |
| scenario state (practice rooms) | worker, per IP (connection limit) and while reading | 120/min, 128 KB | a late Coast to Coast game is ~15 KB |
| sustained flooding | DO | 50 refused messages (forgiven at 1/s) → disconnect for 30s | only scripts get here |
| connections per player | DO | newest 6 kept; older tabs pause | refreshing on a bad connection can leave dead sockets behind |
| connections per IP per room | DO | 20 | |
| joined connections per room | DO | 100 | |
| time to say hello | DO | 10s, then closed | pings alone don't keep a socket open |
| members remembered per room | DO | 200, longest-gone offline ones forgotten first | |

IPv6 addresses are limited per /64 (a single machine usually has a whole one).
Requests for room ids that were never created don't create any storage, and
refused moves aren't written anywhere, so spam can't turn into storage costs.

How limits look to the user:

- **Refused connections** are accepted and then immediately sent an `error`
  (`rate_limited` / `room_full`, a human message and `retryAfterMs`) and closed with
  code 4429. A plain HTTP 429 on a WebSocket upgrade is indistinguishable from a
  network error in the browser, so it couldn't be explained. The client shows the
  message in its banner, hides "Retry now", and waits the requested time (plus
  jitter) before reconnecting.
- **Refused messages** get a normal `ack` with `rate_limited`. Chat puts the text
  back in the input with a toast, and moves show a toast.
- **Room creation** returns 429 JSON with a message, shown on the home page.
- **Too many tabs** of the same player: the oldest gets close code 4409 and shows
  "Open in another tab" with a "Use this tab" button. It does not auto-reconnect,
  since two tabs taking turns would loop forever.

The per-IP keys use `CF-Connecting-IP`, which Cloudflare's edge sets (clients can't
spoof it in production). Locally, tests set it to simulate players on different
networks.

## Room expiry

Rooms are deleted (`storage.deleteAll()`, after which the link shows "Room not
found") when nobody is connected and they've been idle **30 days**, or **24 hours**
if nobody ever joined. Activity is recorded on joins and messages (written at most
once a minute). The check runs on the DO alarm, which is scheduled for the
expiry time whenever the room empties, so an empty room costs nothing until that
one wake-up. A room with someone connected (even an idle background tab) wakes
every 5 minutes for the presence sweep.

## Known limitations / next steps

- Chat retention is the last ~1000 messages per room.
- Game state is stored as JSON with no per-game schema version: a deploy that
  changes a game's state shape can break rooms with that game running (ending the
  game fixes it). Add versions and migrations once compatibility matters.
- AI bots have per-minute call limits but no spending budget; people chatting can
  keep someone's AI bot busy. Usage is shown on the bot.
- Multiple tabs with the same identity are the same player (by design). Both can act.
- A bot runs in its owner's browser, so the owner could read its private view in
  devtools (e.g. its hole cards). Fine among friends; the alternative is running
  bots on the server, with AI keys there too.
- Bots take free seats once a person sits down (or after 10 s), so in a full game
  a person may need to remove one to get a seat.
- TODO: CI (GitHub Actions running `pnpm test:all`). For now, tests run locally.
