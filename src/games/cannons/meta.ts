import type { GameMeta } from "../types";

export const cannonsMeta: GameMeta = {
  id: "cannons",
  name: "Cannons",
  tagline: "Set your angle and power, mind the wind, and lob one over the hill.",
  minPlayers: 2,
  maxPlayers: 4,
  tags: ["hot-seat"],
  rules: `Every player is a cannon on a hilly landscape, seen from the side. Take turns firing at each other: one hit knocks a cannon out, and the last cannon standing wins.
- On your turn, set the angle and the power, then fire. Everyone watches the ball fly. It lands where it lands: the same aim in the same wind always goes the same way.
- A ball that passes close enough to a cannon knocks it out (even your own). One that lands on the ground blows a crater in it; the ground under a cannon can be blown away too.
- The wind changes every turn, in strength and direction, and pushes the ball sideways: the longer it's in the air, the more. The flag at the top shows it.
- Balls can fly off the top and come back down, or off the sides for good.
- Each player's last shot leaves a faint trail, so you can see what to change.
- If the game has a turn clock and you run out, your turn goes by without a shot. Three times in a row and your cannon is out.`,
  botNotes: `Read "situation" in the view first: it says in words where your cannon and the others are (x across, from 0 at the left to 800 at the right; heights in meters), the ground between you, the wind, and where the recent shots landed (short of or past the cannon nearest to where they landed). A move is {"type":"fire","angle":50,"power":62}. The angle is whole degrees from 0 (pointing right, along the ground) through 90 (straight up) to 180 (pointing left): to shoot at a cannon on your right use 0–90 (45 goes furthest), on your left 90–180 (135 goes furthest). Power is a whole number from 5 to 100; more power goes further. Any angle and power in range is allowed, not just the examples listed. A sensible way to play: keep the angle and correct the power from where your last shot landed (a shot that landed short needs more power, one that went past needs less), allowing for the wind: wind blowing towards the target carries the ball further.`,
};
