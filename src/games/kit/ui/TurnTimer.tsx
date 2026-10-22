import { Meter } from "../../../ui";

/** A turn clock that empties block by block. Renders nothing without a deadline. */
export function TurnTimer({ deadline, totalMs, serverNow }: { deadline: number | null; totalMs: number; serverNow: number }) {
  if (deadline === null || totalMs <= 0) return null;
  const left = Math.max(0, Math.min(1, (deadline - serverNow) / totalMs));
  return <Meter value={left} segments={10} low={left < 0.25} label={`${Math.max(0, Math.ceil((deadline - serverNow) / 1000))} seconds left`} />;
}
