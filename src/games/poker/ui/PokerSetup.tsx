import { useState } from "react";
import { Button, busyWhy } from "../../../ui";
import type { GameSetupProps } from "../../ui";
import { TimerField } from "../../kit/ui/TimerField";
import { BLIND_LEVELS, type PokerConfig } from "../engine";

type Config = Required<PokerConfig>;
type NumberKey = { [K in keyof Config]: Config[K] extends number ? K : never }[keyof Config];

export function PokerSetup({ busy, connected, onStart }: GameSetupProps<PokerConfig>) {
  const [config, setConfig] = useState<Config>({ startingStack: 1000, smallBlind: 5, bigBlind: 10, turnSeconds: 60, blindsUpEvery: 0, rebuys: true });
  const field = (key: NumberKey, label: string, hint?: string) => (
    <label className="field">
      <span>
        {label} {hint && <span className="hint">{hint}</span>}
      </span>
      <input
        type="number"
        inputMode="numeric"
        min={0}
        value={config[key]}
        onChange={(e) => setConfig({ ...config, [key]: Math.max(0, Math.floor(Number(e.target.value) || 0)) })}
      />
    </label>
  );
  const levels = BLIND_LEVELS.slice(1, 4).map((m) => `${config.smallBlind * m}/${config.bigBlind * m}`);
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
        {field("blindsUpEvery", "Blinds go up every", config.blindsUpEvery ? "hands" : "0: never")}
      </div>
      {config.blindsUpEvery > 0 && (
        <p className="muted small">
          Every {config.blindsUpEvery} hands: {levels.join(", ")}, and so on, doubling every two levels.
        </p>
      )}
      <label className="poker-check">
        <input type="checkbox" checked={config.rebuys} onChange={(e) => setConfig({ ...config, rebuys: e.target.checked })} />
        <span>
          Rebuys <span className="muted">{config.rebuys ? "when you're out of chips, for the starting chips again" : "off: once you're out, you're out"}</span>
        </span>
      </label>
      <TimerField value={config.turnSeconds} onChange={(turnSeconds) => setConfig({ ...config, turnSeconds })} hint="run out and you check, or fold" />
      <Button className="btn primary" why={busy ? "Opening it…" : busyWhy({ connected })}>
        {busy ? "Starting…" : "Open the table"}
      </Button>
    </form>
  );
}
