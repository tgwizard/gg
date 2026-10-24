import type { GameUI } from "../../games/ui";

/** "2 players", "2–9 players". */
export function playerCount(min: number, max: number): string {
  return min === max ? `${min} players` : `${min}–${max} players`;
}

/** A small "WIP" tag next to the name of a game that's still being tuned. */
export function WipBadge({ wip }: { wip?: boolean }) {
  return wip ? (
    <span className="wip-badge" title="Work in progress: still being tuned">
      WIP
    </span>
  ) : null;
}

/** A game's artwork, name and pitch. A button when `onClick` is given. */
export function GameCard({ game, selected, onClick }: { game: GameUI; selected?: boolean; onClick?(): void }) {
  const body = (
    <>
      <img className="game-card-art" src={game.icon} alt="" width={88} height={88} />
      <span className="game-card-text">
        <span className="game-card-name">
          <strong className="display">{game.meta.name}</strong>
          <WipBadge wip={game.meta.wip} />
        </span>
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
