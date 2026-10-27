import { useState } from "react";
import { Button, busyWhy } from "../../../ui";
import type { GameSetupProps } from "../../ui";
import type { UnicornConfig } from "../engine";

const RAINBOWS: { label: string; at: number }[] = [
  { label: "Often", at: 12 },
  { label: "Now and then", at: 20 },
  { label: "Rarely", at: 30 },
];

export function UnicornSetup({ busy, disabled, onStart }: GameSetupProps<UnicornConfig>) {
  const [rainbowAt, setRainbowAt] = useState(20);
  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        onStart({ rainbowAt });
      }}
    >
      <p className="muted" style={{ margin: 0 }}>
        Roll the die and gallop round the meadow, picking up friends. First with all six wins. Every roll charges the rainbow, and when
        it's full the kids get a rainbow roll.
      </p>
      <div className="field">
        <span>
          Rainbow rolls for kids <span className="hint">every roll adds its number; full at {rainbowAt}</span>
        </span>
        <div className="row" role="group" aria-label="Rainbow rolls for kids">
          {RAINBOWS.map((r) => (
            <button key={r.at} type="button" className={`btn small ${r.at === rainbowAt ? "primary" : ""}`} aria-pressed={r.at === rainbowAt} onClick={() => setRainbowAt(r.at)}>
              {r.label}
            </button>
          ))}
        </div>
      </div>
      <Button className="btn primary" why={busy ? "Opening it…" : busyWhy({ connected: !disabled })}>
        {busy ? "Opening…" : "Open the meadow"}
      </Button>
    </form>
  );
}
