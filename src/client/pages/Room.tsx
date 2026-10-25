import { type FormEvent, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { PLAYER_COLORS } from "../../shared/colors";
import { type ChatMessage, MAX_ROOM_NAME_LENGTH } from "../../shared/protocol";
import { useBots } from "../bots/store";
import { useRunBots } from "../bots/useRunBots";
import { useGuestClients, useGuests } from "../guests";
import { getSecret, saveColor, saveName, useColor, useName } from "../identity";
import type { RoomClient, RoomSnapshot } from "../net/RoomClient";
import { RequestError } from "../net/RoomClient";
import { useRoom } from "../net/useRoom";
import { navigate } from "../router";
import { Chat } from "../components/Chat";
import { ConnectionBanner, ConnectionDot } from "../components/Connection";
import { GameStage } from "../components/GameStage";
import { Members } from "../components/Members";
import { ProfileForm, ProfileMenu } from "../components/Profile";
import { ToastProvider, useToast } from "../components/Toasts";
import { Avatar, Panel, PlayerName, PlayersProvider, Spinner, useMedia, usePlayerColors } from "../../ui";
import { storage } from "../storage";
import { noAutofill } from "../noAutofill";
import { QuickSettings } from "../components/QuickSettings";
import { InviteButton, InviteSection } from "../components/Invite";
import { TopbarSlotProvider } from "../components/TopbarSlot";
import { PracticeTag } from "../components/PracticeTag";

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
  const bots = useBots(roomId);
  useRunBots(roomId, secret);
  const guests = useGuests(roomId);
  const guestClients = useGuestClients(roomId, secret);
  const toast = useToast();
  const colors = useMemo(() => new Map(snapshot.members.map((m) => [m.id, m.color])), [snapshot.members]);
  const botIds = useMemo(() => new Set(snapshot.members.filter((m) => m.kind === "bot").map((m) => m.id)), [snapshot.members]);
  const activities = useMemo(() => new Map(snapshot.members.flatMap((m) => (m.activity ? [[m.id, m.activity] as const] : []))), [snapshot.members]);
  // Colors other members have, for the picker.
  const taken = useMemo(
    () => new Map(snapshot.members.filter((m) => m.id !== snapshot.you?.id).map((m) => [m.color, m.name])),
    [snapshot.members, snapshot.you?.id],
  );
  useEffect(() => client.onToast(toast), [client, toast]);
  const sidebar = useSidebar(snapshot);
  const [gameSlot, setGameSlot] = useState<HTMLElement | null>(null);

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
    <PlayersProvider colors={colors} bots={botIds} activities={activities}>
      <TopbarSlotProvider value={gameSlot}>
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
            {/* The room's name, with its code and invite link behind the people icon. */}
            <span className="room-ident">
              <RoomTitle name={snapshot.roomName} client={client} connected={connected} />
              <InviteButton roomId={roomId} />
            </span>
            <PracticeTag roomId={roomId} />
            <div className="topbar-game" ref={setGameSlot} />
            <div className="spacer" />
            <ConnectionDot snapshot={snapshot} client={client} />
            <QuickSettings />
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
          <main className={`room-main${sidebar.open ? "" : " sidebar-hidden"}`}>
            <section className="stage">
              <GameStage
                client={client}
                snapshot={snapshot}
                guests={guestClients}
                invite={<InviteSection snapshot={snapshot} roomId={roomId} bots={bots} guests={guests} />}
              />
            </section>
            {sidebar.open ? (
              <aside className="sidebar">
                {sidebar.canHide && (
                  <button type="button" className="sidebar-hide btn ghost small" onClick={sidebar.hide} title="More room for the game" aria-label="Hide chat">
                    Hide chat ›
                  </button>
                )}
                <Members snapshot={snapshot} roomId={roomId} bots={bots} guests={guests} />
                <Chat snapshot={snapshot} onSend={(t) => client.sendChat(t)} />
              </aside>
            ) : (
              <SidebarRail snapshot={snapshot} unread={sidebar.unread} onShow={sidebar.show} />
            )}
          </main>
        </div>
      </TopbarSlotProvider>
    </PlayersProvider>
  );
}

/**
 * The members and chat sidebar can be folded away for a big game board (wide screens
 * only; on narrow ones it's under the game anyway). Remembered per browser. While it's
 * hidden, people's messages since then are counted.
 */
function useSidebar(snapshot: RoomSnapshot) {
  const [hidden, setHidden] = useState(() => storage.get(SIDEBAR_KEY) === "hidden");
  const stacked = useMedia("(max-width: 860px)");
  const lastSeq = snapshot.chat.at(-1)?.seq ?? 0;
  const [seen, setSeen] = useState(lastSeq);
  const open = !hidden || stacked;
  const unread = open ? 0 : snapshot.chat.filter((m) => m.seq > seen && m.kind === "user" && m.playerId !== snapshot.you?.id).length;
  return {
    open,
    canHide: !stacked,
    unread,
    hide() {
      storage.set(SIDEBAR_KEY, "hidden");
      setSeen(lastSeq);
      setHidden(true);
    },
    show() {
      storage.remove(SIDEBAR_KEY);
      setHidden(false);
    },
  };
}

const SIDEBAR_KEY = "gg.sidebar";

/** The folded sidebar: who's here, and a way back to the chat with what's new. */
function SidebarRail({ snapshot, unread, onShow }: { snapshot: RoomSnapshot; unread: number; onShow(): void }) {
  const online = snapshot.members.filter((m) => m.online);
  const popups = useChatPopups(snapshot);
  const colorOf = usePlayerColors();
  return (
    <aside className="sidebar-rail" data-testid="sidebar-rail">
      {/* New messages pop up beside the rail for a moment; the count stays on the button. */}
      <div className="rail-popups" aria-live="polite">
        {popups.map((m) => (
          <button key={m.seq} type="button" className="rail-popup box" onClick={onShow} data-testid="chat-popup">
            <PlayerName name={m.name ?? "Someone"} color={m.playerId ? colorOf(m.playerId) : 0} />
            <span className="rail-popup-text">{m.text}</span>
          </button>
        ))}
      </div>
      <button type="button" className="rail-btn" onClick={onShow} title="Show chat" aria-label={unread ? `Show chat (${unread} new)` : "Show chat"}>
        <svg viewBox="0 0 24 24" aria-hidden>
          <path d="M4 5h16v11H9l-5 4z" />
        </svg>
        {unread > 0 && <span className="rail-badge num">{unread > 99 ? "99+" : unread}</span>}
      </button>
      <ul className="rail-people">
        {online.slice(0, 10).map((m) => (
          <li key={m.id} title={m.name}>
            <Avatar name={m.name} color={m.color} online bot={m.kind === "bot"} size="sm" />
          </li>
        ))}
        {online.length > 10 && <li className="label">+{online.length - 10}</li>}
      </ul>
    </aside>
  );
}

/** How long a new message stays up beside the folded sidebar. */
const POPUP_MS = 6000;

/** People's messages that arrived since the rail appeared, each shown for a few seconds (the latest three). */
function useChatPopups(snapshot: RoomSnapshot) {
  const after = useRef(snapshot.chat.at(-1)?.seq ?? 0);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  const [shown, setShown] = useState<ChatMessage[]>([]);
  useEffect(() => {
    const fresh = snapshot.chat.filter((m) => m.seq > after.current && m.kind === "user" && m.playerId !== snapshot.you?.id);
    if (!fresh.length) return;
    after.current = fresh.at(-1)!.seq;
    setShown((s) => [...s, ...fresh].slice(-3));
    // Each batch goes away on its own clock, whatever arrives after it.
    const timer = setTimeout(() => {
      timers.current.delete(timer);
      setShown((s) => s.filter((m) => !fresh.includes(m)));
    }, POPUP_MS);
    timers.current.add(timer);
  }, [snapshot.chat, snapshot.you?.id]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  return shown;
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
