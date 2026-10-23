import { useState } from "react";
import { hash2 } from "../../../ui";
import { type Card, rankLabel, rankName } from "../../kit/cards";
import { CardTable, PondSurface, type TableSeat } from "../../kit/ui/CardTable";
import { CardBack, CardFan, PlayingCard } from "../../kit/ui/Cards";
import { ActionTray, GameLog, Herald, TableFooter } from "../../kit/ui/GameParts";
import { PlayerPlate } from "../../kit/ui/PlayerPlate";
import { TurnTimer } from "../../kit/ui/TurnTimer";
import type { GameUIProps } from "../../ui";
import { AUTO_PLAY_DELAY_MS, type FishEvent, type FishPlayerView, type FishView } from "../engine";
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

  const playing = view.phase !== "lobby";
  const seats: TableSeat[] = view.seats.map((seat, i) => {
    const p = playing ? view.players.find((x) => x.seat === i && !x.left) : undefined;
    const isMe = (p?.playerId ?? seat?.playerId) === me;
    return {
      key: i,
      testId: `fish-seat-${i}`,
      className: isMe ? "me" : undefined,
      node: p ? (
        <InGamePlate
          p={p}
          view={view}
          isMe={isMe}
          name={members.get(p.playerId)?.name ?? "Player"}
          online={members.get(p.playerId)?.online ?? false}
          selectable={!!ask?.targets.includes(p.playerId)}
          selected={target === p.playerId}
          onSelect={() => setPicked({ rank, target: p.playerId })}
          serverNow={serverNow}
        />
      ) : seat ? (
        <PlayerPlate
          playerId={seat.playerId}
          name={members.get(seat.playerId)?.name ?? "Player"}
          you={isMe}
          online={members.get(seat.playerId)?.online ?? false}
          dim={seat.sittingOut}
        >
          <div className="plate-line status">
            {seat.gamesWon} {seat.gamesWon === 1 ? "win" : "wins"}
            {seat.sittingOut ? " · away" : view.phase === "playing" ? " · next game" : ""}
          </div>
        </PlayerPlate>
      ) : (
        <div className="seat-open">
          {view.you.seat === null ? (
            <button className="btn small" disabled={!connected} onClick={() => send({ type: "sit", seat: i })}>
              Sit here
            </button>
          ) : (
            <span className="label">Open seat</span>
          )}
        </div>
      ),
    };
  });

  return (
    <div className="fish">
      <CardTable
        seats={seats}
        center={
          playing ? (
            <Lake count={view.lakeCount} />
          ) : (
            <div className="fish-center-msg">
              <p className="display">Finns i sjön</p>
              <p>{view.seats.filter(Boolean).length < 2 ? "Take a seat. Two to six can play." : "Deal when everyone's seated."}</p>
            </div>
          )
        }
      />

      {view.phase === "over" && view.result ? <Result view={view} nameOf={nameOf} /> : playing && <Happenings view={view} me={me} nameOf={nameOf} mine={mine} />}

      <ActionTray aside={<Controls view={view} connected={connected} busy={busy} send={send} />} testId="fish-tray">
        {mine && view.phase === "playing" ? (
          <div className="fish-me" data-testid="fish-me">
            <div className="fish-hand">
              {mine.hand!.map((c) => (
                <button
                  key={c}
                  className="fish-card"
                  disabled={!ask || busy}
                  onClick={() => setPicked({ rank: c[0]!, target })}
                  aria-label={`${rankName(c[0]!)} of ${c[1]}`}
                  aria-pressed={rank === c[0]}
                  data-card={c}
                >
                  <PlayingCard card={c} picked={rank === c[0]} />
                </button>
              ))}
              {mine.hand!.length === 0 && <span className="muted">No cards in hand.</span>}
            </div>
            <div className="fish-ask" data-testid="fish-ask">
              {ask ? (
                <>
                  <button
                    className="btn primary"
                    disabled={!rank || !target || busy || !connected}
                    onClick={() => rank && target && send({ type: "ask", target, rank })}
                  >
                    {rank && target ? `Ask ${nameOf(target)} for ${rankName(rank, true)}` : "Ask"}
                  </button>
                  {(!rank || !target) && <span className="fish-hint">{!rank ? "Pick a card: you'll ask for that rank." : "Now pick who to ask (click their seat)."}</span>}
                </>
              ) : (
                <span className="muted">Waiting for {nameOf(view.players.find((p) => p.seat === view.turn && !p.left)?.playerId ?? "")}…</span>
              )}
            </div>
          </div>
        ) : (
          <Status view={view} />
        )}
      </ActionTray>

      <TableFooter
        log={
          view.log.length > 0 && (
            <GameLog title="What happened">
              {view.log.map((e, i) => (
                <li key={i}>{describe(e, nameOf)}</li>
              ))}
            </GameLog>
          )
        }
        actions={<SeatActions view={view} connected={connected} busy={busy} send={send} />}
      />
    </div>
  );
}

function awayOrClock(view: FishView, seat: number) {
  return view.seats[seat]?.sittingOut ? AUTO_PLAY_DELAY_MS : view.config.turnSeconds * 1000;
}

function InGamePlate(props: {
  p: FishPlayerView;
  view: FishView;
  isMe: boolean;
  name: string;
  online: boolean;
  selectable: boolean;
  selected: boolean;
  onSelect(): void;
  serverNow: number;
}) {
  const { p, view } = props;
  const turn = view.turn === p.seat && view.phase === "playing";
  const away = view.seats[p.seat]?.playerId === p.playerId && view.seats[p.seat]!.sittingOut;
  const won = view.phase === "over" && !!view.result?.winners.includes(p.playerId);
  return (
    <div className="fish-spot">
      {!props.isMe && (
        <div className="fish-fan">{p.cardCount > 0 ? <CardFan count={p.cardCount} /> : <span className="label">no cards</span>}</div>
      )}
      <PlayerPlate
        playerId={p.playerId}
        name={props.name}
        you={props.isMe}
        online={props.online}
        active={turn}
        dim={away}
        winner={won}
        selectable={props.selectable}
        selected={props.selected}
        onClick={props.isMe ? undefined : props.onSelect}
        className={props.isMe ? undefined : "fish-opp"}
        tags={away && <span className="tag">away</span>}
      >
        <Books ranks={p.books} />
        {turn && <TurnTimer deadline={view.turnDeadline} totalMs={awayOrClock(view, p.seat)} serverNow={props.serverNow} />}
      </PlayerPlate>
    </div>
  );
}

function Books({ ranks }: { ranks: string[] }) {
  if (!ranks.length) return <div className="plate-line status">no books yet</div>;
  return (
    <div className="fish-books" title={`${ranks.length} ${ranks.length === 1 ? "book" : "books"}`}>
      {ranks.map((r) => (
        <span key={r} className="fish-book num">
          {rankLabel(r)}
        </span>
      ))}
    </div>
  );
}

/** A pond with face-down cards floating in it, scattered the same way every render. */
function Lake({ count }: { count: number }) {
  const shown = Math.min(count, 14);
  return (
    <div className="fish-lake" data-testid="fish-lake">
      <PondSurface />
      {Array.from({ length: shown }, (_, i) => {
        // A fixed pseudo-random scatter, the same on every render.
        const x = 18 + hash2(i, 1) * 64;
        const y = 24 + hash2(i, 2) * 50;
        return (
          <div key={i} className="fish-lake-card" style={{ left: `${x}%`, top: `${y}%` }}>
            <CardBack size="sm" />
          </div>
        );
      })}
      <div className="fish-lake-label label">{count ? `Sjön · ${count} cards` : "The lake is empty"}</div>
    </div>
  );
}

function describe(e: FishEvent, nameOf: (id: string) => string): string {
  const who = (id: string) => nameOf(id);
  const whom = (id: string) => (nameOf(id) === "You" ? "you" : nameOf(id));
  switch (e.type) {
    case "ask":
      return e.got > 0
        ? `${who(e.from)} asked ${whom(e.to)} for ${rankName(e.rank, true)} and got ${e.cards.map(cardLabel).join(" ")}.`
        : `${who(e.from)} asked ${whom(e.to)} for ${rankName(e.rank, true)}. Finns i sjön!`;
    case "fish":
      return e.lucky ? `Lucky catch for ${whom(e.who)}: the ${cardLabel(e.card!)}! Another turn.` : `${who(e.who)} fished from the lake.`;
    case "draw":
      return `${who(e.who)} drew a card from the lake.`;
    case "book":
      return `${who(e.who)} laid down four ${rankName(e.rank, true)}!`;
    case "left":
      return `${who(e.who)} left the game.`;
  }
}

/** One event, with the cards drawn when you're allowed to see them. */
function Story({ e, nameOf }: { e: FishEvent; nameOf(id: string): string }) {
  const whom = (id: string) => (nameOf(id) === "You" ? "you" : nameOf(id));
  const cards = (cs: Card[]) => (
    <span className="fish-cards">
      {cs.map((c) => (
        <PlayingCard key={c} card={c} size="xs" />
      ))}
    </span>
  );
  if (e.type === "ask" && e.got > 0) {
    return (
      <>
        {nameOf(e.from)} asked {whom(e.to)} for {rankName(e.rank, true)} and got {cards(e.cards)}
      </>
    );
  }
  if (e.type === "fish" && e.lucky && e.card) {
    return (
      <>
        Lucky catch for {whom(e.who)}: {cards([e.card])} Another turn!
      </>
    );
  }
  return <>{describe(e, nameOf)}</>;
}

/** The last couple of things that happened, big enough to follow at a glance. */
function Happenings({ view, me, nameOf, mine }: { view: FishView; me: string; nameOf(id: string): string; mine: FishPlayerView | undefined }) {
  const recent = view.log.slice(-2);
  if (!recent.length) {
    return (
      <Herald testId="fish-news" className="fish-news">
        <span>Game {view.game} is dealt. Good luck!</span>
      </Herald>
    );
  }
  const last = recent.at(-1)!;
  // Your own catch is private: show it to you.
  const yourCatch = (last.type === "fish" || last.type === "draw") && last.who === me && mine?.lastDrawn ? mine.lastDrawn : null;
  return (
    <Herald testId="fish-news" className="fish-news">
      {recent.length > 1 && <span className="muted">{describe(recent[0]!, nameOf)}</span>}
      <span className="fish-latest">
        <Story e={last} nameOf={nameOf} />
        {yourCatch && !(last.type === "fish" && last.lucky) && (
          <span className="fish-catch">
            You drew <PlayingCard card={yourCatch} size="xs" />
          </span>
        )}
      </span>
    </Herald>
  );
}

function Result({ view, nameOf }: { view: FishView; nameOf(id: string): string }) {
  const result = view.result!;
  const ranking = [...view.players].sort((a, b) => b.books.length - a.books.length);
  return (
    <div data-testid="fish-result">
      <Herald big>
        <span>{result.winners.length === 1 ? `${nameOf(result.winners[0]!)} won!` : `${result.winners.map(nameOf).join(" & ")} share the win!`}</span>
        <span className="fish-ranking">
          {ranking.map((p) => (
            <span key={`${p.seat}-${p.playerId}`}>
              {nameOf(p.playerId)}: {p.books.length} {p.books.length === 1 ? "book" : "books"}
              {p.left ? " (left)" : ""}
            </span>
          ))}
        </span>
      </Herald>
    </div>
  );
}

function Status({ view }: { view: FishView }) {
  const seat = view.you.seat;
  const s = seat === null ? null : view.seats[seat];
  if (view.seats.filter(Boolean).length < 2) return <span className="muted">Waiting for players to sit down…</span>;
  if (!s && view.phase === "playing") return <span className="muted">You're watching. Take an open seat to play the next game.</span>;
  if (s && !view.you.inGame && view.phase === "playing") return <span className="muted">You're in the next game.</span>;
  if (!s) return <span className="muted">Take an open seat to play.</span>;
  return null;
}

/** The big buttons: deal, play again, come back. */
function Controls({ view, connected, busy, send }: { view: FishView; connected: boolean; busy: boolean; send(op: FishOp): void }) {
  const seat = view.you.seat;
  const s = seat === null ? null : view.seats[seat];
  const disabled = busy || !connected;
  if (!s) return null;
  return (
    <>
      {view.canStart && (
        <button className="btn primary" disabled={disabled} onClick={() => send({ type: "start" })}>
          {view.game === 0 ? "Deal" : "Play again"}
        </button>
      )}
      {s.sittingOut && (
        <button className="btn" disabled={disabled} onClick={() => send({ type: "sitIn" })}>
          I'm back
        </button>
      )}
    </>
  );
}

/** Quiet housekeeping under the table: step away, leave. */
function SeatActions({ view, connected, busy, send }: { view: FishView; connected: boolean; busy: boolean; send(op: FishOp): void }) {
  const seat = view.you.seat;
  const s = seat === null ? null : view.seats[seat];
  const disabled = busy || !connected;
  if (!s) return null;
  return (
    <>
      {!s.sittingOut && view.phase === "playing" && view.you.inGame && (
        <button className="btn ghost small" disabled={disabled} onClick={() => send({ type: "sitOut" })}>
          Step away
        </button>
      )}
      <button className="btn ghost small" disabled={disabled} onClick={() => send({ type: "leave" })}>
        {view.phase === "playing" && view.you.inGame ? "Leave game" : "Leave seat"}
      </button>
    </>
  );
}
