import type { GameUI } from "../../games/ui";

/** A game's artwork, name and pitch. A button when `onClick` is given. */
export function GameCard({ game, selected, onClick }: { game: GameUI; selected?: boolean; onClick?(): void }) {
  const body = (
    <>
      <img className="game-card-art" src={game.icon} alt="" width={88} height={88} />
      <span className="game-card-text">
        <strong className="display">{game.meta.name}</strong>
        <span className="game-card-tagline">{game.meta.tagline}</span>
        <span className="label">
          {game.meta.minPlayers}–{game.meta.maxPlayers} players
        </span>
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
