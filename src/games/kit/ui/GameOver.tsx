import { type CSSProperties, type ReactNode, useEffect, useRef, useState } from "react";
import { Avatar, play, PlayerName, useIsBot, usePlayerColors } from "../../../ui";
import { reducedMotion } from "./Flights";
import "./kit.css";

export interface GameOverRow {
  playerId: string;
  name: string;
  /** Shares first place. */
  winner?: boolean;
  /** Left before the end. */
  left?: boolean;
  /** One per column. */
  cells: ReactNode[];
  /** A line under the row (the tickets someone finished). */
  detail?: ReactNode;
}

/**
 * The end of a game, over the board: who won and how, everyone's scores (best first),
 * and what's next (play again). When the game ends while you watch there's a sound,
 * and confetti if you won; arriving at a finished game just shows the result. "See
 * the board" tucks it into a small bar, so the final position can be looked at.
 */
export function GameOver(props: {
  /** Shown while true; keep it rendered so it can tell a game ending from one that had ended. */
  open: boolean;
  /** Which game this is (a new one opens the results again). */
  gameKey: string | number;
  me: string;
  title: ReactNode;
  subtitle?: ReactNode;
  /** Column headings for `cells`; the last is shown big as the score. */
  columns: string[];
  rows: GameOverRow[];
  actions?: ReactNode;
  testId?: string;
  /** On both the overlay and the tucked bar, for placing them in the game's layout. */
  className?: string;
}) {
  const colorOf = usePlayerColors();
  const isBot = useIsBot();
  const [tucked, setTucked] = useState(false);
  const [live, setLive] = useState(false);
  const was = useRef<{ open: boolean; key: string | number } | null>(null);

  useEffect(() => {
    const before = was.current;
    was.current = { open: props.open, key: props.gameKey };
    if (!props.open) return setTucked(false);
    // Only a game that ended while you were watching gets the fanfare.
    if (before && !(before.open && before.key === props.gameKey)) {
      setLive(true);
      setTucked(false);
      const mine = props.rows.find((r) => r.playerId === props.me);
      play(!mine ? "good" : mine.winner ? "win" : "lose", 0.2);
    }
  }, [props.open, props.gameKey]);

  if (!props.open) return null;
  const mine = props.rows.find((r) => r.playerId === props.me);
  const celebrate = live && !!mine?.winner && !reducedMotion();
  if (tucked) {
    return (
      <div className={`game-over-bar box on-brand ${props.className ?? ""}`} data-testid={props.testId && `${props.testId}-bar`}>
        <span className="display">{props.title}</span>
        <span className="row">
          <button type="button" className="btn subtle small" onClick={() => setTucked(false)}>
            Show results
          </button>
          {props.actions}
        </span>
      </div>
    );
  }
  let place = 0;
  return (
    <div className={`game-over ${live ? "live" : ""} ${props.className ?? ""}`} data-testid={props.testId}>
      {celebrate && <Confetti />}
      <div className="game-over-card box" role="dialog" aria-label="Results">
        <div className="game-over-winners" aria-hidden>
          {props.rows
            .filter((r) => r.winner)
            .map((r) => (
              <span key={r.playerId} className="game-over-winner">
                <Crown />
                <Avatar name={r.name} color={colorOf(r.playerId)} bot={isBot(r.playerId)} size="lg" />
              </span>
            ))}
        </div>
        <h2 className="display game-over-title">{props.title}</h2>
        {props.subtitle && <p className="game-over-sub">{props.subtitle}</p>}
        <table className="game-over-scores">
          <thead>
            <tr>
              <th />
              <th className="game-over-who" />
              {props.columns.map((c) => (
                <th key={c}>{c}</th>
              ))}
            </tr>
          </thead>
          {props.rows.map((r, i) => {
              // Tied winners share first place; everyone else counts on from there.
              place = r.winner ? 1 : Math.max(place + 1, i + 1);
              return (
                <Row key={r.playerId} row={r} place={place} you={r.playerId === props.me} color={colorOf(r.playerId)} bot={isBot(r.playerId)} columns={props.columns.length} delay={live ? 0.25 + i * 0.12 : 0} />
              );
            })}
        </table>
        <div className="game-over-actions">
          {props.actions}
          <button type="button" className="btn ghost small" onClick={() => setTucked(true)}>
            See the board
          </button>
        </div>
      </div>
    </div>
  );
}

function Row({ row, place, you, color, bot, columns, delay }: { row: GameOverRow; place: number; you: boolean; color: number; bot: boolean; columns: number; delay: number }) {
  const style = delay ? { animationDelay: `${delay}s` } : undefined;
  // One body per player, so their line of detail shares the row's highlight.
  return (
    <tbody className={`game-over-player ${row.winner ? "winner" : ""} ${you ? "you" : ""} ${row.detail ? "has-detail" : ""}`} style={style}>
      <tr className="game-over-row">
        <td className="game-over-place">{row.winner ? "★" : place}</td>
        <th scope="row" className="game-over-who">
          <span className="game-over-name">
            <Avatar name={row.name} color={color} bot={bot} size="sm" />
            <PlayerName name={row.name} color={color} />
            {you && <span className="tag accent">you</span>}
            {row.left && <span className="muted small">left</span>}
          </span>
        </th>
        {row.cells.map((c, i) => (
          <td key={i} className={i === columns - 1 ? "game-over-total" : undefined}>
            {c}
          </td>
        ))}
      </tr>
      {row.detail && (
        <tr className="game-over-detail">
          <td />
          <td colSpan={columns + 1}>{row.detail}</td>
        </tr>
      )}
    </tbody>
  );
}

function Crown() {
  return (
    <svg className="game-over-crown" viewBox="0 0 32 20" aria-hidden>
      <path d="M2 18 L4 5 L11 11 L16 2 L21 11 L28 5 L30 18 Z" />
      <circle cx="4" cy="5" r="2" />
      <circle cx="16" cy="2" r="2" />
      <circle cx="28" cy="5" r="2" />
    </svg>
  );
}

const CONFETTI_COLORS = ["var(--gold)", "var(--accent)", "var(--good)", "var(--blue)", "var(--card-face)", "var(--brand-3)"];

/** A short shower of paper, for a win. */
function Confetti() {
  const pieces = useRef(
    Array.from({ length: 70 }, (_, i) => ({
      left: Math.random() * 100,
      delay: Math.random() * 0.6,
      duration: 1.8 + Math.random() * 1.4,
      drift: (Math.random() - 0.5) * 160,
      spin: (Math.random() - 0.5) * 900,
      color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
      wide: Math.random() < 0.5,
    })),
  ).current;
  return (
    <div className="confetti" aria-hidden>
      {pieces.map((p, i) => (
        <i
          key={i}
          className={p.wide ? "wide" : undefined}
          style={
            {
              left: `${p.left}%`,
              background: p.color,
              animationDelay: `${p.delay}s`,
              animationDuration: `${p.duration}s`,
              "--drift": `${p.drift}px`,
              "--spin": `${p.spin}deg`,
            } as CSSProperties
          }
        />
      ))}
    </div>
  );
}
