import { useState } from "react";
import { Button, busyWhy } from "../../../ui";
import type { GameSetupProps } from "../../ui";
import type { ChessConfig } from "../engine";
import "./chess.css";

const PRESETS: { label: string; minutes: number; increment: number }[] = [
  { label: "Blitz 3+2", minutes: 3, increment: 2 },
  { label: "Blitz 5+3", minutes: 5, increment: 3 },
  { label: "Rapid 10+5", minutes: 10, increment: 5 },
  { label: "Rapid 15+10", minutes: 15, increment: 10 },
  { label: "Classical 30+20", minutes: 30, increment: 20 },
  { label: "No clock", minutes: 0, increment: 0 },
];

export function ChessSetup({ busy, connected, onStart }: GameSetupProps<ChessConfig>) {
  const [config, setConfig] = useState<ChessConfig>({ minutes: 10, increment: 5 });
  const number = (key: keyof ChessConfig, label: string, hint: string) => (
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
        Two players, chess clocks, and colors that swap every game.
      </p>
      <div className="chess-presets" role="group" aria-label="Time control">
        {PRESETS.map((p) => {
          const on = p.minutes === config.minutes && p.increment === config.increment;
          return (
            <button key={p.label} type="button" className={`btn small ${on ? "primary" : ""}`} aria-pressed={on} onClick={() => setConfig({ minutes: p.minutes, increment: p.increment })}>
              {p.label}
            </button>
          );
        })}
      </div>
      <div className="chess-setup-fields">
        {number("minutes", "Minutes each", "0 = no clock")}
        {number("increment", "Seconds per move", "added after each move")}
      </div>
      <Button className="btn primary" why={busy ? "Starting it…" : busyWhy({ connected })}>
        {busy ? "Starting…" : "Start chess"}
      </Button>
    </form>
  );
}
