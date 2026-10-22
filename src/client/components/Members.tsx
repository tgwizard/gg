import { Avatar, Panel, PlayerName } from "../../ui";
import type { RoomSnapshot } from "../net/RoomClient";

export function Members({ snapshot }: { snapshot: RoomSnapshot }) {
  const waiting = new Set(snapshot.game?.waitingOn ?? []);
  const members = [...snapshot.members].sort((a, b) => Number(b.online) - Number(a.online));
  return (
    <Panel className="members" title="In this room" actions={<span className="label">{members.filter((m) => m.online).length} online</span>}>
      <ul>
        {members.map((m) => (
          <li key={m.id} className={m.online ? "online" : "away"} data-testid="member">
            <Avatar name={m.name} color={m.color} online={m.online} size="sm" />
            <PlayerName name={m.name} color={m.color} className="member-name" />
            {m.id === snapshot.you?.id && <span className="tag accent">you</span>}
            {m.kind === "bot" && <span className="tag brand">bot</span>}
            {waiting.has(m.id) && <span className="tag gold">to act</span>}
          </li>
        ))}
      </ul>
    </Panel>
  );
}
