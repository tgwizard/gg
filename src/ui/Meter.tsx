/** A segmented bar. `value` in [0, 1]; it empties a whole segment at a time. */
export function Meter({ value, segments = 12, low, label }: { value: number; segments?: number; low?: boolean; label?: string }) {
  const filled = Math.ceil(Math.max(0, Math.min(1, value)) * segments) / segments;
  return (
    <div className="meter" role="meter" aria-valuemin={0} aria-valuemax={1} aria-valuenow={value} aria-label={label}>
      <div className={`meter-fill ${low ? "low" : ""}`} style={{ width: `${filled * 100}%` }} />
    </div>
  );
}
