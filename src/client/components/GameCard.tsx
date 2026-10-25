import type { CSSProperties } from "react";
import { GAME_TAGS, type GameMeta } from "../../games/types";
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

/** How many play, and the game's tags ("Hot seat"), on one line. */
export function GameFacts({ meta, style }: { meta: GameMeta; style?: CSSProperties }) {
  return (
    <span className="game-facts" style={style}>
      <span className="label">{playerCount(meta.minPlayers, meta.maxPlayers)}</span>
      {meta.tags?.map((t) => (
        <span key={t} className="game-tag" title={GAME_TAGS[t].hint} data-testid={`tag-${t}`}>
          {GAME_TAGS[t].label}
        </span>
      ))}
    </span>
  );
}

/**
 * View-transition names for a game's card and its parts, so the card can grow into the
 * game's set-up (see GamePicker) with its art and name moving rather than redrawn.
 */
export function morphStyle(id: string, part?: "art" | "name" | "tagline" | "players"): CSSProperties {
  if (!part) return { viewTransitionName: `game-${id}`, viewTransitionClass: "game-morph" };
  return { viewTransitionName: `game-${id}-${part}`, viewTransitionClass: part === "art" ? "game-morph-art" : "game-morph-text" };
}

/** A game's artwork, name and pitch. A button when `onClick` is given; `morph` names its parts for a view transition. */
export function GameCard({ game, selected, morph, onClick }: { game: GameUI; selected?: boolean; morph?: boolean; onClick?(): void }) {
  const id = game.meta.id;
  const style = (part?: Parameters<typeof morphStyle>[1]) => (morph ? morphStyle(id, part) : undefined);
  const body = (
    <>
      <img className="game-card-art" src={game.icon} alt="" width={88} height={88} style={style("art")} />
      <span className="game-card-text">
        <span className="game-card-name" style={style("name")}>
          <strong className="display">{game.meta.name}</strong>
          <WipBadge wip={game.meta.wip} />
        </span>
        <span className="game-card-tagline" style={style("tagline")}>
          {game.meta.tagline}
        </span>
        <GameFacts meta={game.meta} style={style("players")} />
      </span>
    </>
  );
  return onClick ? (
    <button type="button" className={`game-card box ${selected ? "selected" : ""}`} onClick={onClick} aria-pressed={selected} style={style()}>
      {body}
    </button>
  ) : (
    <div className="game-card box">{body}</div>
  );
}
