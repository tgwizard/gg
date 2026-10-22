import "./kit.css";

/** A shrinking bar for a turn clock. Renders nothing without a deadline. */
export function TurnTimer({ deadline, totalMs, serverNow }: { deadline: number | null; totalMs: number; serverNow: number }) {
  if (deadline === null || totalMs <= 0) return null;
  const left = Math.max(0, Math.min(1, (deadline - serverNow) / totalMs));
  return (
    <div className="turn-timer" role="timer" aria-label={`${Math.ceil((deadline - serverNow) / 1000)} seconds left`}>
      <div className={`turn-timer-fill ${left < 0.25 ? "low" : ""}`} style={{ width: `${left * 100}%` }} />
    </div>
  );
}
