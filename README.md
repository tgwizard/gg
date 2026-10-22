# gg

Games with friends. Create a room, share the link, pick a game, chat. No accounts.

Built on Cloudflare Workers + Durable Objects (one per room, hibernatable WebSockets,
SQLite storage), with a React SPA. Game logic is server-authoritative and modular.
Games so far: no-limit Texas Hold'em and tic-tac-toe.

- **Rooms** have short codes (`/r/K7QXM4PZR2`). Whoever has the link or code can join.
- **Names** are set once per browser and used in every room.
- **Resilient**: reconnects automatically, catches up on chat and game state, and
  survives refreshes, flaky networks and sleeping laptops without losing or
  duplicating actions.
- **Private hands**: each player only ever receives their own view of the game.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for how it works (including the
planned LLM bots) and [docs/QA.md](docs/QA.md) for the test and QA playbook.

## Development

```sh
npm install
npm run dev            # http://localhost:5173 (Vite + the Worker in workerd)
npm run test:all       # typecheck, unit, integration (workerd) and e2e (Playwright)
```

Other scripts: `npm run test:unit`, `npm run test:integration`, `npm run test:e2e`,
`npm run typecheck`, `npm run build`, `npm run cf-typegen` (after changing
`wrangler.jsonc`). E2E tests need `npx playwright install chromium` once.

## Adding a game

Copy `src/games/tictactoe` (it's small) and see "Games" in docs/ARCHITECTURE.md.

1. `src/games/<id>/index.ts`: a `GameDefinition` (config + op schemas, `create`,
   `apply`, `view`, `players`, `waitingOn`, `legalOps`, optional timers and
   invariants). Use `src/games/kit` for seats and timers. Register it in
   `src/games/registry.ts`.
2. `src/games/<id>/ui/`: a `GameUI` (`Game` component, optional `Setup`). Register it in
   `src/games/ui-registry.ts`.
3. `npm test`: the conformance suite fuzzes every registered game automatically.
   Add rule tests for the engine, and redaction tests if it has hidden information.

## Deploying

```sh
npm run deploy         # vite build && wrangler deploy
```

Then add a custom domain (e.g. `gg.tgwizard.com`) to the `gg` worker in the
Cloudflare dashboard.

## License

MIT
