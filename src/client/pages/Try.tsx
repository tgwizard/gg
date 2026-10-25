/**
 * /try: games in a set-up position (the move before the end, the end itself), with
 * built-in bots in the other seats, for trying a game (or checking its end screens)
 * without playing it through. /try/<game>/<scenario> makes a practice room, adds the
 * bots, has the room set the game up, and takes you there. Loaded on demand, since
 * it brings every game's rules. See "Practice rooms" in docs/ARCHITECTURE.md.
 */
import { useEffect, useRef, useState } from "react";
import type { Scenario } from "../../games/kit/scenario";
import { scenarios } from "../../games/scenarios";
import { gameUIs } from "../../games/ui-registry";
import type { LoadScenario } from "../../shared/protocol";
import { Panel, Spinner } from "../../ui";
import { type BotRecord, createBot, getBots, inviteBot, suggestBot } from "../bots/store";
import { ModeToggle } from "../components/ModeToggle";
import { getColor, getName, getSecret, saveName } from "../identity";
import { RoomClient } from "../net/RoomClient";
import { navigate } from "../router";

export function TryPage({ path }: { path: string }) {
  const m = path.match(/^\/try\/([^/]+)\/([^/]+)\/?$/);
  const scenario = m && scenarios[m[1]!]?.find((s) => s.id === m[2]);
  if (scenario) return <SetUp gameId={m[1]!} scenario={scenario} />;
  return <TryIndex />;
}

function TryIndex() {
  return (
    <div className="guide try">
      <header className="guide-head on-brand">
        <a
          className="settings-back"
          href="/"
          onClick={(e) => {
            e.preventDefault();
            navigate("/");
          }}
        >
          ← gg
        </a>
        <h1 className="display">Try a game</h1>
        <p>Jump into a game at an interesting moment, with built-in bots in the other seats. Each one opens a new practice room.</p>
        <ModeToggle />
      </header>
      <main className="guide-main">
        {Object.entries(scenarios).map(([gameId, list]) => {
          const game = gameUIs[gameId]!;
          return (
            <section key={gameId} className="stack" aria-label={game.meta.name}>
              <h2 className="display try-game">
                <img src={game.icon} alt="" width={40} height={40} />
                {game.meta.name}
              </h2>
              <div className="game-grid">
                {list.map((s) => (
                  <a
                    key={s.id}
                    className="game-card box try-card"
                    href={`/try/${gameId}/${s.id}`}
                    onClick={(e) => {
                      e.preventDefault();
                      navigate(`/try/${gameId}/${s.id}`);
                    }}
                  >
                    <span className="game-card-text">
                      <strong className="display">{s.name}</strong>
                      <span className="game-card-tagline">{s.description}</span>
                      <span className="label">{s.bots === 1 ? "With a bot" : `With ${s.bots} bots`}</span>
                    </span>
                  </a>
                ))}
              </div>
            </section>
          );
        })}
      </main>
    </div>
  );
}

function SetUp({ gameId, scenario }: { gameId: string; scenario: Scenario }) {
  const [step, setStep] = useState("Making a practice room");
  const [error, setError] = useState<string | null>(null);
  // Once, even when React runs effects twice in development.
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    setUpRoom(gameId, scenario, setStep).then(
      (roomId) => location.replace(`/r/${roomId}`),
      (e: unknown) => setError(e instanceof Error ? e.message : String(e)),
    );
  }, [gameId, scenario]);

  const name = `${gameUIs[gameId]?.meta.name}: ${scenario.name}`;
  return (
    <div className="center-page">
      <Panel className="notice">
        <img className="notice-logo" src={gameUIs[gameId]?.icon ?? "/icons/gg-512.jpg"} alt="" width={56} height={56} />
        <h2 className="display">{name}</h2>
        {error ? (
          <>
            <p role="alert">{error}</p>
            <a className="btn" href="/try">
              Back to the list
            </a>
          </>
        ) : (
          <div className="row try-step" aria-live="polite">
            <Spinner />
            <span className="label">{step}…</span>
          </div>
        )}
      </Panel>
    </div>
  );
}

/** Make a practice room with the scenario's game in it, and return its code. */
async function setUpRoom(gameId: string, scenario: Scenario, step: (text: string) => void): Promise<string> {
  const game = gameUIs[gameId]!.meta;
  // The game's name is in the top bar next to the room's.
  const res = await fetch("/api/rooms", { method: "POST", body: JSON.stringify({ name: scenario.name, practice: true }) });
  if (res.status === 429) throw new Error(((await res.json().catch(() => ({}))) as { message?: string }).message ?? "Slow down a little, then try again.");
  if (!res.ok) throw new Error("Couldn't make a room. Check your connection and try again.");
  const { id: roomId } = (await res.json()) as { id: string };

  const secret = getSecret();
  const name = getName() ?? "You";
  if (!getName()) saveName(name);
  const clients: RoomClient[] = [];
  const connect = (c: RoomClient) => {
    clients.push(c);
    c.start();
    return until(c, (s) => s.joined && s.status === "connected");
  };
  try {
    step("Joining it");
    const you = new RoomClient(roomId, secret, name, getColor());
    await connect(you);

    // Your built-in bots, invited as from the room (made if you haven't enough); they play from the room page.
    step(scenario.bots === 1 ? "Inviting a bot" : `Inviting ${scenario.bots} bots`);
    const bots: BotRecord[] = [];
    const yours = getBots().filter((b) => !b.deleted && b.level === "easy");
    for (let i = 0; i < scenario.bots; i++) {
      const taken = [...you.getSnapshot().members, ...bots];
      const bot = yours[i] ?? (await createBot({ ...suggestBot({ names: taken.map((m) => m.name), colors: taken.map((m) => m.color) }), level: "easy" }));
      if (!bot || !inviteBot(bot.id, roomId)) throw new Error("Couldn't invite a bot.");
      bots.push(bot);
      await connect(new RoomClient(roomId, bot.secret, bot.name, bot.color, { owner: secret, bot: { level: "easy", ...(bot.persona ? { persona: bot.persona } : {}) } }));
    }
    const snapshot = await until(you, (s) => bots.every((b) => s.members.some((m) => m.id === b.playerId)));

    step(`Setting up ${game.name}`);
    const names = new Map(snapshot.members.map((m) => [m.id, m.name]));
    const state = scenario.build([snapshot.you!.id, ...bots.map((b) => b.playerId)], {
      now: Date.now() + snapshot.clockOffset,
      randomInt: (n) => Math.floor(Math.random() * n),
      nameOf: (id) => names.get(id) ?? "Someone",
      announce: () => {},
    });
    const body: LoadScenario = { secret, gameId, name: scenario.name, state };
    const load = await fetch(`/api/rooms/${roomId}/scenario`, { method: "POST", body: JSON.stringify(body) });
    if (!load.ok) {
      const { error } = (await load.json().catch(() => ({}))) as { error?: string };
      throw new Error(`The room wouldn't set the game up (${error ?? `HTTP ${load.status}`}).`);
    }
    return roomId;
  } finally {
    for (const c of clients) c.stop();
  }
}

type Snapshot = ReturnType<RoomClient["getSnapshot"]>;

/** The client's snapshot once `ready` holds; fails if the room turns it away or it takes too long. */
function until(client: RoomClient, ready: (s: Snapshot) => boolean): Promise<Snapshot> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => done(new Error(client.getSnapshot().notice ?? "The room didn't answer. Check your connection and try again.")), 15_000);
    const check = () => {
      const s = client.getSnapshot();
      if (ready(s)) done(null, s);
      else if (s.status === "not_found" || s.status === "outdated" || s.status === "left") done(new Error(`Couldn't join the room (${s.status}).`));
    };
    const unsubscribe = client.subscribe(check);
    function done(error: Error | null, s?: Snapshot) {
      clearTimeout(timer);
      unsubscribe();
      if (error) reject(error);
      else resolve(s!);
    }
    check();
  });
}
