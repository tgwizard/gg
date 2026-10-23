import { type FormEvent, useState } from "react";
import { roomCodeFromInput } from "../../shared/roomCode";
import { gameUIs } from "../../games/ui-registry";
import { MAX_ROOM_NAME_LENGTH } from "../../shared/protocol";
import { Avatar, Panel, playerStyle } from "../../ui";
import { ColorPicker, NameField } from "../components/Profile";
import { ModeToggle } from "../components/ModeToggle";
import { GameCard } from "../components/GameCard";
import { saveColor, saveName, useColor, useName } from "../identity";
import { noAutofill } from "../noAutofill";
import { navigate } from "../router";

export function HomePage() {
  const savedName = useName();
  const [name, setName] = useState(savedName ?? "");
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
        <div className="home-hero-toggle">
          <ModeToggle />
        </div>
        <div className="home-hero-inner">
          <div className="home-hero-text">
            <h1 className="display logo">
              gg<span className="logo-dot">.</span>
            </h1>
            <p className="tagline">Games with friends. Make a room, share the link, play. Perhaps add an AI bot?</p>
            <p className="label">No accounts · No installs · Private by link</p>
          </div>
          <HeroGames />
        </div>
      </header>

      <main className="home-main">
        <div className="home-forms">
          <Panel title="Profile" className="home-profile">
            <div className="profile-preview">
              <Avatar name={name || "?"} color={color} size="lg" />
              <div className="profile-preview-text">
                <strong className="name" style={playerStyle(color)}>
                  {name.trim() || "Your name"}
                </strong>
                <span className="muted small">Saved in this browser, used in every room.</span>
              </div>
            </div>
            <NameField
              value={name}
              onChange={(v) => {
                setName(v);
                if (error?.form === "create") setError(null);
              }} onBlur={() => name.trim() && saveName(name)} autoFocus={!savedName} />
            <div className="field">
              <span>Your color</span>
              <ColorPicker value={color} onChange={saveColor} />
            </div>
          </Panel>
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
                <button className="btn primary" disabled={busy}>
                  {busy ? "Creating…" : "Create a room"}
                </button>
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
        <a href="https://github.com/tgwizard/gg">Open source</a> · by Adam Renberg Tamm · Rooms are private to whoever has the link. ·{" "}
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
