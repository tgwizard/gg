import { nameStyle, Panel } from "../../ui";
import type { RoomSnapshot } from "../net/RoomClient";

export function Members({ snapshot }: { snapshot: RoomSnapshot }) {
  const waiting = new Set(snapshot.game?.waitingOn ?? []);
  const members = [...snapshot.members].sort((a, b) => Number(b.online) - Number(a.online));
  return (
    <Panel
      className="members"
      title="In this room"
      icon="person"
      actions={<span className="label">{members.filter((m) => m.online).length} online</span>}
    >
      <ul>
        {members.map((m) => (
          <li key={m.id} className={m.online ? "online" : "away"} data-testid="member">
            <span className={`light ${m.online ? "good" : ""}`} title={m.online ? "Online" : "Away"} />
            <span className="name member-name" style={nameStyle(m.id)}>
              {m.name}
            </span>
            {m.id === snapshot.you?.id && <span className="tag gilt">you</span>}
            {m.kind === "bot" && <span className="tag arcane">bot</span>}
            {waiting.has(m.id) && <span className="tag turn">to act</span>}
          </li>
        ))}
      </ul>
    </Panel>
  );
}
