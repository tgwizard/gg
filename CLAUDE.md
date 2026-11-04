# gg: notes for Claude

- Cloudflare Worker + one `Room` Durable Object per room (`src/worker/room.ts`), React SPA (`src/client`), games in `src/games/<id>` (engine + `ui/`). Read `docs/ARCHITECTURE.md` first, and a game's own `README.md` (how it's built, its QA checks) before working on it.
- Client/server contract: `src/shared/protocol.ts`. Bump `PROTOCOL_VERSION` on breaking changes to those messages. Games' views and moves need no bump: each build carries a per-game hash, and pages a build behind reload (`src/client/update.ts`, "Upgrades" in the architecture doc).
- Game state never goes to clients directly; only `view(state, viewer)`. Keep views built field by field.
- The room server must stay game-agnostic (it only uses the `GameDefinition` contract). Shared game building blocks go in `src/games/kit`; every game must pass the conformance suite (`src/games/conformance.ts`, run by `conformance.<n>.test.ts`).
- No disabled buttons: one that can't be used now is a `Button` from `src/ui` with `why` (greyed; pressing it shows why). Use it for anything new or touched.
- UI: design tokens and shared components in `src/ui` (light + dark via `data-mode`), card-game parts in `src/games/kit/ui`. Use the token names, never raw colors in components; check both modes and `/ui`.
- Ports 5173 and 5199 are often taken by other projects on this machine; use `--port 5311` for dev. E2E uses 5312.
- `pnpm run deploy` builds the working tree, not the last commit: stash uncommitted work that isn't shipping first.
- Before calling a big change done: `pnpm test:all`, then the relevant parts of `docs/QA.md` and the changed games' READMEs (screenshots via `node test/e2e/screens.ts`).
- Debugging in dev: the browser (bots: wake-ups, prompts, answers, stand-ins; connections) logs to `logs/<YYYY-MM-DD>/<room>.log` and the dev server's terminal, via `devLog` (`src/client/devlog.ts`, sink in `tools/dev-logs.ts`). Read these first when a bot misbehaves. Never log keys.
