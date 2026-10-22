import { useState } from "react";
import type { GameSetupProps } from "../../ui";
import type { FishConfig } from "../engine";

export function FinnsISjonSetup({ busy, disabled, onStart }: GameSetupProps<FishConfig>) {
  const [turnSeconds, setTurnSeconds] = useState(45);
  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        onStart({ turnSeconds });
      }}
    >
      <p className="muted" style={{ margin: 0 }}>
        Ask the others for cards of a rank you hold. If they have none: <em>Finns i sjön!</em> Draw from the lake. Collect fours; most
        books wins.
      </p>
      <label className="field">
        <span>
          Turn timer <span className="hint">seconds, 0 = off. Run out and your turns are played for you.</span>
        </span>
        <input type="number" min={0} value={turnSeconds} onChange={(e) => setTurnSeconds(Math.max(0, Math.floor(Number(e.target.value) || 0)))} />
      </label>
      <button className="btn primary" disabled={busy || disabled}>
        {busy ? "Opening…" : "Open the table"}
      </button>
    </form>
  );
}
