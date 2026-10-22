import type { RoomSnapshot } from "../net/RoomClient";

export function Members({ snapshot }: { snapshot: RoomSnapshot }) {
  const waiting = new Set(snapshot.game?.waitingOn ?? []);
  const members = [...snapshot.members].sort((a, b) => Number(b.online) - Number(a.online));
  return (
    <section className="panel members">
      <h3>
        In this room <span className="muted">{members.filter((m) => m.online).length} online</span>
      </h3>
      <ul>
        {members.map((m) => (
          <li key={m.id} className={m.online ? "online" : "away"} data-testid="member">
            <span className="dot" title={m.online ? "Online" : "Away"} />
            <span className="member-name" style={{ color: colorFor(m.id) }}>
              {m.name}
            </span>
            {m.id === snapshot.you?.id && <span className="tag">you</span>}
            {m.kind === "bot" && <span className="tag">bot</span>}
            {waiting.has(m.id) && <span className="tag turn">to act</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Stable, readable color per player. */
export function colorFor(id: string): string {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return `hsl(${h} 70% 70%)`;
}
