import type { RoomSnapshot } from "../net/RoomClient";
import { useServerNow } from "../useNow";

const LABELS: Record<RoomSnapshot["status"], string> = {
  connecting: "Connecting",
  connected: "Connected",
  reconnecting: "Reconnecting",
  offline: "Offline",
  not_found: "Not found",
  outdated: "Outdated",
  replaced: "Open elsewhere",
};

export function ConnectionPill({ snapshot }: { snapshot: RoomSnapshot }) {
  return (
    <span className={`pill status-${snapshot.status}`} role="status" data-testid="connection-status">
      <span className="dot" />
      {LABELS[snapshot.status]}
    </span>
  );
}

export function ConnectionBanner({ snapshot, onRetry }: { snapshot: RoomSnapshot; onRetry(): void }) {
  const now = useServerNow(0, snapshot.nextRetryAt ? 500 : null);
  const secs = snapshot.nextRetryAt ? Math.max(0, Math.ceil((snapshot.nextRetryAt - now) / 1000)) : null;
  const offline = snapshot.status === "offline";
  // When the server asked us to back off, "Retry now" would only be refused again.
  const limited = snapshot.notice !== null;
  return (
    <div className={`banner ${offline ? "banner-bad" : "banner-warn"}`} role="alert">
      <span>
        {limited ? snapshot.notice : offline ? "You're offline." : "Connection lost."}{" "}
        {secs !== null && secs > 0 ? `Retrying in ${secs}s…` : "Reconnecting…"}{" "}
        <span className="muted">Messages you send will be delivered when you're back.</span>
      </span>
      {!limited && (
        <button className="btn small" onClick={onRetry}>
          Retry now
        </button>
      )}
    </div>
  );
}
