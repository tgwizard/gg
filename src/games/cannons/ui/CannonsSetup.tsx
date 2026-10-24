import { useState } from "react";
import type { GameSetupProps } from "../../ui";
import { TimerField } from "../../kit/ui/TimerField";
import { type CannonsConfig, WIND_MAX } from "../engine";
import "./cannons.css";

const TERRAIN: { value: CannonsConfig["terrain"]; label: string }[] = [
  { value: "gentle", label: "Gentle" },
  { value: "hilly", label: "Hilly" },
  { value: "mountains", label: "Mountains" },
];
const WIND: { value: CannonsConfig["wind"]; label: string }[] = [
  { value: "none", label: "No wind" },
  { value: "light", label: "Light" },
  { value: "strong", label: "Strong" },
];

export function CannonsSetup({ busy, disabled, onStart }: GameSetupProps<CannonsConfig>) {
  const [config, setConfig] = useState<CannonsConfig>({ players: 2, terrain: "hilly", wind: "light", turnSeconds: 45 });
  const choices = <K extends "players" | "terrain" | "wind">(key: K, label: string, options: { value: CannonsConfig[K]; label: string }[]) => (
    <div className="cn-setup-row">
      <span className="label">{label}</span>
      <div className="cn-presets" role="group" aria-label={label}>
        {options.map((o) => (
          <button
            key={String(o.value)}
            type="button"
            className={`btn small ${config[key] === o.value ? "primary" : ""}`}
            aria-pressed={config[key] === o.value}
            onClick={() => setConfig({ ...config, [key]: o.value })}
          >
            {o.label}
          </button>
        ))}
      </div>
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
        Each player is a cannon on a hilly field. Set your angle and power, mind the wind, and fire: one hit knocks a cannon out. A new field every game.
      </p>
      {choices("players", "Players", [
        { value: 2, label: "Two" },
        { value: 3, label: "Three" },
        { value: 4, label: "Four" },
      ])}
      {choices("terrain", "Landscape", TERRAIN)}
      {choices("wind", `Wind (up to ${WIND_MAX[config.wind]} either way)`, WIND)}
      <TimerField value={config.turnSeconds} onChange={(turnSeconds) => setConfig({ ...config, turnSeconds })} hint="run out and your last aim is fired" />
      <button className="btn primary" disabled={busy || disabled}>
        {busy ? "Starting…" : "Start Cannons"}
      </button>
    </form>
  );
}
