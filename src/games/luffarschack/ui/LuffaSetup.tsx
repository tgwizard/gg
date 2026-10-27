import { useState } from "react";
import { TimerField } from "../../kit/ui/TimerField";
import { Button, busyWhy } from "../../../ui";
import type { GameSetupProps } from "../../ui";
import type { LuffaConfig } from "../engine";
import { SIZES, type SizeName } from "../rules";
import "./luffarschack.css";

const SIZE_LABELS: Record<SizeName, string> = { "15": "Small 15×15", "19": "Medium 19×19", "25": "Large 25×25" };

export function LuffaSetup({ busy, connected, onStart }: GameSetupProps<LuffaConfig>) {
  const [config, setConfig] = useState<LuffaConfig>({ size: "19", turnSeconds: 60 });
  const choices = <T extends string>(label: string, options: { value: T; label: string }[], value: T, set: (v: T) => void) => (
    <div className="lfs-choices" role="group" aria-label={label}>
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
        Two players, crosses and circles inked in your own colors. Five (or more) in a row wins.
      </p>
      {choices(
        "Sheet size",
        SIZES.map((s) => ({ value: s, label: SIZE_LABELS[s] })),
        config.size,
        (size) => setConfig({ ...config, size }),
      )}
      <TimerField value={config.turnSeconds} onChange={(turnSeconds) => setConfig({ ...config, turnSeconds })} hint="for each mark: run out and you lose" />
      <Button className="btn primary" why={busy ? "Starting it…" : busyWhy({ connected })}>
        {busy ? "Starting…" : "Start Luffarschack"}
      </Button>
    </form>
  );
}
