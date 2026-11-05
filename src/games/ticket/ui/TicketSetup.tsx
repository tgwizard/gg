import { useState } from "react";
import { Button, busyWhy } from "../../../ui";
import type { GameSetupProps } from "../../ui";
import { TimerField } from "../../kit/ui/TimerField";
import type { TtrConfig } from "../engine";
import type { TtrMap } from "../map";
import { DEFAULT_MAP, mapById, offeredMaps } from "../maps";

/** Maps still being made are only offered when running locally. */
const MAPS = offeredMaps(import.meta.env.DEV);

export function TicketSetup({ busy, connected, onStart }: GameSetupProps<TtrConfig>) {
  const [turnSeconds, setTurnSeconds] = useState(60);
  const [map, setMap] = useState(DEFAULT_MAP);
  const chosen = mapById(map);
  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        onStart({ turnSeconds, map });
      }}
    >
      <p className="muted" style={{ margin: 0 }}>
        Collect train cards, claim routes across {chosen.region} and connect the cities on your tickets. For 2–5 players. Based on <em>Ticket to Ride</em> by Days of Wonder; fan-made and not
        affiliated.
      </p>
      {MAPS.length > 1 && (
        <div className="ttr-maps" role="group" aria-label="Map">
          {MAPS.map((m) => (
            <button key={m.id} type="button" className={`ttr-map-choice${m.id === map ? " chosen" : ""}`} aria-pressed={m.id === map} onClick={() => setMap(m.id)} data-testid={`ttr-map-${m.id}`}>
              <span className="ttr-map-name">
                {m.name}
                <MapStatus map={m} />
              </span>
              <span className="muted small">{facts(m)}</span>
            </button>
          ))}
        </div>
      )}
      <TimerField value={turnSeconds} onChange={setTurnSeconds} hint="run out and your turn is played for you; choosing your first tickets gets twice as long" />
      <Button className="btn primary" why={busy ? "Opening it…" : busyWhy({ connected })}>
        {busy ? "Opening…" : "Open the table"}
      </Button>
    </form>
  );
}

/** "36 cities, 100 routes, 45 trains each", and ferries if it has them. */
export function facts(m: TtrMap): string {
  const ferries = m.routes.filter((r) => r.ferry).length;
  return `${m.cities.length} ${m.places}, ${m.routes.length} routes${ferries ? ` (${ferries} ferries)` : ""}, ${m.trains} trains each`;
}

/** WIP for a map still being tuned; DEV for one only offered locally. */
export function MapStatus({ map }: { map: TtrMap }) {
  if (map.status === "ready") return null;
  return (
    <span className="wip-badge" title={map.status === "dev" ? "Being made: only offered when running locally" : "Work in progress: still being tuned"}>
      {map.status === "dev" ? "DEV" : "WIP"}
    </span>
  );
}
