# Tic-tac-toe

How it's built, for working on it: the platform it sits on (rooms, the game contract, the
kit, bots) is in [docs/ARCHITECTURE.md](../../../docs/ARCHITECTURE.md).

The smallest complete game, and the template to copy: kit seats (scores survive
standing up), a turn clock that forfeits the round and the seat (so an empty
chair doesn't keep losing rounds, and an abandoned table stops), alternating
openers, and a pause between rounds. It has no hidden information, so the view is the state.

- **The built-in bot** takes wins and blocks; easy misses some of both.

## QA

Manual checks for after a change to this game (how to run them: [docs/QA.md](../../../docs/QA.md)).

- [ ] Entering with no side picked: the board is greyed out with a "Pick a side" prompt (buttons in your color); seated alone, it says you're waiting for an opponent; watching a full game, the board is live and the status says you're watching.
- [ ] Two players take X and O; the round starts at once; a win highlights the line, scores it and announces it in chat.
- [ ] Motion: the mark just played pops in, and a win gets a line drawn across it in the winner's color; neither replays after a refresh, and with reduced motion the line is just there.
- [ ] The next round starts on its own with the other player opening. Draws are counted.
- [ ] Leaving mid-round forfeits it. Leaving and coming back keeps your win count.
