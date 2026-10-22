import { type FormEvent, type ReactNode, useEffect, useMemo, useState } from "react";
import { PLAYER_COLORS } from "../../shared/colors";
import { MAX_ROOM_NAME_LENGTH } from "../../shared/protocol";
import { getSecret, saveColor, saveName, useColor, useName } from "../identity";
import type { RoomClient } from "../net/RoomClient";
import { RequestError } from "../net/RoomClient";
import { useRoom } from "../net/useRoom";
import { navigate } from "../router";
import { Chat } from "../components/Chat";
import { ConnectionBanner, ConnectionPill } from "../components/Connection";
import { GameStage } from "../components/GameStage";
import { Members } from "../components/Members";
import { ProfileForm, ProfileMenu } from "../components/Profile";
import { ToastProvider, useToast } from "../components/Toasts";
import { Panel, PlayerColorsProvider, Spinner } from "../../ui";
import { noAutofill } from "../noAutofill";
import { ModeToggle } from "../components/ModeToggle";

export function RoomPage({ roomId }: { roomId: string }) {
  const name = useName();
  const color = useColor();
  if (!name) {
    return (
      <Notice title="You're invited">
        <p>
          Someone's waiting for you in room <span className="code">{roomId}</span>. What should people call you?
        </p>
        <ProfileForm
          name=""
          color={color}
          submitLabel="Join room"
          onSubmit={(n, c) => {
            saveColor(c);
            saveName(n);
          }}
        />
      </Notice>
    );
  }
  return (
    <ToastProvider>
      <Room roomId={roomId} name={name} color={color} />
    </ToastProvider>
  );
}

function Room({ roomId, name, color }: { roomId: string; name: string; color: number }) {
  const secret = useMemo(getSecret, []);
  const { client, snapshot } = useRoom(roomId, secret, name, color);
  const toast = useToast();
  const colors = useMemo(() => new Map(snapshot.members.map((m) => [m.id, m.color])), [snapshot.members]);
  // Colors other members have, for the picker.
  const taken = useMemo(
    () => new Map(snapshot.members.filter((m) => m.id !== snapshot.you?.id).map((m) => [m.color, m.name])),
    [snapshot.members, snapshot.you?.id],
  );
  useEffect(() => client.onToast(toast), [client, toast]);

  if (snapshot.status === "not_found") {
    return (
      <Notice title="Room not found">
        <p className="muted">The link may be mistyped, the room may have expired, or it never existed.</p>
        <button className="btn primary" onClick={() => navigate("/")}>
          Create a new room
        </button>
      </Notice>
    );
  }
  if (snapshot.status === "outdated") {
    return (
      <Notice title="gg has been updated">
        <p className="muted">Reload to get the latest version. You'll rejoin right where you were.</p>
        <button className="btn primary" onClick={() => location.reload()}>
          Reload
        </button>
      </Notice>
    );
  }
  if (snapshot.status === "replaced") {
    return (
      <Notice title="Open in another tab">
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
  const you = snapshot.you;
  return (
    <PlayerColorsProvider colors={colors}>
      <div className="room">
        <header className="topbar on-brand">
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
          <RoomTitle name={snapshot.roomName} client={client} connected={connected} />
          <span className="room-id">
            <span className="code" title="Room code" data-testid="room-code">
              {roomId}
            </span>
            <InviteButton />
          </span>
          <div className="spacer" />
          <ConnectionPill snapshot={snapshot} />
          <ModeToggle />
          <ProfileMenu
            name={name}
            // What the room settled on (someone may have had your color first); yours until the welcome.
            color={you?.color ?? color}
            taken={taken}
            onSave={(n, c) => {
              saveColor(c);
              saveName(n);
            }}
          />
        </header>
        {!connected && <ConnectionBanner snapshot={snapshot} onRetry={() => client.retryNow()} />}
        {you && you.color !== color && (
          <div className="banner subtle-banner">
            {PLAYER_COLORS[color]!.name} is taken here, so you're {PLAYER_COLORS[you.color]!.name} in this room.
          </div>
        )}
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
    </PlayerColorsProvider>
  );
}

/** The room's name, which anyone in it can change. Rooms are still joined by code. */
function RoomTitle({ name, client, connected }: { name: string | null; client: RoomClient; connected: boolean }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(name ?? "");
  const toast = useToast();
  function submit(e: FormEvent) {
    e.preventDefault();
    setEditing(false);
    if (value.trim() !== (name ?? "")) client.renameRoom(value).catch((err) => toast(err instanceof RequestError ? err.message : "Couldn't rename the room."));
  }
  if (editing) {
    return (
      <form className="room-title-form" onSubmit={submit}>
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === "Escape" && setEditing(false)}
          onBlur={submit}
          placeholder="Name this room"
          aria-label="Room name"
          maxLength={MAX_ROOM_NAME_LENGTH}
          autoFocus
          {...noAutofill}
        />
      </form>
    );
  }
  return (
    <button
      className={`room-title ${name ? "display" : "unnamed"}`}
      disabled={!connected}
      onClick={() => {
        setValue(name ?? "");
        setEditing(true);
      }}
      title="Rename this room"
      data-testid="room-name"
    >
      {name ?? "Name this room"}
    </button>
  );
}

function InviteButton() {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="btn subtle small"
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

function Notice({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="center-page">
      <Panel className="notice">
        <img className="notice-logo" src="/icons/gg-512.jpg" alt="" width={56} height={56} />
        <h2 className="display">{title}</h2>
        {children}
      </Panel>
    </div>
  );
}
