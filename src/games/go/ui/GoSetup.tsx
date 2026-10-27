import { useState } from "react";
import { Button, busyWhy } from "../../../ui";
import type { GameSetupProps } from "../../ui";
import type { GoConfig } from "../engine";
import { SIZES, type Size } from "../rules";
import "./go.css";

type Clock = Pick<GoConfig, "minutes" | "periods" | "seconds">;

/** Clocks that suit each board: a game on 19×19 is long. */
const PRESETS: Record<Size, { label: string; clock: Clock }[]> = {
  9: [
    { label: "Quick 2 min + 3×10s", clock: { minutes: 2, periods: 3, seconds: 10 } },
    { label: "5 min + 3×20s", clock: { minutes: 5, periods: 3, seconds: 20 } },
    { label: "10 min + 5×30s", clock: { minutes: 10, periods: 5, seconds: 30 } },
  ],
  13: [
    { label: "Quick 5 min + 3×20s", clock: { minutes: 5, periods: 3, seconds: 20 } },
    { label: "10 min + 3×30s", clock: { minutes: 10, periods: 3, seconds: 30 } },
    { label: "20 min + 5×30s", clock: { minutes: 20, periods: 5, seconds: 30 } },
  ],
  19: [
    { label: "Quick 10 min + 3×30s", clock: { minutes: 10, periods: 3, seconds: 30 } },
    { label: "20 min + 5×30s", clock: { minutes: 20, periods: 5, seconds: 30 } },
    { label: "40 min + 5×30s", clock: { minutes: 40, periods: 5, seconds: 30 } },
  ],
};
const NO_CLOCK: Clock = { minutes: 0, periods: 0, seconds: 0 };
const same = (a: Clock, b: Clock) => a.minutes === b.minutes && a.periods === b.periods && a.seconds === b.seconds;

export function GoSetup({ busy, connected, onStart }: GameSetupProps<GoConfig>) {
  const [config, setConfig] = useState<GoConfig>({ size: 9, ...PRESETS[9][1]!.clock });
  const number = (key: keyof Clock, label: string, hint: string) => (
    <label className="field">
      <span>
        {label} <span className="hint">{hint}</span>
      </span>
      <input type="number" min={0} value={config[key]} onChange={(e) => setConfig({ ...config, [key]: Math.max(0, Math.floor(Number(e.target.value) || 0)) })} />
    </label>
  );
  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        onStart(config);
      }}
    >
      <p className="muted" style={{ margin: 0 }}>
        Two players, byo-yomi clocks, and colors that swap every game. 9×9 is quick to learn; 19×19 is the full game.
      </p>
      <div className="go-presets" role="group" aria-label="Board size">
        {SIZES.map((size) => (
          <button
            key={size}
            type="button"
            className={`btn small ${config.size === size ? "primary" : ""}`}
            aria-pressed={config.size === size}
            onClick={() => setConfig({ size, ...PRESETS[size][1]!.clock })}
          >
            {size}×{size}
          </button>
        ))}
      </div>
      <div className="go-presets" role="group" aria-label="Time control">
        {[...PRESETS[config.size], { label: "No clock", clock: NO_CLOCK }].map((p) => {
          const on = same(p.clock, config);
          return (
            <button key={p.label} type="button" className={`btn small ${on ? "primary" : ""}`} aria-pressed={on} onClick={() => setConfig({ size: config.size, ...p.clock })}>
              {p.label}
            </button>
          );
        })}
      </div>
      <div className="go-setup-fields">
        {number("minutes", "Main time", "minutes each")}
        {number("periods", "Periods", "after main time")}
        {number("seconds", "Seconds", "per period")}
      </div>
      <Button className="btn primary" why={busy ? "Starting it…" : busyWhy({ connected })}>
        {busy ? "Starting…" : "Start Go"}
      </Button>
    </form>
  );
}
