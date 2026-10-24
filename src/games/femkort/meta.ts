import type { GameMeta } from "../types";

export const femKortMeta: GameMeta = {
  id: "femkort",
  name: "Fem kort",
  tagline: "The old Swedish trick game where only the last trick counts.",
  minPlayers: 2,
  maxPlayers: 6,
  rules: `Fem kort ("five cards") is an old Swedish game for 2–6 players. Five tricks are played, but only the last one counts: whoever takes the fifth trick wins the deal. The first to win 3 deals wins the game (the table can choose another number).
- Everyone gets five cards. Ace is high and two is low; there are no trumps.
- The player to the dealer's left leads any card. Everyone else plays one card in turn, clockwise.
- You must follow suit if you can, and you must beat the best card of that suit so far if you can (överstick). If you have none of the suit led, play any card.
- The highest card of the suit led takes the trick, and whoever took it leads the next one.
- The first four tricks win nothing by themselves, but taking the fourth means you lead the last one. Save a strong card for the end and get rid of your low ones early.
- After each deal, the deal passes to the left.
- Table settings can change a few things: the older rule (just follow suit, no need to beat), two deals in a row also winning the game, and bättre kort: once a deal, the player about to lead a trick (not the last) may ask for better cards, and if everyone else agrees, the cards are dealt again.`,
  botNotes: `Cards are two characters: rank (2–9, T for 10, J, Q, K, A) then suit (s, h, d, c), e.g. "Ks" or "Td". In the view, players are listed by seat; "hand" is your own cards; "trick" is the trick on the table, in the order played (each with seat, playerId and card), and "led" the suit led; "tricks" are the tricks taken this deal (with the winner's seat); "trickNo" is the trick being played (5 is the last, the only one that counts); "deals" is how many deals each player has won, and "config.dealsToWin" how many win the game. "you.playable" lists the cards you may play now. A move is {"type":"play","card":"Ks"}. Tactics: keep your strongest card for the last trick, get rid of low cards early, and when you can't win a trick follow with your lowest card; winning the fourth trick lets you lead the last.`,
};
