import { useState } from "react";
import type { GameSetupProps } from "../../ui";
import type { FourConfig } from "../engine";
import { SIZES, type SizeName } from "../rules";
import "./fourinarow.css";

const SIZE_LABELS: Record<SizeName, string> = { "7x6": "7×6 classic", "8x7": "8×7", "9x7": "9×7" };

const PRESETS: { label: string; minutes: number; increment: number }[] = [
  { label: "Quick 1+2", minutes: 1, increment: 2 },
  { label: "3+3", minutes: 3, increment: 3 },
  { label: "5+5", minutes: 5, increment: 5 },
  { label: "No clock", minutes: 0, increment: 0 },
];

const OPENERS: { value: FourConfig["opener"]; label: string }[] = [
  { value: "alternate", label: "Take turns starting" },
  { value: "loser", label: "Loser starts" },
];

export function FourSetup({ busy, disabled, onStart }: GameSetupProps<FourConfig>) {
  const [config, setConfig] = useState<FourConfig>({ board: "7x6", opener: "alternate", minutes: 3, increment: 3 });
  const number = (key: "minutes" | "increment", label: string, hint: string) => (
    <label className="field">
      <span>
        {label} <span className="hint">{hint}</span>
      </span>
      <input type="number" min={0} value={config[key]} onChange={(e) => setConfig({ ...config, [key]: Math.max(0, Math.floor(Number(e.target.value) || 0)) })} />
    </label>
  );
  const choices = <T extends string>(label: string, options: { value: T; label: string }[], value: T, set: (v: T) => void) => (
    <div className="fiar-presets" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" className={`btn small ${o.value === value ? "primary" : ""}`} aria-pressed={o.value === value} onClick={() => set(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
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
        Two players, discs in your own colors. 7×6 is the classic board; the bigger ones make longer games.
      </p>
      {choices(
        "Board",
        SIZES.map((s) => ({ value: s, label: SIZE_LABELS[s] })),
        config.board,
        (board) => setConfig({ ...config, board }),
      )}
      {choices("Who starts", OPENERS, config.opener, (opener) => setConfig({ ...config, opener }))}
      <div className="fiar-presets" role="group" aria-label="Time control">
        {PRESETS.map((p) => {
          const on = p.minutes === config.minutes && p.increment === config.increment;
          return (
            <button key={p.label} type="button" className={`btn small ${on ? "primary" : ""}`} aria-pressed={on} onClick={() => setConfig({ ...config, minutes: p.minutes, increment: p.increment })}>
              {p.label}
            </button>
          );
        })}
      </div>
      <div className="fiar-setup-fields">
        {number("minutes", "Minutes each", "0 = no clock")}
        {number("increment", "Seconds per move", "added after each move")}
      </div>
      <button className="btn primary" disabled={busy || disabled}>
        {busy ? "Starting…" : "Start Four in a Row"}
      </button>
    </form>
  );
}
