import { useEffect, useMemo, useState } from "react";
import { saveName, getSecret, useName } from "../identity";
import { useRoom } from "../net/useRoom";
import { navigate } from "../router";
import { Chat } from "../components/Chat";
import { ConnectionBanner, ConnectionPill } from "../components/Connection";
import { GameStage } from "../components/GameStage";
import { Members } from "../components/Members";
import { NameForm } from "../components/NameForm";
import { ToastProvider, useToast } from "../components/Toasts";

export function RoomPage({ roomId }: { roomId: string }) {
  const name = useName();
  if (!name) {
    return (
      <div className="center-page">
        <div className="card narrow">
          <h2>You've been invited to a room</h2>
          <p className="muted">What should people call you?</p>
          <NameForm initial="" submitLabel="Join room" onSubmit={saveName} />
        </div>
      </div>
    );
  }
  return (
    <ToastProvider>
      <Room roomId={roomId} name={name} />
    </ToastProvider>
  );
}

function Room({ roomId, name }: { roomId: string; name: string }) {
  const secret = useMemo(getSecret, []);
  const { client, snapshot } = useRoom(roomId, secret, name);
  const [editingName, setEditingName] = useState(false);
  const toast = useToast();
  useEffect(() => client.onToast(toast), [client, toast]);

  if (snapshot.status === "not_found") {
    return (
      <div className="center-page">
        <div className="card narrow">
          <h2>Room not found</h2>
          <p className="muted">The link may be mistyped, or the room never existed.</p>
          <button className="btn primary" onClick={() => navigate("/")}>
            Create a new room
          </button>
        </div>
      </div>
    );
  }
  if (snapshot.status === "outdated") {
    return (
      <div className="center-page">
        <div className="card narrow">
          <h2>gg has been updated</h2>
          <p className="muted">Reload to get the latest version. You'll rejoin right where you were.</p>
          <button className="btn primary" onClick={() => location.reload()}>
            Reload
          </button>
        </div>
      </div>
    );
  }
  if (snapshot.status === "replaced") {
    return (
      <div className="center-page">
        <div className="card narrow">
          <h2>Open in another tab</h2>
          <p className="muted">You have this room open in several other tabs, so this one was paused.</p>
          <button className="btn primary" onClick={() => client.takeOver()}>
            Use this tab
          </button>
        </div>
      </div>
    );
  }
  if (!snapshot.joined) {
    return (
      <div className="center-page">
        <div className="joining">
          <div className="spinner" />
          <p>Joining room…</p>
          {snapshot.attempt > 0 && <ConnectionBanner snapshot={snapshot} onRetry={() => client.retryNow()} />}
        </div>
      </div>
    );
  }

  const connected = snapshot.status === "connected";
  return (
    <div className="room">
      <header className="topbar">
        <a
          className="brand"
          href="/"
          onClick={(e) => {
            e.preventDefault();
            navigate("/");
          }}
        >
          gg<span className="logo-dot">.</span>
        </a>
        <span className="room-code" title="Room code" data-testid="room-code">
          {roomId}
        </span>
        <InviteButton />
        <div className="spacer" />
        <ConnectionPill snapshot={snapshot} />
        {editingName ? (
          <NameForm
            compact
            initial={name}
            submitLabel="Save"
            onSubmit={(n) => {
              saveName(n);
              setEditingName(false);
            }}
            onCancel={() => setEditingName(false)}
          />
        ) : (
          <button className="name-button" onClick={() => setEditingName(true)} title="Change your name">
            {name} <span className="muted">✎</span>
          </button>
        )}
      </header>
      {!connected && <ConnectionBanner snapshot={snapshot} onRetry={() => client.retryNow()} />}
      <main className="room-main">
        <section className="stage">
          <GameStage client={client} snapshot={snapshot} />
        </section>
        <aside className="sidebar">
          <Members snapshot={snapshot} />
          <Chat snapshot={snapshot} onSend={(t) => client.sendChat(t)} />
        </aside>
      </main>
    </div>
  );
}

function InviteButton() {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="btn ghost small"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(location.href);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          // Clipboard blocked; the link is in the address bar anyway.
        }
      }}
    >
      {copied ? "Link copied ✓" : "Copy invite link"}
    </button>
  );
}
