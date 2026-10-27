import { type FormEvent, useEffect, useState } from "react";
import { roomCodeFromInput } from "../../shared/roomCode";
import { gameUIs } from "../../games/ui-registry";
import { MAX_ROOM_NAME_LENGTH } from "../../shared/protocol";
import { Avatar, Button, Panel } from "../../ui";
import { ColorPicker, NameField, ProfileMenu } from "../components/Profile";
import { SettingsMenu } from "../components/SettingsMenu";
import { GameCard } from "../components/GameCard";
import { formatTime } from "../format";
import { saveColor, saveName, useColor, useName } from "../identity";
import { noAutofill } from "../noAutofill";
import { type RecentRoom, useRecentRooms } from "../recentRooms";
import { morph } from "../morph";
import { navigate } from "../router";

/**
 * The home page. Someone new picks a name and color first; after that, your profile is
 * the chip in the corner (by the settings cog), and the page is for getting into a room:
 * starting one, joining one, or going back to one you've been in.
 */
export function HomePage() {
  const savedName = useName();
  // Someone new until they save their profile (typing a name saves it too, but leaves the card where it is).
  const [isNew, setIsNew] = useState(!savedName);
  const [typed, setName] = useState(savedName ?? "");
  const name = isNew ? typed : (savedName ?? "");
  const color = useColor();
  const [roomName, setRoomName] = useState("");
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState(false);
  // A problem with one of the two forms, shown as a bubble by its button.
  const [error, setError] = useState<{ form: "create" | "join"; text: string } | null>(null);

  async function create(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setError({ form: "create", text: "Add your name in Profile first." });
    saveName(name);
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/rooms", { method: "POST", body: JSON.stringify({ name: roomName }) });
      if (res.status === 429) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        setError({ form: "create", text: body.message ?? "Slow down a little, then try again." });
        setBusy(false);
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { id } = (await res.json()) as { id: string };
      navigate(`/r/${id}`);
    } catch {
      setError({ form: "create", text: "Couldn't create a room. Check your connection and try again." });
      setBusy(false);
    }
  }

  // Save without a name: a word by the button, for a moment.
  const [nameNeeded, setNameNeeded] = useState(false);
  useEffect(() => {
    if (!nameNeeded) return;
    const t = setTimeout(() => setNameNeeded(false), 2500);
    return () => clearTimeout(t);
  }, [nameNeeded]);

  /** The card goes up to the corner, where your profile lives from now on. */
  function saveProfile(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setNameNeeded(true);
    saveName(name);
    morph(() => setIsNew(false));
  }

  function join(e: FormEvent) {
    e.preventDefault();
    const id = roomCodeFromInput(link);
    if (!id) return setError({ form: "join", text: "That doesn't look like a room code or link." });
    if (name.trim()) saveName(name);
    navigate(`/r/${id}`);
  }

  return (
    <div className="home">
      <header className="home-hero on-brand">
        <div className="home-hero-bar">
          <SettingsMenu />
          {!isNew && (
            <span className="home-hero-me">
              <ProfileMenu
                name={name}
                color={color}
                onSave={(n, c) => {
                  saveColor(c);
                  saveName(n);
                }}
              />
            </span>
          )}
        </div>
        <div className="home-hero-inner">
          <div className="home-hero-text">
            <h1 className="display logo">
              gg<span className="logo-dot">.</span>
            </h1>
            <p className="tagline">Games with friends. Make a room, share the link, play. Perhaps add a bot?</p>
            <p className="label">No accounts · No installs · Private by link</p>
          </div>
          <HeroGames />
        </div>
      </header>

      <main className="home-main">
        <div className={`home-forms ${isNew ? "new" : "known"}`}>
          {isNew && (
            <Panel title="Profile" className="home-profile">
              <form className="home-profile-form" onSubmit={saveProfile}>
                <NameField
                  value={name}
                  onChange={(v) => {
                    setName(v);
                    setNameNeeded(false);
                    if (error?.form === "create") setError(null);
                  }}
                  onBlur={() => name.trim() && saveName(name)}
                  autoFocus={!savedName}
                  lead={<Avatar name={name || "?"} color={color} size="lg" />}
                />
                <div className="field">
                  <span>Your color</span>
                  <ColorPicker value={color} onChange={saveColor} />
                </div>
                <div className="home-profile-foot">
                  <span className="muted small">Saved in this browser, used in every room.</span>
                  <span className="home-profile-save">
                    <button className="btn">Save</button>
                    {nameNeeded && (
                      <span className="bubble bubble-quiet" role="status">
                        Please give your name first.
                      </span>
                    )}
                  </span>
                </div>
              </form>
            </Panel>
          )}
          <Panel title="Start a room" className="home-start">
            <form onSubmit={create} className="home-form">
              <label className="field" htmlFor="room-name">
                <span>
                  Room name <span className="hint">optional</span>
                </span>
              </label>
              <div className="home-form-row">
                <input
                  id="room-name"
                  value={roomName}
                  onChange={(e) => {
                    setRoomName(e.target.value);
                    if (error?.form === "create") setError(null);
                  }}
                  placeholder="e.g. Friday poker"
                  maxLength={MAX_ROOM_NAME_LENGTH}
                  {...noAutofill}
                />
                <Button className="btn primary" why={busy ? "Hang on, it's being made." : null}>
                  {busy ? "Creating…" : "Create a room"}
                </Button>
                {error?.form === "create" && <Bubble text={error.text} />}
              </div>
            </form>
          </Panel>
          <div className="or-divider" aria-hidden>
            or
          </div>
          <Panel title="Join a room" className="home-join">
            <form onSubmit={join} className="home-form">
              <label className="field" htmlFor="room-code">
                <span>Room code or link</span>
              </label>
              <div className="home-form-row">
                <input
                  id="room-code"
                  value={link}
                  // Codes are shown upper-case as you type; pasted links are left alone.
                  onChange={(e) => {
                    setLink(e.target.value.includes("/") ? e.target.value : e.target.value.toUpperCase());
                    if (error?.form === "join") setError(null);
                  }}
                  placeholder="e.g. 7KQ2M9XH4D"
                  aria-label="Room code or link"
                  spellCheck={false}
                  {...noAutofill}
                />
                <button className="btn">Join</button>
                {error?.form === "join" && <Bubble text={error.text} />}
              </div>
            </form>
          </Panel>
        </div>

        <YourRooms />

        <section className="home-games">
          <h2 className="label">Games in the box</h2>
          <div className="game-grid">
            {Object.values(gameUIs).map((g) => (
              <GameCard key={g.meta.id} game={g} />
            ))}
          </div>
        </section>
      </main>

      <footer className="home-footer">
        <a
          href="/about"
          onClick={(e) => {
            e.preventDefault();
            navigate("/about");
          }}
        >
          About
        </a>{" "}
        · by Adam Renberg Tamm · Rooms are private to whoever has the link. ·{" "}
        <a
          href="/settings"
          onClick={(e) => {
            e.preventDefault();
            navigate("/settings");
          }}
        >
          Settings
        </a>
        {import.meta.env.DEV && (
          <>
            {" "}
            ·{" "}
            <a
              href="/try"
              onClick={(e) => {
                e.preventDefault();
                navigate("/try");
              }}
            >
              Try a game in a set-up position
            </a>
          </>
        )}
      </footer>
    </div>
  );
}

/** A small speech bubble under a form's button, for what went wrong. */
function Bubble({ text }: { text: string }) {
  return (
    <div className="bubble" role="alert">
      {text}
    </div>
  );
}

/** Rooms you've been in lately: one click back in. */
function YourRooms() {
  const rooms = useRecentRooms();
  if (!rooms.length) return null;
  return (
    <section className="home-rooms" aria-label="Your rooms">
      <h2 className="label">Your rooms</h2>
      <div className="room-grid">
        {rooms.map((r) => (
          <RoomCard key={r.id} room={r} />
        ))}
      </div>
    </section>
  );
}

function RoomCard({ room }: { room: RecentRoom }) {
  const game = room.gameId ? gameUIs[room.gameId] : undefined;
  const names = room.people.map((p) => (p.bot ? `${p.name} (bot)` : p.name));
  const people = names.length ? `with ${listed(names)}` : "just you";
  const line = game ? `${game.meta.name}, ${people}` : people[0]!.toUpperCase() + people.slice(1);
  return (
    <a
      className="room-card box"
      href={`/r/${room.id}`}
      onClick={(e) => {
        e.preventDefault();
        navigate(`/r/${room.id}`);
      }}
      data-testid="recent-room"
    >
      {/* The game that was on, or a table waiting for one. */}
      <img className="room-card-art" src={game?.icon ?? "/icons/room.jpg"} alt="" width={56} height={56} />
      <span className="room-card-text">
        <strong className="room-card-name">{room.name ?? `Room ${room.id}`}</strong>
        <span className="room-card-line">{line}</span>
        <span className="room-card-foot">
          {room.people.length > 0 && (
            <span className="room-card-mates" aria-hidden>
              {room.people.map((p, i) => (
                <Avatar key={i} name={p.name} color={p.color} bot={p.bot} size="sm" />
              ))}
            </span>
          )}
          <span className="room-card-when">{when(room.at)}</span>
        </span>
      </span>
    </a>
  );
}

/** "Sam", "Sam and Kim", "Sam, Kim and Lo". */
const listed = (names: string[]) => (names.length < 2 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`);

/** "Today 21:07", "Yesterday 14:02", or the date. */
function when(at: number): string {
  const day = (t: number) => new Date(t).toDateString();
  if (day(at) === day(Date.now())) return `Today ${formatTime(at)}`;
  if (day(at) === day(Date.now() - 86_400_000)) return `Yesterday ${formatTime(at)}`;
  const d = new Date(at);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${formatTime(at)}`;
}

/** Four of the games in the box, as a little pile of round tokens (one per spot). */
const HERO_GAMES = ["coast", "othello", "poker", "battleship"];

function HeroGames() {
  return (
    <div className="hero-games" aria-hidden>
      {HERO_GAMES.map((id, i) => (
        <img key={id} className={`hero-token t${i}`} src={gameUIs[id]!.icon} alt="" width={168} height={168} />
      ))}
    </div>
  );
}
