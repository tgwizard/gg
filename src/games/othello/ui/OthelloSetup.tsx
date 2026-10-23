import { useState } from "react";
import type { GameSetupProps } from "../../ui";
import type { OthelloConfig } from "../engine";
import "./othello.css";

const PRESETS: { label: string; minutes: number; increment: number }[] = [
  { label: "Quick 3+2", minutes: 3, increment: 2 },
  { label: "5+5", minutes: 5, increment: 5 },
  { label: "10+10", minutes: 10, increment: 10 },
  { label: "No clock", minutes: 0, increment: 0 },
];

export function OthelloSetup({ busy, disabled, onStart }: GameSetupProps<OthelloConfig>) {
  const [config, setConfig] = useState<OthelloConfig>({ minutes: 5, increment: 5 });
  const number = (key: keyof OthelloConfig, label: string, hint: string) => (
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
        Two players, a clock each, and colors that swap every game.
      </p>
      <div className="oth-presets" role="group" aria-label="Time control">
        {PRESETS.map((p) => {
          const on = p.minutes === config.minutes && p.increment === config.increment;
          return (
            <button key={p.label} type="button" className={`btn small ${on ? "primary" : ""}`} aria-pressed={on} onClick={() => setConfig({ minutes: p.minutes, increment: p.increment })}>
              {p.label}
            </button>
          );
        })}
      </div>
      <div className="oth-setup-fields">
        {number("minutes", "Minutes each", "0 = no clock")}
        {number("increment", "Seconds per move", "added after each move")}
      </div>
      <button className="btn primary" disabled={busy || disabled}>
        {busy ? "Starting…" : "Start Othello"}
      </button>
    </form>
  );
}
