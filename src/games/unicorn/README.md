# Unicorn race

How it's built, for working on it: the platform it sits on (rooms, the game contract, the
kit, bots) is in [docs/ARCHITECTURE.md](../../../docs/ARCHITECTURE.md).

A children's race for 1–4 unicorns (WIP, an original design; expect it to change). Each
seat is a kid or a grown-up, chosen when sitting down (`sit` takes an optional `kid`) and
changeable between races (`{type: "kid"}`).
- **The track** (`TRACK` in `engine.ts`) is a loop of 30 stops from the start: stops with one
  kind of friend, stations with two or three to choose from, and meadow. There are six
  friends, one per rainbow color (Ladybug, Fox, Chick, Frog, Whale, Octopus); each has two
  stops of its own and three stations (a unit test keeps it so). After it comes the rainbow
  bridge: positions `LOOP`… (`BRIDGE` stops, the castle, `FINISH`, last).
- **A turn:** `roll` moves you forward by the die, stop by stop (`nextStop`). Where you stop,
  whoever's there that you lack wants a ride, and you pick them up yourself (`stage:
  "pick"`, `pick`), even when there's only one: it's a kids' game, the tap is the fun. With
  all six, the bridge opens for you: at the start you turn onto it instead of going round
  again, nobody's on it to pick up, and the first to reach the castle wins (galloping past
  it counts). The next race opens with the next racer (the first race, a kid).
- **Rainbow power:** every roll adds its pips to a shared meter; at `config.rainbowAt` (12,
  20 or 30 from the set-up; 20 by default) it empties and every kid racing gets a rainbow
  roll (at most 3 saved), used right after their next move, so the kid whose roll filled
  it rolls again at once.
- **The bot** only decides at stations: the friend with the fewest stops in the 12 ahead
  (easy: anyone). `meta.botPaceMs` (3 s) makes bots wait for a roll to play out.
- **The board** (`ui/`): an SVG meadow (`geometry.ts`: a superellipse loop with a wobble,
  stops spaced evenly along it; turned upright on phones). The bridge curves from the start
  into the middle to the castle (left on a wide board, up on a tall one), faded until
  someone has all six; the rainbow meter, the die and what to do go in the rest of the
  middle (`controls`). The pieces are toy figurines (`ui/art/*.webp`: generated art, cut out,
  facing right), drawn in 2.5D. Each unicorn stands on an oval base in its player's color,
  facing the way it goes (`facesLeft`), with its friends standing round it on the base, each
  in its own place (faint dashed spots for those still to find), drawn back to front; a new
  one hops on from the stop, and when it hops its shadow stays on the meadow. Unicorns on one
  stop stand in a slanting line, smaller the more there are (`huddle`); friends waiting at a
  stop stand on it. `useGallop` plays a live roll out a little behind the
  server: the die tumbles (900 ms), then the unicorn hops stop by stop (320 ms each); the
  choice, the bubbles and the results wait for that.
- **The die** (`ui/Die.tsx`) is a CSS 3D cube with real faces (opposites adding to 7), and
  it's the roll button: tap it. A roll spins it whole turns onto the number while it's
  thrown up and bounces; when it isn't yours to roll, pressing it says why.
- **Bubbles at the stop** (`StopBubble`): when a unicorn stops, a bubble pops out of that
  stop: who wants a ride (buttons for the one picking, the friends for everyone else),
  or for a few seconds what the roll came to ("Oh no, there's nothing here!", "The Fox
  hops on!", "Over the rainbow bridge!").
- **Rainbow power:** when the meter fills it flashes, and rainbow ribbons flow from it into
  every kid's unicorn; each is then powered up (a turning rainbow ring and twinkles on the
  board, a rainbow rim on their card) until they've rolled their rainbow roll.
- **Cards:** each racer's card has a ring of six segments in the friends' colors, filled
  as they come aboard, with how many in the middle (the castle once all six are aboard),
  and how many are still to find.
- Sounds: `dice`, `hop`, `sparkle`. Colors are tokens (`--uni-*`); the figurines are the same
  in the bubbles, on the pick buttons and on the cards (`Figure`, `FigureImg` in `ui/riders.tsx`).

## QA

Manual checks for after a change to this game (how to run them: [docs/QA.md](../../../docs/QA.md)).

- [ ] *Open the meadow*: empty seats offer two big buttons, 🧸 *Kid* (rainbow rim, wiggles on hover) and ☕ *Grown-up*; your plate has a switch whose thumb slides between them (rainbow for a kid) before the race.
- [ ] No disabled buttons: offline (or mid-send), pressing *Roll the die* or a seat button shows a bubble over it saying why. *Start the race* works with one racer; a kid goes first.
- [ ] Tap the die on your turn (it bobs; "Your turn! Tap the die"): it's thrown up and tumbles in 3D onto the number (real faces), then your unicorn hops stop by stop (a soft boop each; its shadow stays on the meadow) and everyone sees it. The pieces are toy figurines: each unicorn stands on an oval base in its player's color, facing the way it goes; friends stand on their stops. Tapping it when it isn't yours says whose turn it is.
- [ ] Where there's a friend you lack, a bubble pops out of the stop: *The Fox wants a ride!* (or *Who wants a ride?* at a station, offering only friends you lack); tap them and they hop onto your unicorn's base, each in their place round it (dashed spots for those still to find), and their segment fills on your card's ring. Others see who's being picked from. Meadow: "Oh no, there's nothing here!" (or similar) for a few seconds.
- [ ] All six: chat says the rainbow bridge is open, it lights up, your plate shows → 🏰. At the start you turn onto the bridge (others go round as usual); reaching or passing the castle wins. Two to four unicorns on one stop stand side by side, the nearer ones in front, their friends visible.
- [ ] The rainbow fills with every roll (*Often* / *Now and then* / *Rarely* in the set-up). Full: it flashes with a sparkle and rainbow ribbons flow into every kid's unicorn; they're powered up (a turning rainbow lying round the unicorn's base, a rainbow rim and "Rainbow power!" on their card) until they've rolled their rainbow roll, which comes after their next move. Grown-ups never get one.
- [ ] At the castle: the results (friends per player, everyone's six slots), *Race again* starts with the next racer.
- [ ] Bots wait for a roll to finish galloping before their move. Leaving mid-race passes the turn on.
- [ ] Phone: the meadow turns upright; the die, rainbow and buttons fit in its middle. Dark mode: a night meadow. Hot seat: a kid and a grown-up on one device take turns.
- [ ] `/try/unicorn/…`: one friend to go, rainbow nearly full, over the rainbow bridge, you won.
