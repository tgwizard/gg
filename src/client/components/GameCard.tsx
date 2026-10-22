import type { GameUI } from "../../games/ui";

/** "2 players", "2–9 players". */
export function playerCount(min: number, max: number): string {
  return min === max ? `${min} players` : `${min}–${max} players`;
}

/** A game's artwork, name and pitch. A button when `onClick` is given. */
export function GameCard({ game, selected, onClick }: { game: GameUI; selected?: boolean; onClick?(): void }) {
  const body = (
    <>
      <img className="game-card-art" src={game.icon} alt="" width={88} height={88} />
      <span className="game-card-text">
        <strong className="display">{game.meta.name}</strong>
        <span className="game-card-tagline">{game.meta.tagline}</span>
        <span className="label">{playerCount(game.meta.minPlayers, game.meta.maxPlayers)}</span>
      </span>
    </>
  );
  return onClick ? (
    <button type="button" className={`game-card box ${selected ? "selected" : ""}`} onClick={onClick} aria-pressed={selected}>
      {body}
    </button>
  ) : (
    <div className="game-card box">{body}</div>
  );
}
