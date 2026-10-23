/**
 * /settings: your profile (name and color), AI connections (API keys for the coming
 * bots, each with a quick way to try it out), and deleting it all. Everything here
 * lives in this browser only.
 */
import { type FormEvent, useEffect, useState } from "react";
import { PLAYER_COLORS } from "../../shared/colors";
import { Avatar, Panel, playerStyle, Spinner } from "../../ui";
import { ModeToggle } from "../components/ModeToggle";
import { ColorPicker, NameField } from "../components/Profile";
import { deleteLocalData, saveColor, saveName, useColor, useName } from "../identity";
import { clientFor, defaultModel, EFFORTS, maskKey, PROVIDERS, putConnection, removeConnection, updateConnection, useConnections } from "../llm/connections";
import { type Connection, type Effort, type LLMModel, LLMError, type LLMResult, type Provider } from "../llm/types";
import { noAutofill } from "../noAutofill";
import { cameFrom, navigate } from "../router";

export function SettingsPage() {
  const connections = useConnections();
  const [back] = useState(cameFrom);
  return (
    <div className="guide settings">
      <header className="guide-head on-brand">
        <a
          className="settings-back"
          href={back ?? "/"}
          onClick={(e) => {
            e.preventDefault();
            navigate(back ?? "/");
          }}
        >
          {back?.startsWith("/r/") ? "← Back to the room" : "← gg"}
        </a>
        <h1 className="display">Settings</h1>
        <p>Saved in this browser only.</p>
        <ModeToggle />
      </header>

      <main className="guide-main settings-main">
        <ProfileSection />

        <section className="stack">
          <h2 className="display settings-h2">AI connections</h2>
          <p className="muted">
            Connect a model for bots to play with. Keys stay in this browser: requests go straight from here to the provider, never through gg.
          </p>
          <Panel title="Add an API key">
            <ApiKeyForm />
          </Panel>
        </section>

        {connections.length > 0 && (
          <section className="stack" aria-label="Connected">
            <h3 className="label">Connected</h3>
            {connections.map((c) => (
              <ConnectionCard key={c.id} connection={c} />
            ))}
          </section>
        )}

        <DeleteDataSection />
      </main>
    </div>
  );
}

/** Name and color, saved as you go (rooms pick them up when you next join). */
function ProfileSection() {
  const savedName = useName();
  const color = useColor();
  const [name, setName] = useState(savedName ?? "");
  const save = () => name.trim() && saveName(name);
  return (
    <section className="stack">
      <h2 className="display settings-h2">Profile</h2>
      <Panel>
        <div className="profile-preview">
          <Avatar name={name || "?"} color={color} size="lg" />
          <div className="profile-preview-text">
            <strong className="name" style={playerStyle(color)}>
              {name.trim() || "Your name"}
            </strong>
            <span className="muted small">{PLAYER_COLORS[color]!.name}</span>
          </div>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <NameField value={name} onChange={setName} onBlur={save} />
        </form>
        <div className="field">
          <span>Your color</span>
          <ColorPicker value={color} onChange={saveColor} />
        </div>
      </Panel>
    </section>
  );
}

function DeleteDataSection() {
  const [confirming, setConfirming] = useState(false);
  return (
    <section className="stack">
      <h2 className="display settings-h2">Your data</h2>
      <Panel>
        <p className="settings-text">
          Everything on this page lives only in this browser: your name, color, light or dark mode, and AI keys. gg has no accounts, and its server
          never sees your keys.
        </p>
        <p className="muted small settings-text">
          Rooms you've played in keep your name and their chat until they expire. Deleting keeps your player identity, so you can still rejoin them.
        </p>
        {confirming ? (
          <div className="row wrap">
            <button
              type="button"
              className="btn danger"
              onClick={() => {
                deleteLocalData();
                location.reload();
              }}
            >
              Yes, delete everything
            </button>
            <button type="button" className="btn ghost" onClick={() => setConfirming(false)}>
              Cancel
            </button>
          </div>
        ) : (
          <button type="button" className="btn settings-delete" onClick={() => setConfirming(true)}>
            Delete all data
          </button>
        )}
      </Panel>
    </section>
  );
}

const KEY_PROVIDERS: { id: Provider; label: string; placeholder: string }[] = [
  { id: "anthropic", label: "Anthropic", placeholder: "sk-ant-…" },
  { id: "openai", label: "OpenAI", placeholder: "sk-…" },
  { id: "meta", label: "Meta (Muse)", placeholder: "Meta Model API key" },
];

function ApiKeyForm() {
  const [provider, setProvider] = useState<Provider>("anthropic");
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add(e: FormEvent) {
    e.preventDefault();
    const apiKey = key.trim();
    const connection: Connection = {
      id: crypto.randomUUID(),
      provider,
      label: `${PROVIDERS[provider].name} key ${maskKey(apiKey)}`,
      addedAt: new Date().toISOString(),
      apiKey,
    };
    setBusy(true);
    setError(null);
    try {
      // Check the key works (and pick a model) before keeping it.
      const models = await (await clientFor(connection)).listModels();
      const model = defaultModel(provider, models);
      putConnection({ ...connection, models: models.map((m) => m.id), ...(model ? { model } : {}) });
      setKey("");
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="stack" onSubmit={add}>
      <p className="muted small">Billed to your own account with that provider.</p>
      <select value={provider} onChange={(e) => setProvider(e.target.value as Provider)} aria-label="Provider">
        {KEY_PROVIDERS.map((p) => (
          <option key={p.id} value={p.id}>
            {p.label}
          </option>
        ))}
      </select>
      <div className="ai-row">
        {/* Masked with CSS, not type=password, so password managers don't treat it as a login. */}
        <input
          className="ai-secret"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder={KEY_PROVIDERS.find((p) => p.id === provider)!.placeholder}
          aria-label="API key"
          spellCheck={false}
          {...noAutofill}
        />
        <button className="btn" disabled={busy || !key.trim()}>
          {busy ? "Checking…" : "Add key"}
        </button>
      </div>
      {error && <p className="ai-error">{error}</p>}
    </form>
  );
}

function ConnectionCard({ connection: c }: { connection: Connection }) {
  const [models, setModels] = useState<LLMModel[] | null>(null);
  const [error, setError] = useState<LLMError | Error | null>(null);
  const [prompt, setPrompt] = useState("You're at a game night. Greet the table in one short sentence.");
  const [output, setOutput] = useState("");
  const [result, setResult] = useState<LLMResult | null>(null);
  const [running, setRunning] = useState<AbortController | null>(null);

  useEffect(() => {
    const abort = new AbortController();
    clientFor(c)
      .then((client) => client.listModels(abort.signal))
      .then((list) => {
        setModels(list);
        const model = defaultModel(c.provider, list);
        updateConnection(c.id, { models: list.map((m) => m.id), ...(!c.model && model ? { model } : {}) });
      })
      .catch((err: unknown) => !abort.signal.aborted && setError(err as Error));
    return () => abort.abort();
    // Reload when the key changes, not on every edit (like picking a model).
  }, [c.id, c.apiKey]);

  async function run(e: FormEvent) {
    e.preventDefault();
    if (!c.model) return;
    const abort = new AbortController();
    setRunning(abort);
    setOutput("");
    setResult(null);
    setError(null);
    try {
      const client = await clientFor(c);
      const res = await client.generate({
        model: c.model,
        messages: [{ role: "user", content: prompt }],
        maxOutputTokens: 1000,
        effort: c.effort ?? "low",
        signal: abort.signal,
        onText: (d) => setOutput((o) => o + d),
      });
      setResult(res);
      setOutput(res.text);
    } catch (err) {
      if (!(err instanceof LLMError && err.code === "cancelled")) setError(err as Error);
    } finally {
      setRunning(null);
    }
  }

  function remove() {
    running?.abort();
    removeConnection(c.id);
  }

  return (
    <Panel
      title={PROVIDERS[c.provider].name}
      className="ai-card"
      actions={
        <button type="button" className="btn ghost small" onClick={remove}>
          Remove
        </button>
      }
      data-testid="ai-connection"
    >
      <div className="ai-card-head">
        <span className={`light ${error ? "bad" : models ? "good" : "warn"}`} />
        <strong>{c.label}</strong>
        <span className="muted small">{PROVIDERS[c.provider].billing}</span>
      </div>

      <form className="stack" onSubmit={run}>
        <p className="muted small settings-text">Try the key here. Each AI bot picks its own model and effort when you add it (the cheapest model at low effort, unless you change them).</p>
        <div className="settings-pick">
          <label className="field">
            <span>Model</span>
            <select value={c.model ?? ""} onChange={(e) => updateConnection(c.id, { model: e.target.value })} disabled={!models}>
              {!models && <option value={c.model ?? ""}>{c.model ?? "Loading…"}</option>}
              {models?.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Effort</span>
            <select value={c.effort ?? "low"} onChange={(e) => updateConnection(c.id, { effort: e.target.value as Effort })}>
              {EFFORTS.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="field">
          <span>Try it</span>
          <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={2} {...noAutofill} />
        </label>
        <div className="row">
          {running ? (
            <button type="button" className="btn" onClick={() => running.abort()}>
              <Spinner /> Stop
            </button>
          ) : (
            <button className="btn primary" disabled={!c.model || !prompt.trim()}>
              Run
            </button>
          )}
          {result?.usage && (
            <span className="muted small num">
              {result.usage.inputTokens} in · {result.usage.outputTokens} out
            </span>
          )}
        </div>
        {output && (
          <p className="ai-output" data-testid="ai-output">
            {output}
          </p>
        )}
      </form>
      {error && <p className="ai-error">{message(error)}</p>}
    </Panel>
  );
}

function message(err: unknown): string {
  if (err instanceof Error) return err.message;
  return "Something went wrong.";
}
