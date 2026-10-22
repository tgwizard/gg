import { Meter } from "../../../ui";

/** A turn clock that runs down. Renders nothing without a deadline. */
export function TurnTimer({ deadline, totalMs, serverNow }: { deadline: number | null; totalMs: number; serverNow: number }) {
  if (deadline === null || totalMs <= 0) return null;
  const left = Math.max(0, Math.min(1, (deadline - serverNow) / totalMs));
  return <Meter value={left} low={left < 0.25} label={`${Math.max(0, Math.ceil((deadline - serverNow) / 1000))} seconds left`} />;
}
