import type { GameMeta } from "../types";

export const unicornMeta: GameMeta = {
  id: "unicorn",
  name: "Unicorn race",
  tagline: "Roll, gallop round the meadow, give six friends a ride to the castle. For kids and grown-ups.",
  minPlayers: 1,
  maxPlayers: 4,
  wip: true,
  // A roll plays out for a couple of seconds: the die tumbles, then the unicorn hops along.
  botPaceMs: 3_000,
  tags: ["hot-seat"],
  rules: `A race for 1–4 unicorns round a meadow of 30 stops. Gather all six friends (the Ladybug, the Fox, the Chick, the Frog, the Whale and the Octopus, one of each color of the rainbow) and be the first to bring them to the castle.
- On your turn, roll the die and gallop that many stops along the path (round and round: it's a loop).
- Where you stop, pick up a friend you don't have yet: they join the group round your unicorn. Some stops have one kind of friend, some several (you choose one), and some are just meadow.
- With all six aboard, the rainbow bridge opens for you: gallop on to the start and over the bridge. The first to reach the castle wins (you needn't land on it exactly).
- Every roll, by anyone, charges the rainbow. When it's full, every kid gets a rainbow roll: one more roll after their move.
- When you sit down you join as a kid or a grown-up.`,
  botNotes: `The track is a loop of 30 stops, numbered from 0 (the start). track[i].riders lists the friends at stop i. Each racer has "at" (their stop) and "riders" (the friends they have). With all six, at the start a racer turns onto the bridge: stops 30 and up, the castle (the finish) at 30 + bridge - 1. Roll with {type: "roll"}; when the view's "choice" lists friends, pick one with {type: "pick", rider}.`,
};
