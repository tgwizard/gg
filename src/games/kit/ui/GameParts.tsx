import type { ReactNode } from "react";
import "./kit.css";

/** "What just happened", announced in a strip under the table. */
export function Herald({ children, testId, big, className }: { children: ReactNode; testId?: string; big?: boolean; className?: string }) {
  return (
    <div className={`herald ${big ? "big" : ""} ${className ?? ""}`} aria-live="polite" data-testid={testId}>
      <div className="herald-text">{children}</div>
    </div>
  );
}

/**
 * Your controls, under the table: the main actions, and seat housekeeping to the side.
 * `pinned` while your move is made in here: on a phone it then stays in sight at the
 * bottom of the screen, rather than below the table where you'd have to go looking.
 */
export function ActionTray({ children, aside, testId, pinned }: { children?: ReactNode; aside?: ReactNode; testId?: string; pinned?: boolean }) {
  return (
    <div className={`action-tray box on-brand${pinned ? " pinned" : ""}`} data-testid={testId}>
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

/** A collapsible history. */
export function GameLog({ title, children }: { title: string; children: ReactNode }) {
  return (
    <details className="log game-log">
      <summary>{title}</summary>
      <ol>{children}</ol>
    </details>
  );
}
