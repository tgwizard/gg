import { type FormEvent, useState } from "react";
import { roomCodeFromInput } from "../../shared/roomCode";
import { gameUIs } from "../../games/ui-registry";
import { CardBack, PlayingCard } from "../../games/kit/ui/Cards";
import { TableSurface } from "../../games/kit/ui/CardTable";
import { Panel } from "../../ui";
import { ModeToggle } from "../components/ModeToggle";
import { GameCard } from "../components/GameCard";
import { saveName, useName } from "../identity";
import { noAutofill } from "../noAutofill";
import { navigate } from "../router";

export function HomePage() {
  const savedName = useName();
  const [name, setName] = useState(savedName ?? "");
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setError("Pick a name first.");
    saveName(name);
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/rooms", { method: "POST" });
      if (res.status === 429) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        setError(body.message ?? "Slow down a little, then try again.");
        setBusy(false);
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { id } = (await res.json()) as { id: string };
      navigate(`/r/${id}`);
    } catch {
      setError("Couldn't create a room. Check your connection and try again.");
      setBusy(false);
    }
  }

  function join(e: FormEvent) {
    e.preventDefault();
    const id = roomCodeFromInput(link);
    if (!id) return setError("That doesn't look like a room code or link.");
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
            <p className="tagline">Games with friends. Make a room, share the link, play.</p>
            <p className="label">No accounts · No installs · Private by link</p>
          </div>
          <HeroTable />
        </div>
      </header>

      <main className="home-main">
        <div className="home-forms">
          <Panel title="Start a room">
            <form onSubmit={create} className="stack">
              <label className="field">
                <span>Your name</span>
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Ada" maxLength={24} autoFocus {...noAutofill} />
              </label>
              <button className="btn primary big" disabled={busy}>
                {busy ? "Creating…" : "Create a room"}
              </button>
            </form>
          </Panel>
          <Panel title="Join a room">
            <form onSubmit={join} className="stack">
              <label className="field">
                <span>Room code or link</span>
                <input
                  value={link}
                  // Codes are shown upper-case as you type; pasted links are left alone.
                  onChange={(e) => setLink(e.target.value.includes("/") ? e.target.value : e.target.value.toUpperCase())}
                  placeholder="e.g. 7KQ2M9XH4D"
                  aria-label="Room code or link"
                  spellCheck={false}
                  {...noAutofill}
                />
              </label>
              <button className="btn big">Join</button>
            </form>
          </Panel>
        </div>

        {error && (
          <p className="error-text home-error" role="alert">
            {error}
          </p>
        )}

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
        <a href="https://github.com/tgwizard/gg">Open source</a> · MIT · Rooms are private to whoever has the link.
      </footer>
    </div>
  );
}

/** A little table with a winning hand on it. */
function HeroTable() {
  return (
    <div className="hero-table" aria-hidden>
      <TableSurface />
      <div className="hero-cards">
        <PlayingCard card="As" size="lg" highlight />
        <PlayingCard card="Ah" size="lg" highlight />
        <CardBack size="lg" />
      </div>
    </div>
  );
}
