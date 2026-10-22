import { type ReactNode, useEffect, useMemo, useState } from "react";
import { saveName, getSecret, useName } from "../identity";
import { useRoom } from "../net/useRoom";
import { navigate } from "../router";
import { Chat } from "../components/Chat";
import { ConnectionBanner, ConnectionPill } from "../components/Connection";
import { GameStage } from "../components/GameStage";
import { Members } from "../components/Members";
import { NameForm } from "../components/NameForm";
import { ToastProvider, useToast } from "../components/Toasts";
import { type IconName, Panel, PixelIcon, Spinner } from "../../ui";

export function RoomPage({ roomId }: { roomId: string }) {
  const name = useName();
  if (!name) {
    return (
      <Notice icon="sparkle" title="You're invited">
        <p>
          Someone's waiting for you in room <span className="code">{roomId}</span>. What should people call you?
        </p>
        <NameForm initial="" submitLabel="Join room" onSubmit={saveName} />
      </Notice>
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
      <Notice icon="warning" title="Room not found">
        <p className="muted">The link may be mistyped, the room may have expired, or it never existed.</p>
        <button className="btn primary" onClick={() => navigate("/")}>
          Create a new room
        </button>
      </Notice>
    );
  }
  if (snapshot.status === "outdated") {
    return (
      <Notice icon="sparkle" title="gg has been updated">
        <p className="muted">Reload to get the latest version. You'll rejoin right where you were.</p>
        <button className="btn primary" onClick={() => location.reload()}>
          Reload
        </button>
      </Notice>
    );
  }
  if (snapshot.status === "replaced") {
    return (
      <Notice icon="hourglass" title="Open in another tab">
        <p className="muted">You have this room open in several other tabs, so this one was paused.</p>
        <button className="btn primary" onClick={() => client.takeOver()}>
          Use this tab
        </button>
      </Notice>
    );
  }
  if (!snapshot.joined) {
    return (
      <div className="center-page">
        <div className="joining">
          <Spinner />
          <p className="label">Joining room {roomId}</p>
          {snapshot.attempt > 0 && <ConnectionBanner snapshot={snapshot} onRetry={() => client.retryNow()} />}
        </div>
      </div>
    );
  }

  const connected = snapshot.status === "connected";
  return (
    <div className="room">
      <header className="topbar on-night">
        <a
          className="brand display"
          href="/"
          onClick={(e) => {
            e.preventDefault();
            navigate("/");
          }}
        >
          gg<span className="logo-dot">.</span>
        </a>
        <span className="room-id">
          <span className="label">Room</span>
          <span className="code" title="Room code" data-testid="room-code">
            {roomId}
          </span>
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
          <button className="btn ghost name-button" onClick={() => setEditingName(true)} title="Change your name">
            <PixelIcon name="person" />
            {name}
            <PixelIcon name="pencil" className="muted" />
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
      className="btn dark small"
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
      <PixelIcon name={copied ? "check" : "link"} />
      {copied ? "Link copied" : "Copy invite link"}
    </button>
  );
}

function Notice({ icon, title, children }: { icon: IconName; title: string; children: ReactNode }) {
  return (
    <div className="center-page">
      <Panel className="notice">
        <PixelIcon name={icon} scale={4} className="notice-icon" />
        <h2 className="display">{title}</h2>
        {children}
      </Panel>
    </div>
  );
}
