import { useEffect, useState } from "react";

/** Re-render every `intervalMs` (when non-null) and return the current server time. */
export function useServerNow(clockOffset: number, intervalMs: number | null): number {
  const [now, setNow] = useState(() => Date.now() + clockOffset);
  useEffect(() => {
    setNow(Date.now() + clockOffset);
    if (intervalMs === null) return;
    const t = setInterval(() => setNow(Date.now() + clockOffset), intervalMs);
    return () => clearInterval(t);
  }, [clockOffset, intervalMs]);
  return now;
}
