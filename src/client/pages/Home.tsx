import { type FormEvent, useState } from "react";
import { roomCodeFromInput } from "../../shared/roomCode";
import { gameUIs } from "../../games/ui-registry";
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
      <div className="home-card">
        <h1 className="logo">
          gg<span className="logo-dot">.</span>
        </h1>
        <p className="tagline">Games with friends. Make a room, share the link, play.</p>

        <form onSubmit={create} className="stack">
          <label className="field">
            <span>Your name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Ada" maxLength={24} autoFocus {...noAutofill} />
          </label>
          <button className="btn primary big" disabled={busy}>
            {busy ? "Creating…" : "Create a room"}
          </button>
        </form>

        <div className="divider">
          <span>or join one</span>
        </div>
        <form onSubmit={join} className="row">
          <input
            value={link}
            // Codes are shown upper-case as you type; pasted links are left alone.
            onChange={(e) => setLink(e.target.value.includes("/") ? e.target.value : e.target.value.toUpperCase())}
            placeholder="Room code or link"
            aria-label="Room code or link"
            spellCheck={false}
            {...noAutofill}
          />
          <button className="btn">Join</button>
        </form>

        {error && <p className="error-text">{error}</p>}

        <div className="game-list">
          {Object.values(gameUIs).map((g) => (
            <div key={g.meta.id} className="game-chip">
              <strong>{g.meta.name}</strong>
              <span>{g.meta.tagline}</span>
            </div>
          ))}
        </div>
      </div>
      <footer className="home-footer">
        <a href="https://github.com/tgwizard/gg">Open source</a> · No accounts. Rooms are private to whoever has the link.
      </footer>
    </div>
  );
}
