/**
 * /ui: every component in one place, for tuning the look without setting up a game.
 */
import { useState } from "react";
import { CardTable, type TableSeat } from "../../games/kit/ui/CardTable";
import { CardBack, CardFan, CardSlot, PlayingCard } from "../../games/kit/ui/Cards";
import { Bet, Chips, DealerButton, Pot } from "../../games/kit/ui/Chips";
import { ActionTray, GameLog, Herald } from "../../games/kit/ui/GameParts";
import { PlayerPlate } from "../../games/kit/ui/PlayerPlate";
import type { Felt } from "../../games/kit/ui/tableArt";
import { gameUIs } from "../../games/ui-registry";
import { ICONS, type IconName, Meter, Panel, PixelIcon, Spinner } from "../../ui";
import { GameCard } from "../components/GameCard";

const SWATCHES = ["paper", "paper-hi", "paper-lo", "line", "ink", "ink-2", "ink-3", "night", "night-2", "night-3", "gilt", "gilt-hi", "gilt-lo", "ember", "moss", "arcane", "water"];

export function StyleGuidePage() {
  const [felt, setFelt] = useState<Felt>("emerald");
  return (
    <div className="guide">
      <header className="guide-head on-night">
        <h1 className="display">gg · ui</h1>
        <p className="muted">Pixel art on parchment and ink, with a little gilt. Components live in src/ui and src/games/kit/ui.</p>
      </header>

      <main className="guide-main">
        <Section title="Type">
          <h1 className="display">Texas Hold'em</h1>
          <h2 className="display">Alice wins 1,240</h2>
          <p className="label">Silkscreen label · In this room · 3 online</p>
          <p className="num" style={{ fontSize: 28 }}>
            A K Q J 10 · 1,240 · 21:07
          </p>
          <p>JetBrains Mono for everything else. Make a room, share the link, play.</p>
        </Section>

        <Section title="Palette">
          <div className="guide-swatches">
            {SWATCHES.map((s) => (
              <div key={s} className="guide-swatch">
                <span style={{ background: `var(--${s})` }} />
                <code>--{s}</code>
              </div>
            ))}
          </div>
        </Section>

        <Section title="Buttons">
          <div className="row wrap">
            <button className="btn primary">Primary</button>
            <button className="btn">Default</button>
            <button className="btn danger">Danger</button>
            <button className="btn dark">Dark</button>
            <button className="btn ghost">Ghost</button>
            <button className="btn" disabled>
              Disabled
            </button>
            <button className="btn primary big">
              Big <PixelIcon name="arrow" />
            </button>
            <button className="btn small">
              <PixelIcon name="link" /> Small
            </button>
          </div>
          <div className="row wrap on-night guide-night">
            <button className="btn primary">Primary</button>
            <button className="btn">Default</button>
            <button className="btn dark">Dark</button>
            <button className="btn ghost">Ghost</button>
            <input placeholder="Input on night" />
          </div>
        </Section>

        <Section title="Panels & fields">
          <div className="guide-grid">
            <Panel title="A panel" icon="gem">
              <label className="field">
                <span>
                  Your name <span className="hint">up to 24 characters</span>
                </span>
                <input placeholder="e.g. Ada" />
              </label>
              <button className="btn primary">Save</button>
            </Panel>
            <Panel title="Night panel" icon="sparkle" night actions={<span className="label">3 online</span>}>
              <p>Panels take a title, an icon, and actions set into the border.</p>
              <Meter value={0.6} />
              <Meter value={0.2} low />
            </Panel>
          </div>
        </Section>

        <Section title="Small things">
          <div className="row wrap">
            <span className="tag">tag</span>
            <span className="tag gilt">you</span>
            <span className="tag arcane">bot</span>
            <span className="tag good">good</span>
            <span className="tag bad">bad</span>
            <span className="pill">
              <span className="light good" /> Connected
            </span>
            <span className="pill">
              <span className="light warn" /> Reconnecting
            </span>
            <span className="pill">
              <span className="light bad" /> Offline
            </span>
            <span className="code">7KQ2M9XH4D</span>
            <Spinner />
          </div>
          <div className="banner">Connection lost. Retrying in 3s…</div>
          <div className="banner bad">You're offline.</div>
          <div className="toast box tight on-night" style={{ alignSelf: "flex-start" }}>
            <PixelIcon name="warning" /> You're sending messages too fast.
          </div>
        </Section>

        <Section title="Icons">
          <div className="guide-icons">
            {(Object.keys(ICONS) as IconName[]).map((name) => (
              <div key={name} className="guide-icon">
                <PixelIcon name={name} scale={name.startsWith("emblem") ? 3 : 3} />
                <code>{name}</code>
              </div>
            ))}
          </div>
        </Section>

        <Section title="Game cards">
          <div className="game-grid">
            {Object.values(gameUIs).map((g, i) => (
              <GameCard key={g.meta.id} game={g} selected={i === 0} onClick={() => {}} />
            ))}
          </div>
        </Section>

        <Section title="Cards" night>
          <div className="row wrap guide-cards">
            <PlayingCard card="As" size="lg" />
            <PlayingCard card="Kh" size="lg" highlight />
            <PlayingCard card="Td" size="lg" />
            <PlayingCard card="7c" size="lg" picked />
            <CardBack size="lg" />
            <PlayingCard card="Qs" />
            <PlayingCard card="Jh" />
            <PlayingCard card="9d" dim />
            <CardBack />
            <CardSlot />
            <PlayingCard card="2c" size="sm" />
            <PlayingCard card="Ah" size="sm" />
            <CardBack size="sm" />
            <CardFan count={5} />
          </div>
          <div className="row wrap">
            <Chips amount={1240} />
            <Bet amount={40} />
            <Pot amount={385} />
            <DealerButton />
          </div>
        </Section>

        <Section title="Plates">
          <div className="row wrap guide-plates">
            <PlayerPlate playerId="a" name="Alice" you>
              <div className="plate-line">
                <Chips amount={980} />
              </div>
              <div className="plate-line status">Raised to 40</div>
            </PlayerPlate>
            <PlayerPlate playerId="b" name="Bob" active>
              <div className="plate-line">
                <Chips amount={1500} />
              </div>
              <Meter value={0.7} segments={10} />
            </PlayerPlate>
            <PlayerPlate playerId="c" name="Carol" online={false} dim>
              <div className="plate-line status">Folded</div>
            </PlayerPlate>
            <PlayerPlate playerId="d" name="Dave" winner>
              <div className="plate-line status good">Wins 385</div>
            </PlayerPlate>
            <PlayerPlate playerId="e" name="Eve" selectable selected onClick={() => {}}>
              <div className="plate-line status">selected</div>
            </PlayerPlate>
          </div>
        </Section>

        <Section title="Table">
          <div className="row">
            {(["emerald", "azure", "crimson"] as Felt[]).map((f) => (
              <button key={f} className={`btn small ${felt === f ? "primary" : ""}`} onClick={() => setFelt(f)}>
                {f}
              </button>
            ))}
          </div>
          <CardTable
            felt={felt}
            seats={demoSeats()}
            center={
              <>
                <div className="row">
                  <PlayingCard card="As" />
                  <PlayingCard card="Kh" />
                  <PlayingCard card="Td" />
                  <CardSlot />
                  <CardSlot />
                </div>
                <Pot amount={385} />
              </>
            }
          />
          <Herald>
            <span className="muted">Bob raised to 40.</span>
            <span>Carol folded.</span>
          </Herald>
          <ActionTray
            aside={
              <>
                <button className="btn ghost small">Sit out</button>
                <button className="btn ghost small">Leave seat</button>
              </>
            }
          >
            <button className="btn danger">Fold</button>
            <button className="btn">Call 40</button>
            <button className="btn primary">Raise to 80</button>
          </ActionTray>
          <GameLog title="Hand #12 log">
            <li>Alice posts 5</li>
            <li>Bob posts 10</li>
            <li>Carol folds</li>
          </GameLog>
        </Section>
      </main>
    </div>
  );
}

function demoSeats(): TableSeat[] {
  const people = [
    { id: "a", name: "Alice", stack: 980, status: "Raised to 40", me: true },
    { id: "b", name: "Bob", stack: 1500, active: true },
    null,
    { id: "c", name: "Carol", stack: 220, status: "Folded", dim: true },
    { id: "d", name: "Dave", stack: 3100 },
    { id: "e", name: "Eve", stack: 640, status: "Checked" },
  ];
  return people.map((p, i) => ({
    key: i,
    bet: p && i % 2 === 0 ? <Bet amount={40} /> : undefined,
    marker: i === 1 ? <DealerButton /> : undefined,
    node: p ? (
      <div className="seat-body">
        <div className="seat-cards">{p.me ? [<PlayingCard key="1" card="Ac" />, <PlayingCard key="2" card="Ad" />] : [<CardBack key="1" size="sm" />, <CardBack key="2" size="sm" />]}</div>
        <PlayerPlate playerId={p.id} name={p.name} you={p.me} active={p.active} dim={p.dim}>
          <div className="plate-line">
            <Chips amount={p.stack} />
          </div>
          {p.status && <div className="plate-line status">{p.status}</div>}
          {p.active && <Meter value={0.55} segments={10} />}
        </PlayerPlate>
      </div>
    ) : (
      <div className="seat-open">
        <button className="btn small">Sit here</button>
      </div>
    ),
  }));
}

function Section({ title, night, children }: { title: string; night?: boolean; children: React.ReactNode }) {
  return (
    <Panel title={title} night={night} className="guide-section">
      {children}
    </Panel>
  );
}
