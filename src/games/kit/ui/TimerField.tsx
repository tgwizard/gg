import { useEffect, useId, useState } from "react";
import "./kit.css";

/**
 * A game's timer in its set-up: seconds, with a plain "Disable timer" next to it (0 is
 * off). Once it's off the button looks spent, and pressing it again just says so.
 */
export function TimerField({
  label = "Turn timer",
  value,
  onChange,
  hint,
}: {
  label?: string;
  value: number;
  onChange(seconds: number): void;
  /** What happens when it runs out. */
  hint?: string;
}) {
  const id = useId();
  const [told, setTold] = useState(false);
  useEffect(() => {
    if (!told) return;
    const t = setTimeout(() => setTold(false), 2000);
    return () => clearTimeout(t);
  }, [told]);
  const off = value === 0;
  return (
    <div className="field timer-field">
      <label htmlFor={id}>
        {label} <span className="hint">{off ? "off: no time limit" : hint}</span>
      </label>
      <div className="timer-field-row">
        <input
          id={id}
          type="number"
          min={0}
          value={value}
          onChange={(e) => {
            setTold(false);
            onChange(Math.max(0, Math.floor(Number(e.target.value) || 0)));
          }}
        />
        <span className="timer-field-unit">seconds</span>
        <button type="button" className={`btn small ${off ? "spent" : ""}`} aria-pressed={off} onClick={() => (off ? setTold(true) : onChange(0))}>
          Disable timer
        </button>
        {told && (
          <div className="bubble bubble-quiet" role="status">
            Timer already disabled
          </div>
        )}
      </div>
    </div>
  );
}
