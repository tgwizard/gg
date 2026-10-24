/** A rounded bar. `value` in [0, 1]. `pulse`: a timer running out, flashing (faster when racing). */
export function Meter({ value, low, label, pulse }: { value: number; low?: boolean; label?: string; pulse?: "urgent" | "racing" | null }) {
  const v = Math.max(0, Math.min(1, value));
  return (
    <div className={`meter ${pulse ? `pulse ${pulse}` : ""}`} role="meter" aria-valuemin={0} aria-valuemax={1} aria-valuenow={v} aria-label={label}>
      <div className={`meter-fill ${low ? "low" : ""}`} style={{ width: `${v * 100}%` }} />
    </div>
  );
}
