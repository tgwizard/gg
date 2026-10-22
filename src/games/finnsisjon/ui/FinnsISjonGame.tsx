import { useState } from "react";
import { type Card, rankLabel, rankName } from "../../kit/cards";
import { CardBack, PlayingCard } from "../../kit/ui/Cards";
import { TurnTimer } from "../../kit/ui/TurnTimer";
import type { GameUIProps } from "../../ui";
import type { FishEvent, FishPlayerView, FishView } from "../engine";
import type { FishOp } from "../index";
import "./finnsisjon.css";

type Props = GameUIProps<FishView, FishOp>;

const SUITS: Record<string, string> = { s: "♠", h: "♥", d: "♦", c: "♣" };
const cardLabel = (c: Card) => `${rankLabel(c[0]!)}${SUITS[c[1]!]}`;

export function FinnsISjonGame({ view, me, members, connected, sendOp, serverNow }: Props) {
  const nameOf = (id: string) => (id === me ? "You" : (members.get(id)?.name ?? "Player"));
  const mine = view.players.find((p) => p.playerId === me && !p.left);
  const ask = view.you.ask;
  const [picked, setPicked] = useState<{ rank: string | null; target: string | null }>({ rank: null, target: null });
  // Drop choices that stopped being valid (cards changed hands, a player ran out).
  const rank = ask && picked.rank && ask.ranks.includes(picked.rank) ? picked.rank : null;
  const target = ask && (picked.target && ask.targets.includes(picked.target) ? picked.target : ask.targets.length === 1 ? ask.targets[0]! : null);
  const [busy, setBusy] = useState(false);

  const send = async (op: FishOp) => {
    setBusy(true);
    const ok = await sendOp(op);
    setBusy(false);
    if (ok && op.type === "ask") setPicked({ rank: null, target: null });
  };

  // Opponents in seat order, starting to your left.
  const n = view.seats.length;
  const from = mine?.seat ?? -1;
  const others = view.players
    .filter((p) => p !== mine)
    .sort((a, b) => ((a.seat - from + n) % n) - ((b.seat - from + n) % n));

  return (
    <div className="fish">
      {view.phase === "lobby" ? (
        <Seats view={view} me={me} nameOf={nameOf} connected={connected} send={send} />
      ) : (
        <>
          <div className="fish-opponents">
            {others.map((p) => (
              <Opponent
                key={`${p.seat}-${p.playerId}`}
                p={p}
                view={view}
                name={nameOf(p.playerId)}
                online={members.get(p.playerId)?.online ?? false}
                selectable={!!ask?.targets.includes(p.playerId)}
                selected={target === p.playerId}
                onSelect={() => setPicked({ rank, target: p.playerId })}
                serverNow={serverNow}
              />
            ))}
          </div>

          <Lake count={view.lakeCount} />
          <Happenings view={view} me={me} nameOf={nameOf} mine={mine} />

          {view.phase === "over" && view.result && <Result view={view} nameOf={nameOf} />}

          {mine && (
            <div className={`fish-me ${view.turn === mine.seat ? "turn" : ""}`} data-testid="fish-me">
              <div className="fish-me-head">
                <strong>Your hand</strong>
                <Books ranks={mine.books} />
                {view.turn === mine.seat && (
                  <TurnTimer deadline={view.turnDeadline} totalMs={awayOrClock(view, mine.seat)} serverNow={serverNow} />
                )}
              </div>
              <div className="fish-hand">
                {mine.hand!.map((c) => (
                  <button
                    key={c}
                    className={`fish-card ${rank === c[0] ? "picked" : ""}`}
                    disabled={!ask || busy}
                    onClick={() => setPicked({ rank: c[0]!, target })}
                    aria-label={`${rankName(c[0]!)} of ${c[1]}`}
                    data-card={c}
                  >
                    <PlayingCard card={c} />
                  </button>
                ))}
                {mine.hand!.length === 0 && <span className="muted">No cards.</span>}
              </div>
              <div className="fish-ask" data-testid="fish-ask">
                {ask ? (
                  <>
                    <span className="muted">
                      {!rank ? "Pick a card to ask for its rank" : !target ? "Now pick who to ask" : "Ready?"}
                    </span>
                    <button
                      className="btn primary"
                      disabled={!rank || !target || busy || !connected}
                      onClick={() => rank && target && send({ type: "ask", target, rank })}
                    >
                      {rank && target ? `Ask ${nameOf(target)} for ${rankName(rank, true)}` : "Ask"}
                    </button>
                  </>
                ) : (
                  view.phase === "playing" && <span className="muted">Waiting for {nameOf(view.players.find((p) => p.seat === view.turn && !p.left)?.playerId ?? "")}…</span>
                )}
              </div>
            </div>
          )}

          <Controls view={view} connected={connected} busy={busy} send={send} />
          {view.phase === "over" && <Seats view={view} me={me} nameOf={nameOf} connected={connected} send={send} />}
          <Log log={view.log} nameOf={nameOf} />
        </>
      )}
    </div>
  );
}

function awayOrClock(view: FishView, seat: number) {
  return view.seats[seat]?.sittingOut ? 2500 : view.config.turnSeconds * 1000;
}

function Opponent(props: {
  p: FishPlayerView;
  view: FishView;
  name: string;
  online: boolean;
  selectable: boolean;
  selected: boolean;
  onSelect(): void;
  serverNow: number;
}) {
  const { p, view } = props;
  const turn = view.turn === p.seat && !p.left && view.phase === "playing";
  const away = !p.left && view.seats[p.seat]?.playerId === p.playerId && view.seats[p.seat]!.sittingOut;
  const classes = ["fish-opp", turn && "turn", props.selected && "selected", props.selectable && "selectable", p.left && "left"].filter(Boolean).join(" ");
  return (
    <button className={classes} disabled={!props.selectable} onClick={props.onSelect} data-testid={`fish-opp-${p.seat}`}>
      <div className="fish-opp-name">
        {!props.online && !p.left && <span className="offline-dot" title="Disconnected" />}
        {props.name}
        {away && <span className="tag">away</span>}
        {p.left && <span className="tag">left</span>}
      </div>
      <div className="fish-fan" aria-label={`${p.cardCount} cards`}>
        {Array.from({ length: Math.min(p.cardCount, 8) }, (_, i) => (
          <CardBack key={i} />
        ))}
        {p.cardCount > 8 && <span className="fish-more">+{p.cardCount - 8}</span>}
        {p.cardCount === 0 && <span className="muted small">no cards</span>}
      </div>
      <Books ranks={p.books} />
      {turn && <TurnTimer deadline={view.turnDeadline} totalMs={awayOrClock(view, p.seat)} serverNow={props.serverNow} />}
    </button>
  );
}

function Books({ ranks }: { ranks: string[] }) {
  if (!ranks.length) return null;
  return (
    <div className="fish-books" title={`${ranks.length} books`}>
      {ranks.map((r) => (
        <span key={r} className="fish-book">
          {rankLabel(r)}
        </span>
      ))}
    </div>
  );
}

/** A pond of face-down cards, scattered the same way every render. */
function Lake({ count }: { count: number }) {
  const shown = Math.min(count, 16);
  return (
    <div className="fish-lake" data-testid="fish-lake">
      {Array.from({ length: shown }, (_, i) => {
        // Fixed pseudo-random scatter (multipliers coprime to the ranges).
        const x = 20 + ((i * 37) % 61);
        const y = 24 + ((i * 29) % 47);
        const rot = ((i * 47) % 71) - 35;
        return (
          <div key={i} className="fish-lake-card" style={{ left: `${x}%`, top: `${y}%`, transform: `translate(-50%, -50%) rotate(${rot}deg)` }}>
            <CardBack />
          </div>
        );
      })}
      <div className="fish-lake-label">{count ? `Sjön · ${count} cards` : "The lake is empty"}</div>
    </div>
  );
}

function describe(e: FishEvent, nameOf: (id: string) => string): string {
  const who = (id: string) => nameOf(id);
  const whom = (id: string) => (nameOf(id) === "You" ? "you" : nameOf(id));
  switch (e.type) {
    case "ask":
      return e.got > 0
        ? `${who(e.from)} asked ${whom(e.to)} for ${rankName(e.rank, true)} and got ${e.got}.`
        : `${who(e.from)} asked ${whom(e.to)} for ${rankName(e.rank, true)}. Finns i sjön! 🎣`;
    case "fish":
      return e.lucky ? `Lucky catch for ${whom(e.who)}: the ${cardLabel(e.card!)}! Another turn.` : `${who(e.who)} fished from the lake.`;
    case "draw":
      return `${who(e.who)} drew a card from the lake.`;
    case "book":
      return `${who(e.who)} laid down four ${rankName(e.rank, true)}! 📚`;
    case "left":
      return `${who(e.who)} left the game.`;
  }
}

/** The last couple of things that happened, big enough to follow at a glance. */
function Happenings({ view, me, nameOf, mine }: { view: FishView; me: string; nameOf(id: string): string; mine: FishPlayerView | undefined }) {
  const recent = view.log.slice(-2);
  if (!recent.length) return <div className="fish-news muted">Game {view.game} is dealt. Good luck!</div>;
  const last = recent.at(-1)!;
  // Your own catch is private: show it to you.
  const yourCatch = (last.type === "fish" || last.type === "draw") && last.who === me && mine?.lastDrawn ? mine.lastDrawn : null;
  return (
    <div className="fish-news" aria-live="polite" data-testid="fish-news">
      {recent.map((e, i) => (
        <div key={view.log.length - recent.length + i} className={i === recent.length - 1 ? "latest" : "muted"}>
          {describe(e, nameOf)}
        </div>
      ))}
      {yourCatch && !(last.type === "fish" && last.lucky) && (
        <div className="fish-catch">
          You drew <PlayingCard card={yourCatch} />
        </div>
      )}
    </div>
  );
}

function Result({ view, nameOf }: { view: FishView; nameOf(id: string): string }) {
  const result = view.result!;
  const ranking = [...view.players].sort((a, b) => b.books.length - a.books.length);
  return (
    <div className="fish-result" data-testid="fish-result">
      <h3>{result.winners.length === 1 ? `${nameOf(result.winners[0]!)} won!` : `${result.winners.map(nameOf).join(" & ")} share the win!`}</h3>
      <ol>
        {ranking.map((p) => (
          <li key={`${p.seat}-${p.playerId}`}>
            {nameOf(p.playerId)}: {p.books.length} {p.books.length === 1 ? "book" : "books"}
            {p.left && <span className="muted"> (left)</span>}
          </li>
        ))}
      </ol>
    </div>
  );
}

function Seats({ view, me, nameOf, connected, send }: { view: FishView; me: string; nameOf(id: string): string; connected: boolean; send(op: FishOp): void }) {
  const seated = view.you.seat !== null;
  return (
    <div className="fish-seats">
      <h3>{view.phase === "lobby" ? "Take a seat" : "At the table for the next game"}</h3>
      <div className="fish-seat-grid">
        {view.seats.map((s, i) => (
          <div key={i} className={`fish-seat ${s?.playerId === me ? "me" : ""}`} data-testid={`fish-seat-${i}`}>
            {s ? (
              <>
                <strong>{nameOf(s.playerId)}</strong>
                <span className="muted small">
                  {s.gamesWon} {s.gamesWon === 1 ? "win" : "wins"}
                  {s.sittingOut ? " · away" : ""}
                </span>
              </>
            ) : seated ? (
              <span className="muted small">Empty</span>
            ) : (
              <button className="btn small" disabled={!connected} onClick={() => send({ type: "sit", seat: i })}>
                Sit here
              </button>
            )}
          </div>
        ))}
      </div>
      {view.phase === "lobby" && <Controls view={view} connected={connected} busy={false} send={send} />}
    </div>
  );
}

function Controls({ view, connected, busy, send }: { view: FishView; connected: boolean; busy: boolean; send(op: FishOp): void }) {
  const seat = view.you.seat;
  const s = seat === null ? null : view.seats[seat];
  const disabled = busy || !connected;
  return (
    <div className="fish-controls">
      {view.canStart && s && (
        <button className="btn primary" disabled={disabled} onClick={() => send({ type: "start" })}>
          {view.game === 0 ? "Deal" : "Play again"}
        </button>
      )}
      {s &&
        (s.sittingOut ? (
          <button className="btn" disabled={disabled} onClick={() => send({ type: "sitIn" })}>
            I'm back
          </button>
        ) : (
          view.phase === "playing" &&
          view.you.inGame && (
            <button className="btn ghost small" disabled={disabled} onClick={() => send({ type: "sitOut" })}>
              Step away
            </button>
          )
        ))}
      {s && (
        <button className="btn ghost small" disabled={disabled} onClick={() => send({ type: "leave" })}>
          {view.phase === "playing" && view.you.inGame ? "Leave game" : "Leave seat"}
        </button>
      )}
      {!s && view.phase === "playing" && <span className="muted">You're watching. Grab a seat to play the next game.</span>}
      {s && !view.you.inGame && view.phase === "playing" && <span className="muted">You're in the next game.</span>}
      {view.seats.filter(Boolean).length < 2 && <span className="muted">Waiting for players to sit down…</span>}
    </div>
  );
}

function Log({ log, nameOf }: { log: FishEvent[]; nameOf(id: string): string }) {
  if (!log.length) return null;
  return (
    <details className="fish-log">
      <summary>What happened</summary>
      <ol>
        {log.map((e, i) => (
          <li key={i}>{describe(e, nameOf)}</li>
        ))}
      </ol>
    </details>
  );
}
