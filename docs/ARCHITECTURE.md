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

- `POST /api/rooms` makes a random UUID and calls `create()` on the Durable Object
  `idFromName(uuid)`. Rooms only exist once created, so a mistyped link shows
  "Room not found" instead of silently making a new empty room. There is no room
  listing; the UUID is the only capability.
- The DO stores everything in its SQLite database (`kv`, `members`, `chat`, `ops`),
  so it can be evicted or hibernate at any time and come back intact.

## Identity

There is no sign-in. Each browser makes a random **secret** (localStorage
`gg.secret`) and sends it in `hello`. The server derives the public **player id**
as `sha256(secret)[:16 hex]`. Player ids are visible to everyone, but you can't
claim someone's id (and so see their hole cards) without their secret. Your
**name** is global (localStorage `gg.name`), sent on every hello, and
changeable at any time.

## Protocol (`src/shared/protocol.ts`)

Client → server messages are validated with zod. Every mutation carries a
client-generated `cid`.

| client → server | purpose |
| --- | --- |
| `hello {protocol, secret, name, chatCursor}` | (re)join; `chatCursor` = last chat seq seen |
| `setName` | rename |
| `chat {cid, text}` | chat message |
| `selectGame {cid, gameId, config}` / `endGame {cid, instanceId}` | game lifecycle |
| `gameOp {cid, instanceId, op, ifVersion?}` | a move |

| server → client | purpose |
| --- | --- |
| `welcome` | full snapshot: you, members, chat since cursor (or latest page), game view |
| `members` / `chat` / `game` | incremental updates |
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
  reconnecting. Chat typed while offline is queued and shown as pending. Game
  ops need a live connection, and a resent op carries `ifVersion`, so it's
  rejected (`stale`) instead of applied to a game the player hasn't seen.
- **Liveness.** The client pings every 10s and treats 8s of silence as a dead
  connection (catching half-open sockets), reconnecting with jittered
  exponential backoff (max 10s), immediately on `online`, and on tab focus. The
  server's alarm closes sockets that haven't pinged for 2 minutes, so presence
  stays honest.
- **Upgrades.** `PROTOCOL_VERSION` mismatch → close code 4426 → the client shows
  "reload to update" instead of misbehaving.

## Games (`src/games`)

A game is a server-side `GameDefinition` (`src/games/types.ts`) plus a client
`GameUI` (`src/games/ui.ts`), registered in `registry.ts` and `ui-registry.ts`.

```ts
interface GameDefinition<State, Op, View, Config> {
  meta; configSchema; opSchema;              // zod-validated config + ops
  create(config, ctx): State;
  apply(state, actor, op, ctx): void;        // mutate a private copy or throw GameError
  view(state, viewer): View;                 // per-player redaction
  waitingOn(state): string[];                // who must act
  nextDeadline?(state): number | null;       // timers, via the DO alarm
  onDeadline?(state, ctx): void;
  describeForBot?(view): { situation; legalOps };  // future: bots
}
```

- **Server-authoritative.** Clients send ops, and the DO validates and applies them
  to a `structuredClone` of the state. If `apply` throws, nothing changes.
- **Secrets never leave the server.** Only `view(state, viewer)` is sent, built per
  player. The poker view is built field by field (never spread from state), so a
  new secret field can't leak by accident. Integration tests check every byte each
  client receives.
- **Randomness** comes from `ctx.randomInt` (crypto-backed in production, seeded
  in tests).
- **Time** comes from `ctx.now`; deadlines are executed by the DO alarm, which
  also catches up if several are overdue.
- Games can post to room chat via `ctx.announce()`. Chat is shared by the room and
  the game.

### Texas Hold'em (`src/games/poker`)

No-limit hold'em for 2–9 seats: blinds (heads-up rules included), min-raise
tracking, incomplete all-in raises that don't re-open betting, side pots, split
pots with odd chips going clockwise from the button, uncalled bets returned, dead
money from players who leave, street-by-street all-in runouts, a turn clock
(auto check/fold, then sit out), rebuys, and automatic next hands.

## Bots (planned)

Bots are designed to be just another kind of room member:

1. **Members have a `kind`** (`human` | `bot`) already. A bot gets an id like
   `bot:<uuid>`, plus an `owner` (the player who added it).
2. **Adding a bot** is a room op. The owner supplies a provider credential (an API
   key, or an OAuth token from "sign in with ChatGPT"). It's stored encrypted
   in the room DO (key from a Worker secret) and never sent to clients.
3. **Driving.** After every commit, the DO checks `waitingOn(state)` for bot ids.
   For each one, it builds the bot's own redacted `view`, asks the game's
   `describeForBot(view)` for a prompt and the legal ops, and calls the LLM
   (`ctx.waitUntil` / an alarm, with a timeout). The answer is parsed with the
   game's `opSchema` and submitted through the same `apply` path as a human,
   with a cid, so retries are idempotent.
4. **Same rules as humans:** same view redaction (bots can't see your cards),
   same turn clock (a slow model times out), and the chat transcript can go into
   the prompt so bots can banter.

Nothing in the protocol needs to change for this. Bots are server-side actors.

## Known limitations / next steps

- No rate limiting on room creation or chat yet (add a per-IP limiter on
  `POST /api/rooms` and a per-socket token bucket in the DO before going public).
- Chat retention is the last ~1000 messages per room. Rooms never expire (add an
  alarm that deletes storage after N days idle).
- Multiple tabs with the same identity are the same player (by design). Both can act.
- TODO: CI (GitHub Actions running `npm run test:all`). For now, tests run locally.
