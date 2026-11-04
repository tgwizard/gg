# Cannons

How it's built, for working on it: the platform it sits on (rooms, the game contract, the
kit, bots) is in [docs/ARCHITECTURE.md](../../../docs/ARCHITECTURE.md).

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

## QA

Manual checks for after a change to this game (how to run them: [docs/QA.md](../../../docs/QA.md)).

- [ ] Setup: players (2–4), landscape (gentle, hilly, mountains), wind (none, light, strong) and the turn timer. The game starts when every seat is taken; a new field each game.
- [ ] Nobody seated: a "Take a seat" prompt over a greyed field; seated alone, "Waiting for an opponent".
- [ ] The field: layered ground with grass tufts, cliffs into the sea at both edges (seen when a shot flies off the side: it splashes in, and the camera stays on it a moment), field guns that face the way they aim with the trail resting on the ground; the gun whose turn it is has a ring of light under it.
- [ ] Aiming on your turn: dragging from your cannon sets the angle and power (a dotted line with the numbers); the ◀ ▶ and − + steppers and sliders, and ← → / ↑ ↓ (Shift for 5) do too; Space or *Fire!* fires. Out of turn there are no controls. Each dial has its label and value above its slider, with the steppers either side; your last shot is in a line under them.
- [ ] A shot: everyone sees the ball fly with a trail, a soft thump, then a burst and a crater where it lands; a ball high or wide makes the camera widen to follow it. The news says where it went ("Your shot landed 40 m short of Bob (to the left)"), and the shooter's faint trail stays until their next shot.
- [ ] The wind badge shows the flag, a number and an arrow; it changes between turns, and the clouds drift with it.
- [ ] A hit (`/try/cannons/one-more`): a fireball, flying wreckage, a flash and a shake; the cannon is left a burning wreck with black smoke, the chat says who hit whom only once the ball has landed, and the end screen comes up after the burst. Refresh mid-flight: the field shows the result, nothing replays.
- [ ] Game over: one *Play again*, on the result (no second one in the tray below); if a seat emptied, it says it's waiting for every seat instead.
- [ ] Free for all (`/try/cannons/free-for-all`): plates left to right as the cannons stand, knocked-out cannons are skipped, last standing wins.
- [ ] Clock: let it run out and the turn goes by without a shot ("ran out of time: no shot"); three in a row and your cannon is out. Leaving before anyone fires calls it off; after, your cannon is out.
- [ ] Against a built-in bot: its first shot is off, then it closes in, usually hitting within 3–5 shots.
- [ ] Laptop (1440×900): field, plates and controls fit without scrolling. Phone: the field fills the width with the controls below; dragging aims without scrolling the page. Both modes: sky, ground, cannons, trails and labels readable.
