# Battleship

How it's built, for working on it: the platform it sits on (rooms, the game contract, the
kit, bots) is in [docs/ARCHITECTURE.md](../../../docs/ARCHITECTURE.md).

Classic Battleship for two: each player hides a fleet (Carrier 5, Battleship 4,
Cruiser 3, Submarine 3, Destroyer 2) on a 10×10 sea, then they take turns firing.
- **Placing** is server-validated one ship at a time (`arrange` sends the whole,
  possibly unfinished layout), or `random` lets the server deal a valid fleet.
  `ready` needs all five; `unready` is allowed until both are ready. Placing ops
  are `concurrentOp`s: both players place at once, so one's placing never makes
  the other's click stale; `round` (the game's number) keeps one held up by a
  reconnect from landing in the next game. Fem kort's votes on better cards work the
  same way, each call for them its own round. The other
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

- **The built-in bot** places at random and hunts around every hit.

- **Placing and resends.** Placing ops are concurrent within a game (`round` keeps them out
  of the next one). Within a game, resends keep the player's own order: a *Ready* lost on
  the way lands before a change made after it, and that change is then refused ("You're
  ready"); *Change fleet* and make it again.

## QA

Manual checks for after a change to this game (how to run them: [docs/QA.md](../../../docs/QA.md)).

- [ ] Nobody seated: the seas are greyed out with a "Take a seat" prompt; seated alone, it says you're waiting for an opponent.
- [ ] Placing: the next ship goes where you click (green/red preview on hover), *Rotate* or <kbd>R</kbd> turns it, clicking a placed ship picks it up, *Random* deals a fleet, *Ready* needs all five. With "ships may touch" off, touching ships are refused.
- [ ] The other player only sees "placing…" / "ready" over a blank sea. DevTools → WS: no `row`/`col` of the opponent's ships ever arrives before game over.
- [ ] Firing: misses get a cream peg, hits a terracotta one; a hit doesn't show the ship; a sinking shows the ship and says "You sank Bob's Cruiser". The defender is told which of their ships was hit.
- [ ] Motion: the newest shot drops in with a splash for a miss and a burst for a hit, and a sunk ship rocks and settles dark; only shots that arrive live (not after a refresh or reconnect), none with reduced motion.
- [ ] Strict alternation by default; with "a hit earns another shot" on, you keep shooting until you miss.
- [ ] Let the clock run out: a random shot is fired for you; three in a row forfeits. The placement clock completes unfinished fleets at random.
- [ ] Sink the fleet: winner announced in chat, both fleets revealed, *Play again* starts placing with the other player shooting first.
- [ ] Leaving while placing calls the game off; leaving while firing forfeits.
- [ ] Phone: while placing, your sea and the dock fit with the other side as just a nameplate; while firing, the sea you aim at comes first.
