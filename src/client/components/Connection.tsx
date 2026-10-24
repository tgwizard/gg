import { useRef } from "react";
import { formatTime } from "../format";
import type { RoomClient, RoomSnapshot } from "../net/RoomClient";
import { useServerNow } from "../useNow";
import { Popover, usePeek } from "./Profile";

const LABELS: Record<RoomSnapshot["status"], string> = {
  connecting: "Connecting",
  connected: "Connected",
  reconnecting: "Reconnecting",
  offline: "Offline",
  not_found: "Not found",
  outdated: "Outdated",
  replaced: "Open elsewhere",
  left: "Left",
};

const LIGHTS: Record<RoomSnapshot["status"], string> = {
  connecting: "warn",
  connected: "good",
  reconnecting: "warn",
  offline: "bad",
  not_found: "bad",
  outdated: "bad",
  replaced: "bad",
  left: "bad",
};

/** A status light; hover or click it for how the connection is doing. */
export function ConnectionDot({ snapshot, client }: { snapshot: RoomSnapshot; client: RoomClient }) {
  const peek = usePeek();
  const button = useRef<HTMLButtonElement>(null);
  const label = LABELS[snapshot.status];
  return (
    <>
      <button
        ref={button}
        type="button"
        className={`connection-dot status-${snapshot.status}`}
        onClick={peek.toggle}
        aria-expanded={peek.open}
        aria-label={`Connection: ${label}`}
        {...peek.hover}
      >
        <span className={`light ${LIGHTS[snapshot.status]}`} aria-hidden />
        <span className="visually-hidden" role="status" data-testid="connection-status">
          {label}
        </span>
      </button>
      {peek.open && button.current && (
        <Popover anchor={button.current} label="Connection" onClose={peek.close} hover={peek.hover} className="peek-pop">
          <ConnectionDetails snapshot={snapshot} client={client} />
        </Popover>
      )}
    </>
  );
}

function ConnectionDetails({ snapshot, client }: { snapshot: RoomSnapshot; client: RoomClient }) {
  const now = useServerNow(0, 1000);
  const stats = client.stats();
  const retryIn = snapshot.nextRetryAt ? Math.max(0, Math.ceil((snapshot.nextRetryAt - now) / 1000)) : null;
  return (
    <div className="peek">
      <h3 className="peek-title">
        <span className={`light ${LIGHTS[snapshot.status]}`} aria-hidden />
        {LABELS[snapshot.status]}
      </h3>
      <dl className="peek-facts">
        {stats.latencyMs !== null && (
          <>
            <dt>Latency</dt>
            <dd>{stats.latencyMs} ms</dd>
          </>
        )}
        {stats.connectedAt !== null && (
          <>
            <dt>Connected</dt>
            <dd>
              since {formatTime(stats.connectedAt)} <span className="muted">({ago(now - stats.connectedAt)})</span>
            </dd>
          </>
        )}
        {stats.lastHeardAt !== null && (
          <>
            <dt>Last heard</dt>
            <dd>{ago(now - stats.lastHeardAt)} ago</dd>
          </>
        )}
        {retryIn !== null && (
          <>
            <dt>Retrying</dt>
            <dd>{retryIn > 0 ? `in ${retryIn} s (attempt ${snapshot.attempt})` : "now"}</dd>
          </>
        )}
        <dt>Reconnects</dt>
        <dd>{stats.reconnects}</dd>
      </dl>
      <p className="muted small">
        Checked every {stats.heartbeatEveryMs / 1000} s. If it drops, gg reconnects on its own and catches up on what you missed.
      </p>
    </div>
  );
}

/** "4 s", "12 min", "3 h". */
function ago(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${Math.floor(s / 60)} min`;
  return `${Math.floor(s / 3600)} h`;
}

export function ConnectionBanner({ snapshot, onRetry }: { snapshot: RoomSnapshot; onRetry(): void }) {
  const now = useServerNow(0, snapshot.nextRetryAt ? 500 : null);
  const secs = snapshot.nextRetryAt ? Math.max(0, Math.ceil((snapshot.nextRetryAt - now) / 1000)) : null;
  const offline = snapshot.status === "offline";
  // When the server asked us to back off, "Retry now" would only be refused again.
  const limited = snapshot.notice !== null;
  return (
    <div className={`banner ${offline ? "bad" : ""}`} role="alert">
      <span>
        {limited ? snapshot.notice : offline ? "You're offline." : "Connection lost."}{" "}
        {secs !== null && secs > 0 ? `Retrying in ${secs}s…` : "Reconnecting…"}{" "}
        <span className="muted">Messages you send will be delivered when you're back.</span>
      </span>
      {!limited && (
        <button className="btn small subtle" onClick={onRetry}>
          Retry now
        </button>
      )}
    </div>
  );
}
