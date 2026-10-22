/** A rounded bar. `value` in [0, 1]. */
export function Meter({ value, low, label }: { value: number; low?: boolean; label?: string }) {
  const v = Math.max(0, Math.min(1, value));
  return (
    <div className="meter" role="meter" aria-valuemin={0} aria-valuemax={1} aria-valuenow={v} aria-label={label}>
      <div className={`meter-fill ${low ? "low" : ""}`} style={{ width: `${v * 100}%` }} />
    </div>
  );
}
