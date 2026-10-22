import { PixelIcon } from "../../ui";
import type { GameUI } from "../../games/ui";

/** A game's emblem, name and pitch. A button when `onClick` is given. */
export function GameCard({ game, selected, onClick }: { game: GameUI; selected?: boolean; onClick?(): void }) {
  const body = (
    <>
      <span className="game-card-emblem">
        <PixelIcon name={game.icon} scale={4} />
      </span>
      <span className="game-card-text">
        <strong className="display">{game.meta.name}</strong>
        <span className="game-card-tagline">{game.meta.tagline}</span>
        <span className="label">
          {game.meta.minPlayers}–{game.meta.maxPlayers} players
        </span>
      </span>
      {selected && <PixelIcon name="check" scale={3} className="game-card-check" />}
    </>
  );
  return onClick ? (
    <button type="button" className={`game-card box tight ${selected ? "selected" : ""}`} onClick={onClick} aria-pressed={selected}>
      {body}
    </button>
  ) : (
    <div className="game-card box tight">{body}</div>
  );
}
