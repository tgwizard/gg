import type { ReactNode } from "react";
import "./kit.css";

/** "What just happened", announced in a strip under the table. */
export function Herald({ children, testId, big }: { children: ReactNode; testId?: string; big?: boolean }) {
  return (
    <div className={`herald ${big ? "big" : ""}`} aria-live="polite" data-testid={testId}>
      <div className="herald-text">{children}</div>
    </div>
  );
}

/** Your controls, under the table: the main actions, and seat housekeeping to the side. */
export function ActionTray({ children, aside, testId }: { children?: ReactNode; aside?: ReactNode; testId?: string }) {
  return (
    <div className="action-tray box on-brand" data-testid={testId}>
      <div className="action-tray-main">{children}</div>
      {aside && <div className="action-tray-aside">{aside}</div>}
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
