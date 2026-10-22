import { useMemo, useState } from "react";
import { gameUIs } from "../../games/ui-registry";
import type { RoomClient, RoomSnapshot } from "../net/RoomClient";
import { RequestError } from "../net/RoomClient";
import { useServerNow } from "../useNow";
import { useToast } from "./Toasts";

export function GameStage({ client, snapshot }: { client: RoomClient; snapshot: RoomSnapshot }) {
  return snapshot.game ? <ActiveGame client={client} snapshot={snapshot} /> : <GamePicker client={client} snapshot={snapshot} />;
}

function GamePicker({ client, snapshot }: { client: RoomClient; snapshot: RoomSnapshot }) {
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const connected = snapshot.status === "connected";
  const ui = selected ? gameUIs[selected] : null;

  async function start(config: unknown) {
    if (!selected) return;
    setBusy(true);
    try {
      await client.selectGame(selected, config);
    } catch (e) {
      toast(e instanceof RequestError ? e.message : "Couldn't start the game.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="picker">
      <h2>Pick a game</h2>
      <p className="muted">Everyone in the room plays (or watches) together.</p>
      <div className="picker-grid">
        {Object.values(gameUIs).map((g) => (
          <button
            key={g.meta.id}
            className={`game-card ${selected === g.meta.id ? "selected" : ""}`}
            onClick={() => setSelected(g.meta.id)}
          >
            <strong>{g.meta.name}</strong>
            <span>{g.meta.tagline}</span>
            <span className="muted small">
              {g.meta.minPlayers}–{g.meta.maxPlayers} players
            </span>
          </button>
        ))}
        <div className="game-card soon">
          <strong>More soon</strong>
          <span className="muted">Games are modules. Add your own.</span>
        </div>
      </div>
      {ui && (
        <div className="setup">
          {ui.Setup ? (
            <ui.Setup busy={busy} disabled={!connected} onStart={start} />
          ) : (
            <button className="btn primary" disabled={busy || !connected} onClick={() => start({})}>
              Start {ui.meta.name}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function ActiveGame({ client, snapshot }: { client: RoomClient; snapshot: RoomSnapshot }) {
  const game = snapshot.game!;
  const ui = gameUIs[game.gameId];
  const toast = useToast();
  const [confirmEnd, setConfirmEnd] = useState(false);
  const connected = snapshot.status === "connected";
  const members = useMemo(() => new Map(snapshot.members.map((m) => [m.id, m])), [snapshot.members]);
  const serverNow = useServerNow(snapshot.clockOffset, 250);

  if (!ui) return <p className="muted">This room is playing a game this version of gg doesn't know ({game.gameId}). Try reloading.</p>;

  async function sendOp(op: unknown) {
    try {
      await client.sendGameOp(op);
      return true;
    } catch (e) {
      toast(e instanceof RequestError ? e.message : "Something went wrong.");
      return false;
    }
  }

  return (
    <div className="active-game">
      <div className="game-header">
        <h2>{ui.meta.name}</h2>
        <div className="spacer" />
        {confirmEnd ? (
          <span className="row">
            <span className="muted">End for everyone?</span>
            <button
              className="btn danger small"
              onClick={() => {
                setConfirmEnd(false);
                client.endGame().catch((e) => toast(e instanceof RequestError ? e.message : "Couldn't end the game."));
              }}
            >
              End game
            </button>
            <button className="btn ghost small" onClick={() => setConfirmEnd(false)}>
              Cancel
            </button>
          </span>
        ) : (
          <button className="btn ghost small" disabled={!connected} onClick={() => setConfirmEnd(true)}>
            End game
          </button>
        )}
      </div>
      <ui.Game
        view={game.view}
        snapshot={game}
        me={snapshot.you!.id}
        members={members}
        connected={connected}
        sendOp={sendOp}
        serverNow={serverNow}
      />
    </div>
  );
}
