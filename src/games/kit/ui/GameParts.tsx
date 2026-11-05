import type { ReactNode } from "react";
import "./kit.css";

/**
 * "What just happened", announced in a strip under the table. With `onClick` it's a
 * button (Coast to Coast opens its history from it).
 */
export function Herald({ children, testId, big, className, onClick, label }: { children: ReactNode; testId?: string; big?: boolean; className?: string; onClick?(): void; label?: string }) {
  const classes = `herald ${big ? "big" : ""} ${className ?? ""}`;
  const text = (
    <div className="herald-text" aria-live="polite">
      {children}
    </div>
  );
  return onClick ? (
    <button type="button" className={`${classes} herald-button`} onClick={onClick} aria-label={label} data-testid={testId}>
      {text}
    </button>
  ) : (
    <div className={classes} data-testid={testId}>
      {text}
    </div>
  );
}

/**
 * Your controls, under the table: the main actions, and seat housekeeping to the side.
 * `pinned` while your move is made in here: on a phone it then stays in sight at the
 * bottom of the screen, rather than below the table where you'd have to go looking.
 */
export function ActionTray({ children, aside, testId, pinned, className }: { children?: ReactNode; aside?: ReactNode; testId?: string; pinned?: boolean; className?: string }) {
  return (
    <div className={`action-tray box on-brand${pinned ? " pinned" : ""}${className ? ` ${className}` : ""}`} data-testid={testId}>
      <div className="action-tray-main">{children}</div>
      {aside && <div className="action-tray-aside">{aside}</div>}
    </div>
  );
}

/** Under the tray: the history on the left, and quiet seat housekeeping (step away, leave) on the right. */
export function TableFooter({ log, actions }: { log?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="table-footer">
      <div className="table-footer-log">{log}</div>
      {actions && <div className="table-footer-actions">{actions}</div>}
    </div>
  );
}

/** A collapsible history; controlled when `open` is given. `footer` goes under the list (a "Load more"). */
export function GameLog({ title, children, open, onToggle, footer }: { title: string; children: ReactNode; open?: boolean; onToggle?(open: boolean): void; footer?: ReactNode }) {
  return (
    <details className="log game-log" open={open} onToggle={onToggle && ((e) => onToggle(e.currentTarget.open))}>
      <summary>{title}</summary>
      <ol>{children}</ol>
      {footer && <div className="game-log-footer">{footer}</div>}
    </details>
  );
}
