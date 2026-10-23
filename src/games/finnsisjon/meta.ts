import type { GameMeta } from "../types";

export const finnsISjonMeta: GameMeta = {
  id: "finnsisjon",
  name: "Finns i sjön",
  tagline: "Go Fish, the Swedish way. Ask for cards, collect fours.",
  minPlayers: 2,
  maxPlayers: 6,
  rules: `Go Fish, the Swedish way, for 2–6 players. Collect books: all four cards of a rank. Most books wins.
- Each player gets 7 cards (5 with four or more players); the rest is the lake (sjön).
- On your turn, ask another player for a rank you hold yourself, e.g. "Give me your Kings".
- If they have any, they hand over all of them (everyone sees which), and you ask again.
- If they have none, they say "Finns i sjön!" and you draw from the lake. If you draw the rank you asked for, show it and ask again; otherwise your turn ends.
- When you hold all four of a rank, you lay them down as a book.
- With an empty hand you draw at the start of your turn. The game ends when all 13 books are down.`,
  botNotes: `Cards are two characters: rank (2–9, T for 10, J, Q, K, A) then suit (s, h, d, c), e.g. "Ks" or "Td". Ranks in moves are a single character, e.g. "K". The log shows who asked whom for what and what they got; use it to remember who holds what.`
};
