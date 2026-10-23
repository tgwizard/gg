import { useState } from "react";
import type { GameSetupProps } from "../../ui";
import type { TtrConfig } from "../engine";

export function TicketSetup({ busy, disabled, onStart }: GameSetupProps<TtrConfig>) {
  const [turnSeconds, setTurnSeconds] = useState(60);
  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        onStart({ turnSeconds });
      }}
    >
      <p className="muted" style={{ margin: 0 }}>
        Collect train cards, claim routes across North America and connect the cities on your tickets. For 2–5 players.
      </p>
      <label className="field">
        <span>
          Turn timer{" "}
          <span className="hint">seconds, 0 = off. Run out and your turn is played for you. Choosing your first tickets gets twice as long.</span>
        </span>
        <input type="number" min={0} value={turnSeconds} onChange={(e) => setTurnSeconds(Math.max(0, Math.floor(Number(e.target.value) || 0)))} />
      </label>
      <button className="btn primary" disabled={busy || disabled}>
        {busy ? "Opening…" : "Open the table"}
      </button>
    </form>
  );
}
