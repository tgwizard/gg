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
everything gg keeps in the browser (`deleteLocalData`): all of its localStorage and
sessionStorage, `gg.secret` too, so the next visit is a new player.

**The home page** asks someone new for a name and color first. After that the profile
is a chip in the corner (as in a room's top bar), and the page is for getting into a
room: start one, join one by code or link, or go back to one of *Your rooms*
(`recentRooms.ts`, `gg.rooms`: rooms you've been in, noted while you're there with
their name, the game on and who you played with (people and bots), listed for as long as they may
still exist and forgotten once one turns out to be gone). Everywhere your profile is,
a cog by it opens sound, dark mode and a link to all settings (`SettingsMenu`); on a
wide screen a room's top bar also has the sound switch beside it.

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
| `gameOp {cid, instanceId, op, ifVersion?, ifRound?}` | a move |

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
  table (2h retention, longer than clients resend for), chat included, so a resent
  message is never posted twice however much chat came after it.
- **Outbox.** The client keeps un-acked mutations and resends them after
  reconnecting. Chat typed while offline is queued and shown as pending, and kept
  in the tab's sessionStorage so it survives a refresh (resent with the same cid;
  dropped after an hour, when sending or restoring it). Chat goes out at a pace within
  the server's limits (ten at once, then about one a second), so a long queue after a
  reconnect is flushed rather than refused, and a message refused for coming too fast
  waits and goes again; at most 30 wait at a time. Game
  ops need a live connection, and every op carries `ifVersion` (the game version
  the player was looking at), so it's rejected (`stale`) instead of applied to a
  game the player hasn't seen, whether it's a first send or a resend.
- **A broken game doesn't break the room.** If a game throws on a deadline, when
  taking someone out, or building a view, the room ends that game with a message in
  the chat (`abandonGame`) instead of failing every move, alarm and join after it. On
  the page, a game that fails to draw shows "Something went wrong" in its place (an
  error boundary), with the room, chat and *End game* still working.
- **Liveness.** The client pings every 10s and treats 8s of silence as a dead
  connection (catching half-open sockets), reconnecting with jittered
  exponential backoff (max 10s), immediately on `online`, and when the tab comes
  back (shown, focused, restored from the back/forward cache). A socket that still
  looks open then gets a ping and 3s to answer before it's replaced: a phone back
  from another app often has a dead one it calls open, which the heartbeat alone
  would take ~10s to notice. Those events come in bunches, so they're acted on once
  per 2s, and an attempt that started under 3s ago is never cut short. The
  server's alarm sweeps every 5 minutes while anyone is connected, closing sockets
  that haven't pinged for 2 minutes (other people's presence dots can lag a few
  minutes for a hard-dead client; each wake-up is billed, so this stays lazy).
  Until then, those dead sockets count towards the per-IP cap: at the cap, the
  quietest socket from that IP that hasn't pinged for 30s makes way for the new
  one, rather than turning away a phone that reconnects (with its bots) often.
- **Upgrades.** A deploy leaves open pages a build behind the server, in three ways:
  - *The room protocol* (`src/shared/protocol.ts`): a `PROTOCOL_VERSION` mismatch →
    close code 4426 → the room shows "gg has been updated, reload" and nothing else.
    Bumped by hand, for breaking changes to those messages only.
  - *A game's rules*: its views and moves can change on any deploy that touches the
    game, and an old page drawing a new view could go wrong. Every build stamps a hash
    per game of what server and page must agree on (`tools/build-info.ts`: the game's
    folder without `ui/`, tests, meta, bot and practice set-ups, plus the kit and
    `types.ts`) into the page and the Worker alike (`src/shared/build.ts`, through
    vite's `define`; dev and tests are all "dev"). The welcome carries the server's;
    a page whose hash for the running game differs shows "<game> has been updated,
    reload" in the game's place, and its bots stop playing it (an AI bot stops
    calling its model). Hashes are keyed by the game's id, not its folder's name.
  - *The page's own files*: lazily loaded ones (bots' rules, the bots' worker, AI
    providers' SDKs) are gone from the server after a deploy, and an old name is
    answered with the app's HTML.
  So any page whose build id differs from the server's is stale (`src/client/update.ts`),
  and since everything lives on the server, it reloads when that interrupts nothing:
  when the tab is hidden (unless text is typed into a field), on going to another page
  in the app (a full load instead), or when no game is on or being set up and nothing
  is being typed or chosen. Until then the room shows a Reload bar. It reloads once per server build, so
  an old page served a moment longer while a deploy spreads can't make it loop. A file
  that fails to load also checks whether the site changed (the home page no longer
  names this page's script), which makes the page stale too, as of the site's new
  script. A deploy restarts the
  rooms, so every page reconnects, and hears the new build, within seconds. Stored
  game state isn't versioned yet (see "Known limitations").

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
- **No disabled buttons.** A button that can't be used right now is a `Button` with `why`
  (`src/ui/Button.tsx`): it looks unavailable (`aria-disabled`, greyed), and pressing it
  says why in a bubble over it for a few seconds ("Reconnecting…", "It's Sam's turn")
  instead of doing nothing. `busyWhy({busy, connected})` has the usual reasons; a game
  adds its own ("That column is full.", "You have to follow suit: play a ♥."). Board
  cells and cards in hand that are buttons follow it too (their own CSS keeps
  `:not(:disabled, .unavailable)` off hover effects). Only inputs, selects and sliders
  keep `disabled`.
- **On a phone the page scrolls, nothing inside it does** (≤860px): chat and the members
  list grow with the page instead of being boxes of their own (a scroll box inside a page
  traps the swipe), and `.stage` clips sideways with `overflow-x: clip`, not `hidden`, which
  would make it a scroller and stop the pinned tray from sticking.
- **Touch-sized buttons.** On a touch screen (`pointer: coarse`) every `.btn` is at least
  44px tall (small ones 38px), about what Apple and Google advise for a fingertip.
- `mode.ts`: light/dark. Follows the system until you choose (the settings cog, /settings, or
  Ctrl+Shift+L); the choice is remembered per browser. `index.html` applies it before first paint.
- Artwork lives in `public/icons/` (generated illustrations for gg and each game;
  a game's `GameUI.icon` points at its own).
- Small panels behind a button (your profile, a member, inviting a bot, the game's rules
  and settings, the connection) are all `components/Popover.tsx`: kept within what's
  visible (on a phone, above the browser's bars and the keyboard), scrolling inside
  without scrolling the page, following their button as the page scrolls (and closed once
  it's out of sight, unless you're typing in one), and closed by clicking elsewhere or Escape.
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
  round?(state): string;                     // ...but only within this round of them
  waitingOn(state): string[];                // whose move it is
  legalOps(state, player): Op[];             // what they could do now (bots, fuzzing)
  nextDeadline?(state): number | null;       // timers, via the DO alarm
  onDeadline?(state, ctx): void;
  checkInvariants?(state): void;             // e.g. chips are conserved
  bot: { play(view, ops, rand, opts): Op | null }; // the no-AI bot, easy or hard (see Bots)
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
- `testing.ts`: a seeded RNG for tests.
- `ui/`: the card-game base. `CardTable` (a wood-and-felt table with seats spaced
  around it, you at the bottom, bets and a dealer button in front of seats (`betAt`
  sets how far in: played cards sit nearer the middle than chips; `"seat"` keeps a bet
  just in front of its seat, clear of that seat's cards, whatever the table's size), content in the
  middle), `PlayerPlate` (nameplate, with an optional `badge` on its corner, like poker's dealer button), `Cards` (faces, backs, slots, fans),
  `Chips`/`Pot`/`DealerButton`, `TurnTimer`, `TimerField` (a set-up's seconds with
  a "Disable timer" button), `Herald`/`ActionTray`/`GameLog`
  for the strip, tray and history under the table (an `ActionTray` that's `pinned`, while
  your move is made in it, sticks to the bottom of the screen when the game is taller than
  the window, as it usually is on a phone: what you can do is never below the fold; games
  whose move is made on the board, like Cannons' aiming, leave it unpinned), and `useSend` (`sendOp` plus a `busy`
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
(`src/client/heartbeat.ts`). Sound effects (`src/ui/sound.ts`) are synthesized with the Web Audio API
(tones and filtered noise, no audio files), quiet, and on unless turned off with the
speaker in the top bar or on /settings (remembered per browser). Games play them for
what just happened (`play("chip")`, a flight's landing `sound`, `useOnChange` for live
changes only); in a background tab only the "your turn" chime plays. /ui lists them all
to audition.

**Conformance (`src/games/conformance.ts`).** Every registered game is
fuzzed with random legal moves from random people (mostly whoever's turn it is),
timers firing, and players removed for good. After each step it checks that legal
ops are accepted and unoffered table moves refused, `removePlayer` works, state
and views are plain JSON, `waitingOn` ⊆ `players`, deadlines make progress (no
alarm hot-loops), and the game's invariants hold. For poker that's about 3,000
hands per run, with people joining, leaving and sitting out mid-hand. The checks are
split between `conformance.<n>.test.ts` files so they run in parallel.

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

### The games

Each game's own notes (its rules as built, its state and view, its page, its bot) and
its manual QA checks are in a README in its folder. Read the one for a game you work on.

- [Tic-tac-toe](../src/games/tictactoe/README.md) (the smallest, and the template to copy)
- [Finns i sjön](../src/games/finnsisjon/README.md)
- [Fem kort](../src/games/femkort/README.md)
- [Battleship](../src/games/battleship/README.md)
- [Cannons](../src/games/cannons/README.md)
- [Chess](../src/games/chess/README.md)
- [Othello](../src/games/othello/README.md)
- [Four in a Row](../src/games/fourinarow/README.md)
- [Luffarschack](../src/games/luffarschack/README.md)
- [Go](../src/games/go/README.md)
- [Coast to Coast](../src/games/ticket/README.md)
- [Unicorn race](../src/games/unicorn/README.md)
- [Texas Hold'em](../src/games/poker/README.md)

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
  built-in and AI bots alike, so people see each move before the next lands; longer in a
  game whose moves take a while to play out, `GameMeta.botPaceMs`), then
  makes one move through the same
  path as a click (with `ifVersion`, so a move against an old situation is refused
  and it looks again). It plays on the same turn clocks as everyone. Seats are left
  to people first: bots follow quickly once a person sits down, and otherwise wait
  10 s before taking one (the snapshot's `players` says who's seated).
- **One decision for every game** (`kit/bot.ts`, `botMove`). Table moves are the
  same everywhere: take a free seat, sit back in if it was sat out, stand up when
  leaving, never start a game (that's for people). The game's own moves are up to
  the game's `bot.play(view, ops, rand, { strength })`. **Hard** (bots from before
  there was a choice, and AI bots' stand-ins) plays as described next; **easy** (new
  bots' default) like someone new to the game: it looks less far ahead (Four in a Row
  two moves, Go a few hundred playouts, chess not at all), misses things now and then
  (blocks, its own wins in tic-tac-toe, fives to stop in Luffarschack), and aims
  worse in Cannons; in the card games it plays without memory or much thought.
  `src/games/strength.test.ts` checks hard clearly beats easy. What each game's bot does
  is in that game's README. The bot
  decides in a Web Worker (`thinker.ts`, `think.worker.ts`: one for all the bots on the
  page), so a search never holds up the page; still, it should decide within half a
  second or so. An answer for a game that has moved on meanwhile is dropped.
  `{ quick: true }` (the conformance suite, building /try positions) asks a searching
  bot to cut its search short. It decides from the view only, so it can't cheat. The
  conformance suite seats a table of built-in bots, easy and hard, in every game and
  fails if the game ever waits on a bot that has no move.
- **Where it runs.** While the owner has the room open. One tab plays each bot
  (a Web Lock per bot); other tabs of the room wait and take over if it closes.
  When the owner leaves, the bot is a disconnected member, back when they return.
- **Joining.** Each bot is its own connection, and needs the game rules, a separate
  download (`bots/games.ts`; warmed up a few seconds after the room opens, since
  after a deploy the page's old copy is gone from the server). Until a bot is in,
  the owner sees it in the room's lists as *joining…*, or *can't join* with the
  reason on a press (the server's refusal, the rules not loading, or "gg was updated:
  reload", when the page's scripts are no longer the site's) and a × to call it
  off. It keeps trying meanwhile (`bots/joining.ts` holds the state).
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

An AI bot is the same bot, with the owner's model deciding instead of `bot.play`.
When adding one you pick one of your AI keys, a model and an effort (the cheapest
model at low effort by default; a key's model list is saved with it), and
optionally a personality. The room's chat and the bot's own view of the game go to
the model's provider; only its moves and messages go to the room. "Never reveal
your cards" is an instruction, not a boundary: people in the chat can try to talk
it out of it (the bot form says so). That's part of the fun, as at a real table, not
something to fix.

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
optional `meta.botNotes` (how its view and moves are written, for models). A game's UI
can add pictures under the rules in its help (`GameUI.help`; poker's hands, best to
worst, drawn with cards); those are for people only.

**Dev logs.** Bots live in the browser, so in dev they (and every room connection)
report through `devLog` to a Vite dev-server endpoint, which writes
`logs/<YYYY-MM-DD>/<room>.log` and a line to the terminal: each wake-up and why, the
update sent, the answer with timing and tokens, what came of it, stand-ins and
errors. Production builds drop it; e2e runs turn it off (`GG_DEV_LOGS=0`).

## Hot seat

People can take turns on one device, in games tagged `hot-seat` (`GameMeta.tags`: nothing
in them is hidden, so one screen can show it to everyone; chess, Othello, Go, Four in a
Row, Luffarschack, tic-tac-toe, Cannons, Unicorn race). Tags show on the game cards ("Hot seat"), with
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
  them (chess, Othello and Go put your side at the bottom). When one of you has just sat
  down and nobody's move is due, it turns to the next of you still standing, so they can
  sit down too. A bar over the game (*On this device*) shows who it's shown as and
  switches to someone else until the game next changes. The turn pill says "Sam's turn", as
  yours, and doesn't chime as the turn passes between you. In other games guests are
  just members.
- **State that belongs to one of you.** The game's page isn't remounted on a switch (the
  move just made still animates), so what it keeps for "you" is keyed by player: a move
  shown before the server has it (`usePending`, also keyed by game and version, so it's
  gone once the game changes), and Cannons' aim. A guest's connection showing another
  game (it hasn't caught up) isn't used; one a move behind is shown but can't play
  until it catches up.

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
| connections per IP per room | DO | 20; at the cap, one silent for 30s+ makes way | flaky phones leave dead sockets behind faster than they're swept |
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
- **Refused messages** get a normal `ack` with `rate_limited`. The client paces chat
  to stay under the limits, so a refused chat message just waits and goes again;
  someone more than 30 messages ahead gets their text back in the input with a toast.
  Refused moves show a toast.
- **Room creation** returns 429 JSON with a message, shown on the home page.
- **Too many tabs** of the same player: the oldest gets close code 4409 and shows
  "Open in another tab" with a "Use this tab" button. It does not auto-reconnect,
  since two tabs taking turns would loop forever.

The per-IP keys use `CF-Connecting-IP`, which Cloudflare's edge sets (clients can't
spoof it in production). Locally, tests set it to simulate players on different
networks.

## Room expiry

Rooms are deleted (`storage.deleteAll()`, after which the link shows "Room not
found") when nobody is connected and they've been idle **7 days**, or **24 hours**
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
- CI (`.github/workflows/ci.yml`) runs the typecheck and the unit and integration
  tests; the browser tests run locally. `pnpm run deploy` runs the typecheck and those
  tests before building.
- Every game's page is in the main bundle (about 800 kB, 250 kB gzipped); loading a
  game's UI only when it's picked would make the first visit lighter on a phone.
