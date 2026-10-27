import { useState } from "react";
import { Button, busyWhy } from "../../../ui";
import type { GameSetupProps } from "../../ui";
import { TimerField } from "../../kit/ui/TimerField";
import type { TtrConfig } from "../engine";

export function TicketSetup({ busy, connected, onStart }: GameSetupProps<TtrConfig>) {
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
        Collect train cards, claim routes across North America and connect the cities on your tickets. For 2–5 players. Based on <em>Ticket to Ride</em> by Days of Wonder; fan-made and not affiliated.
      </p>
      <TimerField value={turnSeconds} onChange={setTurnSeconds} hint="run out and your turn is played for you; choosing your first tickets gets twice as long" />
      <Button className="btn primary" why={busy ? "Opening it…" : busyWhy({ connected })}>
        {busy ? "Opening…" : "Open the table"}
      </Button>
    </form>
  );
}
