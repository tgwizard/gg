import type { ReactNode } from "react";
import { nameStyle, PixelIcon } from "../../../ui";
import "./kit.css";

/**
 * A player's nameplate at the table: name, online light, and whatever lines the game
 * adds (chips, status, a turn timer). Becomes a button when `onClick` is given.
 */
export function PlayerPlate(props: {
  playerId: string;
  name: string;
  you?: boolean;
  online?: boolean;
  /** It's their move. */
  active?: boolean;
  /** Not in play right now (folded, away, out). */
  dim?: boolean;
  winner?: boolean;
  /** Choosable (e.g. who to ask), and chosen. */
  selectable?: boolean;
  selected?: boolean;
  onClick?(): void;
  tags?: ReactNode;
  className?: string;
  testId?: string;
  children?: ReactNode;
}) {
  const classes = [
    "plate box tight on-night",
    props.active && "active",
    props.dim && "dim",
    props.winner && "winner",
    props.selectable && "selectable",
    props.selected && "selected",
    props.className,
  ]
    .filter(Boolean)
    .join(" ");
  const body = (
    <>
      {props.winner && <PixelIcon name="crown" scale={3} className="plate-crown" title="Winner" />}
      <div className="plate-name">
        <span className={`light ${props.online === false ? "bad" : "good"}`} title={props.online === false ? "Disconnected" : "Online"} />
        <span className="name" style={nameStyle(props.playerId)}>
          {props.name}
        </span>
        {props.you && <span className="tag gilt">you</span>}
        {props.tags}
      </div>
      {props.children}
    </>
  );
  return props.onClick ? (
    <button type="button" className={classes} onClick={props.onClick} disabled={!props.selectable} aria-pressed={props.selected} data-testid={props.testId}>
      {body}
    </button>
  ) : (
    <div className={classes} data-testid={props.testId}>
      {body}
    </div>
  );
}
