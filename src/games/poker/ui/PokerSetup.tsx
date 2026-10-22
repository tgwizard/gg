import { useState } from "react";
import type { GameSetupProps } from "../../ui";
import type { PokerConfig } from "../engine";

export function PokerSetup({ busy, disabled, onStart }: GameSetupProps<PokerConfig>) {
  const [config, setConfig] = useState<PokerConfig>({ startingStack: 1000, smallBlind: 5, bigBlind: 10, turnSeconds: 60 });
  const field = (key: keyof PokerConfig, label: string, hint?: string) => (
    <label className="field">
      <span>
        {label} {hint && <span className="hint">{hint}</span>}
      </span>
      <input
        type="number"
        min={0}
        value={config[key]}
        onChange={(e) => setConfig({ ...config, [key]: Math.max(0, Math.floor(Number(e.target.value) || 0)) })}
      />
    </label>
  );
  return (
    <form
      className="poker-setup"
      onSubmit={(e) => {
        e.preventDefault();
        onStart(config);
      }}
    >
      <div className="setup-fields">
        {field("startingStack", "Starting chips")}
        {field("smallBlind", "Small blind")}
        {field("bigBlind", "Big blind")}
        {field("turnSeconds", "Turn timer", "seconds, 0 = off")}
      </div>
      <button className="btn primary" disabled={busy || disabled}>
        {busy ? "Starting…" : "Open the table"}
      </button>
    </form>
  );
}
