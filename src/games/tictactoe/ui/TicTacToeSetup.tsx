import { useState } from "react";
import { Button, busyWhy } from "../../../ui";
import type { GameSetupProps } from "../../ui";
import { TimerField } from "../../kit/ui/TimerField";
import type { TttConfig } from "../index";

export function TicTacToeSetup({ busy, connected, onStart }: GameSetupProps<TttConfig>) {
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
      <Button className="btn primary" why={busy ? "Starting it…" : busyWhy({ connected })}>
        {busy ? "Starting…" : "Start tic-tac-toe"}
      </Button>
    </form>
  );
}
