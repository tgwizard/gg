# gg

Games with friends. Create a room, share the link, pick a game, chat. No accounts.
Live at <https://gg.tgwizard.com>.

Built on Cloudflare Workers + Durable Objects (one per room, hibernatable WebSockets,
SQLite storage), with a React SPA. Game logic is server-authoritative and modular.
Games so far: Coast to Coast (a fan-made take on Ticket to Ride), no-limit Texas Hold'em,
Battleship, Finns i sjön (Swedish Go Fish) and tic-tac-toe.

- **Rooms** have short codes (`/r/K7QXM4PZR2`). Whoever has the link or code can join.
- **Names** (and colors) are set once per browser and used in every room. Change
  them, or delete everything gg keeps in your browser, at `/settings`.
- **Resilient**: reconnects automatically, catches up on chat and game state, and
  survives refreshes, flaky networks and sleeping laptops without duplicating
  actions. Chat typed offline is sent when you're back, even after a refresh;
  moves need a connection, so one made while offline is refused rather than
  played into a game you haven't seen.
- **Private hands**: each player only ever receives their own view of the game.
- **Bots**: add one from the members panel and it takes a free seat in any game.
  Easy bots need no AI. AI bots use your own Anthropic, OpenAI or Meta (Muse) key
  (paste it at `/settings`), with a personality of your choosing, and chat as they
  play. Bots play from your tab while you have the room open, and keys never leave
  your browser.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for how it works (including bots) and [docs/QA.md](docs/QA.md) for the test and QA playbook.

## Development

```sh
pnpm install
pnpm dev               # http://localhost:5173 (Vite + the Worker in workerd)
pnpm test:all          # typecheck, unit, integration (workerd) and e2e (Playwright)
```

Other scripts: `pnpm test:unit`, `pnpm test:integration`, `pnpm test:e2e`,
`pnpm typecheck`, `pnpm build`, `pnpm cf-typegen` (after changing
`wrangler.jsonc`). E2E tests need `pnpm exec playwright install chromium` once.

## Adding a game

Copy `src/games/tictactoe` (it's small) and see "Games" in docs/ARCHITECTURE.md.

1. `src/games/<id>/index.ts`: a `GameDefinition` (config + op schemas, `create`,
   `apply`, `view`, `players`, `waitingOn`, `legalOps`, an Easy `bot`, optional
   timers and invariants). Use `src/games/kit` for seats, table moves (`lobby.ts`)
   and timers. Register it in `src/games/registry.ts`.
2. `src/games/<id>/ui/`: a `GameUI` (`Game` component, optional `Setup`, and `icon`
   artwork in `public/icons/`). Build it from `src/games/kit/ui` (table, cards, plates)
   and `src/ui` (buttons, panels; see `/ui`). Register it in `src/games/ui-registry.ts`.
3. `pnpm test`: the conformance suite fuzzes every registered game automatically,
   and has a table of its bots play it.
   Add rule tests for the engine, and redaction tests if it has hidden information.

## Deploying

```sh
pnpm run deploy        # vite build && wrangler deploy (not `pnpm deploy`: that is a pnpm command)
```

This needs `pnpm exec wrangler login` once. The custom domain `gg.tgwizard.com` is set in
`wrangler.jsonc`; Cloudflare manages its DNS record and certificate.

## License

MIT
