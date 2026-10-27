import { useState } from "react";
import { Button, busyWhy } from "../../../ui";
import type { GameSetupProps } from "../../ui";
import { TimerField } from "../../kit/ui/TimerField";
import type { PokerConfig } from "../engine";

export function PokerSetup({ busy, connected, onStart }: GameSetupProps<PokerConfig>) {
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
      </div>
      <TimerField value={config.turnSeconds} onChange={(turnSeconds) => setConfig({ ...config, turnSeconds })} hint="run out and you check, or fold" />
      <Button className="btn primary" why={busy ? "Opening it…" : busyWhy({ connected })}>
        {busy ? "Starting…" : "Open the table"}
      </Button>
    </form>
  );
}
