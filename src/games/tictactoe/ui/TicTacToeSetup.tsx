import { useState } from "react";
import type { GameSetupProps } from "../../ui";
import { TimerField } from "../../kit/ui/TimerField";
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
      <TimerField value={turnSeconds} onChange={setTurnSeconds} hint="run out and you forfeit the round" />
      <button className="btn primary" disabled={busy || disabled}>
        {busy ? "Starting…" : "Start tic-tac-toe"}
      </button>
    </form>
  );
}
