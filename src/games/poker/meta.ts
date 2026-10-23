import type { GameMeta } from "../types";

export const pokerMeta: GameMeta = {
  id: "poker",
  name: "Texas Hold'em",
  tagline: "No-limit hold'em for 2–9 players.",
  minPlayers: 2,
  maxPlayers: 9,
  rules: `No-limit Texas Hold'em. Win chips by having the best five-card hand at the showdown, or by making everyone else fold.
- Each hand, the two players after the dealer button post the small and big blinds. Everyone gets two private cards.
- Betting rounds: before the flop, after the flop (three shared cards), after the turn (a fourth) and after the river (a fifth).
- On your turn: fold, check (if there's nothing to call), call the current bet, or raise. No limit: you can raise up to all your chips.
- When betting ends with more than one player in, the best five-card hand from your two cards and the five shared cards wins the pot.
- Hands, best first: straight flush, four of a kind, full house, flush, straight, three of a kind, two pair, one pair, high card.
- Run out of time and you check if you can, otherwise fold. Lose all your chips and you can rebuy.`,
  botNotes: `Cards are two characters: rank (2–9, T for 10, J, Q, K, A) then suit (s, h, d, c), e.g. "As" or "Td". A raise is written as the total you bet this round ("to"), between you.actions.minRaiseTo and maxRaiseTo; any amount in that range is fine, not just the examples listed.`
};
