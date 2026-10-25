/**
 * /settings, in two tabs. Profile: your name and color, sound, light or dark, and
 * deleting it all. Bots & AI (/settings#bots): your bots (made, edited and deleted here,
 * invited into rooms from the room) and the AI keys they can play with. Everything here
 * lives in this browser only.
 */
import { type FormEvent, type ReactNode, useEffect, useState, useSyncExternalStore } from "react";
import { PLAYER_COLORS } from "../../shared/colors";
import { Avatar, MODE_SHORTCUT, Panel, playerStyle, setSoundOn, toggleMode, useMode, useSoundOn } from "../../ui";
import { deleteGuest, getGuests, type GuestRecord, leftRoom as leftGuestRoom, updateGuest, useMyGuests } from "../guests";
import { leaveRooms } from "../leave";
import { type BotRecord, type BotSetup, createBot, deleteBot, dropConnection, getBots, leftRoom, MAX_BOTS, suggestBot, updateBot, useMyBots } from "../bots/store";
import { BotForm, botCaption, usedSoFar } from "../components/BotForm";
import { ModeIcon } from "../components/ModeToggle";
import { ColorPicker, NameField, ProfileForm } from "../components/Profile";
import { SoundIcon } from "../components/SoundToggle";
import { deleteLocalData, getSecret, saveColor, saveName, useColor, useName } from "../identity";
import { clientFor, defaultModel, maskKey, PROVIDERS, putConnection, removeConnection, updateConnection, useConnections } from "../llm/connections";
import type { Connection, Provider } from "../llm/types";
import { noAutofill } from "../noAutofill";
import { cameFrom, navigate } from "../router";

type Tab = "profile" | "bots";
const TABS: { id: Tab; label: string }[] = [
  { id: "profile", label: "Profile" },
  { id: "bots", label: "Bots & AI" },
];

function subscribeHash(cb: () => void) {
  window.addEventListener("hashchange", cb);
  return () => window.removeEventListener("hashchange", cb);
}
const tabFromHash = (): Tab => (location.hash === "#bots" ? "bots" : "profile");

export function SettingsPage() {
  const tab = useSyncExternalStore(subscribeHash, tabFromHash);
  const [back] = useState(cameFrom);
  const pick = (t: Tab) => {
    // Kept in the address (so a link can open a tab), without a history entry per click.
    history.replaceState(history.state, "", t === "profile" ? location.pathname : `${location.pathname}#${t}`);
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  };
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
        <div className="settings-tabs" role="tablist" aria-label="Settings">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              id={`tab-${t.id}`}
              aria-selected={tab === t.id}
              aria-controls={`panel-${t.id}`}
              className={`settings-tab ${tab === t.id ? "on" : ""}`}
              onClick={() => pick(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
      </header>

      <main className="guide-main settings-main" role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === "profile" ? (
          <>
            <ProfileSection />
            <GuestsSection />
            <LooksSection />
            <DeleteDataSection />
          </>
        ) : (
          <>
            <BotsSection />
            <KeysSection />
          </>
        )}
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

/** People who play on this device with you (hot seat), added in a room; edited and forgotten here. */
function GuestsSection() {
  const guests = useMyGuests();
  if (!guests.length) return null;
  return (
    <section className="stack">
      <h2 className="display settings-h2">Players on this device</h2>
      <p className="muted settings-text">People who take turns at this screen with you, in games where nothing is hidden. Add them in a room.</p>
      {guests.map((g) => (
        <GuestCard key={g.id} guest={g} />
      ))}
    </section>
  );
}

function GuestCard({ guest }: { guest: GuestRecord }) {
  const [editing, setEditing] = useState(false);
  const rooms = Object.values(guest.rooms).filter((r) => !r.removing).length;
  if (editing) {
    return (
      <Panel className="bot-card" data-testid="guest-card">
        <ProfileForm
          name={guest.name}
          color={guest.color}
          whose="Player"
          caption="Plays on this device with you"
          submitLabel="Save"
          onSubmit={(name, color) => {
            setEditing(false);
            updateGuest(guest.id, name, color);
          }}
          onCancel={() => setEditing(false)}
        />
      </Panel>
    );
  }
  return (
    <Panel className="bot-card" data-testid="guest-card">
      <div className="bot-card-head">
        <Avatar name={guest.name} color={guest.color} size="lg" />
        <div className="profile-preview-text">
          <strong className="name" style={playerStyle(guest.color)}>
            {guest.name}
          </strong>
          <span className="muted small">{rooms ? `In ${rooms} ${rooms === 1 ? "room" : "rooms"}` : "In no rooms now"}</span>
        </div>
        <div className="row bot-card-actions">
          <button type="button" className="btn small" onClick={() => setEditing(true)} aria-label={`Edit ${guest.name}`}>
            Edit
          </button>
          <button
            type="button"
            className="btn ghost small"
            onClick={() => {
              deleteGuest(guest.id);
              const gone = getGuests().find((g) => g.id === guest.id);
              if (gone) void leaveRooms(gone, { owner: getSecret(), guest: true }, leftGuestRoom);
            }}
            aria-label={`Forget ${guest.name}`}
            title={rooms ? "They leave the rooms they're in, and any game they're playing there." : undefined}
          >
            Forget
          </button>
        </div>
      </div>
    </Panel>
  );
}

/** Sound, and light or dark. */
function LooksSection() {
  const on = useSoundOn();
  const dark = useMode() === "dark";
  return (
    <section className="stack">
      <h2 className="display settings-h2">Sound and looks</h2>
      <Panel>
        <SwitchRow
          icon={<SoundIcon on={on} />}
          label="Sound effects"
          note="Quiet chimes and clicks: your turn, cards, chips, moves, wins. Also the speaker in the top bar."
          on={on}
          onClick={() => setSoundOn(!on)}
          testId="settings-sound"
        />
        <SwitchRow
          icon={<ModeIcon sun={dark} />}
          label="Dark mode"
          note={`Also the sun or moon in the top bar, or ${MODE_SHORTCUT} anywhere.`}
          on={dark}
          onClick={toggleMode}
          testId="settings-dark"
        />
      </Panel>
    </section>
  );
}

/** A setting that's on or off, with the same icon as its button in the top bar. */
function SwitchRow(props: { icon: ReactNode; label: string; note: string; on: boolean; onClick(): void; testId: string }) {
  return (
    <button type="button" role="switch" aria-checked={props.on} className="settings-switch" onClick={props.onClick} data-testid={props.testId}>
      <span className="mode-toggle" aria-hidden>
        {props.icon}
      </span>
      <span className="settings-switch-text">
        {props.label} <span className="muted">{props.note}</span>
      </span>
      <span className="settings-switch-state">{props.on ? "On" : "Off"}</span>
    </button>
  );
}

function DeleteDataSection() {
  const [confirming, setConfirming] = useState(false);
  return (
    <section className="stack">
      <h2 className="display settings-h2">Your data</h2>
      <Panel>
        <p className="settings-text">
          Everything in these settings lives only in this browser: your name, color, light or dark mode, sound, the players on this device, your bots and AI keys. gg has no accounts, and
          its server never sees your keys.
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

// --- bots ------------------------------------------------------------------------

/** Your bots: each a player of its own that you invite into rooms; made, edited and deleted here. */
function BotsSection() {
  const bots = useMyBots();
  const [making, setMaking] = useState<BotSetup | null>(null);
  const [confirmingAll, setConfirmingAll] = useState(false);
  return (
    <section className="stack">
      <h2 className="display settings-h2">Your bots</h2>
      <p className="muted settings-text">
        Your bots are yours to keep, like your name. Invite them into a room from its member list; they play from this browser while you have the room open.
        Built-in bots play without AI; give one an AI key below to have it chat and play in character.
      </p>
      {bots.map((b) => (
        <BotCard key={b.id} bot={b} />
      ))}
      {making && (
        <Panel title="New bot">
          <BotForm
            initial={making}
            submitLabel="Make bot"
            inSettings
            onSubmit={(setup) => {
              setMaking(null);
              void createBot(setup);
            }}
            onCancel={() => setMaking(null)}
          />
        </Panel>
      )}
      <div className="bots-foot">
        {!making && !(confirmingAll && bots.length > 1) && (
          <button
            type="button"
            className="btn settings-new-bot"
            disabled={bots.length >= MAX_BOTS}
            onClick={() => setMaking({ ...suggestBot({ names: [], colors: [] }), level: "builtin", strength: "easy" })}
          >
            + New bot
          </button>
        )}
        {bots.length > 1 && <DeleteAllBots bots={bots} confirming={confirmingAll} setConfirming={setConfirmingAll} />}
      </div>
    </section>
  );
}

/** Delete them all, after a confirmation that slides in across the row. */
function DeleteAllBots({ bots, confirming, setConfirming }: { bots: BotRecord[]; confirming: boolean; setConfirming(on: boolean): void }) {
  const rooms = new Set(bots.flatMap((b) => Object.keys(b.rooms))).size;
  return (
    <div className="bots-delete-all">
      {confirming ? (
        <div className="bots-delete-confirm" role="alert">
          <span className="bots-delete-text">
            Delete all {bots.length} bots?{rooms ? ` They leave every room they're in, and their games there.` : ""}
          </span>
          <button
            type="button"
            className="btn danger small"
            onClick={() => {
              const secret = getSecret();
              setConfirming(false);
              for (const b of bots) deleteBot(b.id);
              for (const b of getBots().filter((g) => g.deleted)) void leaveRooms(b, { owner: secret, bot: { level: "builtin" } }, leftRoom);
            }}
          >
            Delete all
          </button>
          <button type="button" className="btn ghost small" onClick={() => setConfirming(false)}>
            Cancel
          </button>
        </div>
      ) : (
        <button type="button" className="btn ghost small settings-delete" onClick={() => setConfirming(true)}>
          Delete all bots
        </button>
      )}
    </div>
  );
}

function BotCard({ bot }: { bot: BotRecord }) {
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const rooms = Object.values(bot.rooms).filter((r) => !r.removing).length;
  if (editing) {
    return (
      <Panel className="bot-card" data-testid="bot-card">
        <BotForm
          initial={bot}
          bot={bot}
          submitLabel="Save"
          inSettings
          onSubmit={(setup) => {
            setEditing(false);
            updateBot(bot.id, setup);
          }}
          onCancel={() => setEditing(false)}
        />
      </Panel>
    );
  }
  return (
    <Panel className="bot-card" data-testid="bot-card">
      <div className="bot-card-head">
        <Avatar name={bot.name} color={bot.color} bot size="lg" />
        <div className="profile-preview-text">
          <strong className="name" style={playerStyle(bot.color)}>
            {bot.name}
          </strong>
          <span className="muted small">
            {botCaption(bot)} · {rooms ? `in ${rooms} ${rooms === 1 ? "room" : "rooms"}` : "in no rooms yet"}
          </span>
        </div>
        <div className="row bot-card-actions">
          <button type="button" className="btn small" onClick={() => setEditing(true)} aria-label={`Edit ${bot.name}`}>
            Edit
          </button>
          <button type="button" className="btn ghost small" onClick={() => setConfirming(true)} aria-label={`Delete ${bot.name}`}>
            Delete
          </button>
        </div>
      </div>
      {bot.persona && <p className="bot-persona">“{bot.persona}”</p>}
      {bot.usage && <p className="muted small settings-text">{usedSoFar(bot.usage)}</p>}
      {bot.error && <p className="ai-error">{bot.error}</p>}
      {confirming && (
        <div className="bot-card-confirm" role="alert">
          <p className="settings-text">
            Delete {bot.name}?{rooms ? ` It leaves the ${rooms === 1 ? "room" : `${rooms} rooms`} it's in, and any game it's playing there.` : ""}
          </p>
          <div className="row">
            <button
              type="button"
              className="btn danger small"
              onClick={() => {
                deleteBot(bot.id);
                const gone = getBots().find((b) => b.id === bot.id);
                if (gone) void leaveRooms(gone, { owner: getSecret(), bot: { level: "builtin" } }, leftRoom);
              }}
            >
              Delete {bot.name}
            </button>
            <button type="button" className="btn ghost small" onClick={() => setConfirming(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </Panel>
  );
}

// --- AI keys -----------------------------------------------------------------------

function KeysSection() {
  const connections = useConnections();
  return (
    <section className="stack">
      <h2 className="display settings-h2">AI keys</h2>
      <p className="muted settings-text">
        For bots that play with AI. Keys stay in this browser: requests go straight from here to the provider, never through gg, and are billed to your own
        account there.
      </p>
      <Panel title="Add an API key">
        <ApiKeyForm />
      </Panel>
      {connections.map((c) => (
        <ConnectionCard key={c.id} connection={c} />
      ))}
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

  function add(e: FormEvent) {
    e.preventDefault();
    const apiKey = key.trim();
    if (!apiKey) return;
    putConnection({ id: crypto.randomUUID(), provider, label: `${PROVIDERS[provider].name} key ${maskKey(apiKey)}`, addedAt: new Date().toISOString(), apiKey });
    setKey("");
  }

  return (
    <form className="ai-row" onSubmit={add}>
      <select value={provider} onChange={(e) => setProvider(e.target.value as Provider)} aria-label="Provider">
        {KEY_PROVIDERS.map((p) => (
          <option key={p.id} value={p.id}>
            {p.label}
          </option>
        ))}
      </select>
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
      <button className="btn" disabled={!key.trim()}>
        Add key
      </button>
    </form>
  );
}

/** A key: which bots use it, and whether the provider knows it (it lists its models). */
function ConnectionCard({ connection: c }: { connection: Connection }) {
  const bots = useMyBots().filter((b) => b.level === "ai" && b.connectionId === c.id);
  const [state, setState] = useState<"checking" | "good" | "bad">(c.models?.length ? "good" : "checking");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const abort = new AbortController();
    clientFor(c)
      .then((client) => client.listModels(abort.signal))
      .then((list) => {
        setState("good");
        setError(null);
        const model = defaultModel(c.provider, list);
        updateConnection(c.id, { models: list.map((m) => m.id), ...(!c.model && model ? { model } : {}) });
      })
      .catch((err: unknown) => {
        if (abort.signal.aborted) return;
        setState("bad");
        setError(err instanceof Error ? err.message : "Couldn't reach the provider.");
      });
    return () => abort.abort();
  }, [c.id, c.apiKey]);

  return (
    <Panel className="ai-card" data-testid="ai-connection">
      <div className="ai-card-head">
        <span className={`light ${state === "bad" ? "bad" : state === "good" ? "good" : "warn"}`} title={state === "good" ? "Works" : state === "bad" ? "Doesn't work" : "Checking"} />
        <strong>{c.label}</strong>
        <span className="muted small">{bots.length ? `Used by ${bots.map((b) => b.name).join(", ")}` : "No bots use it yet"}</span>
        <button
          type="button"
          className="btn ghost small ai-remove"
          onClick={() => {
            dropConnection(c.id);
            removeConnection(c.id);
          }}
        >
          Remove
        </button>
      </div>
      {error && <p className="ai-error">{error}</p>}
      {c.usage && (
        <p className="muted small settings-text" data-testid="key-usage">
          {usedSoFar(c.usage)}
        </p>
      )}
      {bots.length > 0 && (
        <p className="muted small settings-text">Removing it turns {bots.length === 1 ? `${bots[0]!.name} into a built-in bot` : "those bots into built-in bots"}.</p>
      )}
    </Panel>
  );
}
