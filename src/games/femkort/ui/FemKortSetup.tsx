import { useState } from "react";
import type { GameSetupProps } from "../../ui";
import { TimerField } from "../../kit/ui/TimerField";
import type { FemConfig } from "../engine";
import "./femkort.css";

export function FemKortSetup({ busy, disabled, onStart }: GameSetupProps<FemConfig>) {
  const [config, setConfig] = useState<FemConfig>({ turnSeconds: 30, dealsToWin: 3, mustBeat: false, twoInARow: false, betterCards: false });
  const check = (key: "mustBeat" | "twoInARow" | "betterCards", label: string, hint: string) => (
    <label className="fem-check">
      <input type="checkbox" checked={config[key]} onChange={(e) => setConfig({ ...config, [key]: e.target.checked })} />
      <span>
        {label} <span className="muted">{hint}</span>
      </span>
    </label>
  );
  return (
    <form
      className="fem-setup"
      onSubmit={(e) => {
        e.preventDefault();
        onStart(config);
      }}
    >
      <p className="muted">
        Five cards each and five tricks, but only the last one counts: take it and you win the deal. Two to six can play.
      </p>
      <div className="fem-setup-row">
        <span className="label">
          Deals to win <span className="hint">first to this many wins the game</span>
        </span>
        <div className="fem-presets" role="group" aria-label="Deals to win">
          {[1, 2, 3, 4, 5, 7].map((n) => (
            <button
              key={n}
              type="button"
              className={`btn small ${config.dealsToWin === n ? "primary" : ""}`}
              aria-pressed={config.dealsToWin === n}
              onClick={() => setConfig({ ...config, dealsToWin: n })}
            >
              {n}
            </button>
          ))}
        </div>
      </div>
      <TimerField value={config.turnSeconds} onChange={(turnSeconds) => setConfig({ ...config, turnSeconds })} hint="run out and your cards are played for you" />
      {check("mustBeat", "Överstick", "You must beat the best card of the suit led if you can. Off: the older rule, just follow suit.")}
      {check("twoInARow", "Two in a row wins", "Winning two deals running also wins the game.")}
      {check("betterCards", "Bättre kort", "Once a deal, the player on lead may ask for new cards; if everyone agrees, they're dealt again.")}
      <button className="btn primary" disabled={busy || disabled}>
        {busy ? "Opening…" : "Open the table"}
      </button>
    </form>
  );
}
