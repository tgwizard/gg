import { useState } from "react";
import type { GameSetupProps } from "../../ui";
import type { TttConfig } from "../index";

export function TicTacToeSetup({ busy, disabled, onStart }: GameSetupProps<TttConfig>) {
  const [turnSeconds, setTurnSeconds] = useState(30);
  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        onStart({ turnSeconds });
      }}
    >
      <label className="field">
        <span>
          Turn timer <span className="hint">seconds, 0 = off</span>
        </span>
        <input type="number" min={0} value={turnSeconds} onChange={(e) => setTurnSeconds(Math.max(0, Math.floor(Number(e.target.value) || 0)))} />
      </label>
      <button className="btn primary" disabled={busy || disabled}>
        {busy ? "Starting…" : "Start tic-tac-toe"}
      </button>
    </form>
  );
}
