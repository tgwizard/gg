import { type ReactNode, useLayoutEffect, useRef, useState } from "react";
import { hash2 } from "../../../ui";
import { type Card, rankLabel, rankName } from "../../kit/cards";
import { CardTable, PondSurface, type TableSeat } from "../../kit/ui/CardTable";
import { CardBack, CardFan, PlayingCard } from "../../kit/ui/Cards";
import { arrivalStyle, FLIGHT_SECONDS, type FlightPlan, Flights, rectOf, reducedMotion, seatRect, useFlights } from "../../kit/ui/Flights";
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
  const motion = useFishMotion(view, me);
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
          bookAt={(r) => motion.books.get(`${p.playerId}:${r}`)}
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
      ) : playing && view.you.seat !== null ? null : (
        // Once a game is on, open seats only matter to someone who could take one.
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
            <Lake count={view.lakeCount} splash={motion.splash} />
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
              {groupByRank(mine.hand!).map((group) => (
                // Cards of a rank sit together; three of a kind is one card short of a book.
                <div key={group[0]} className={`fish-group ${group.length === 3 ? "close" : ""}`}>
                  {group.length === 3 && <span className="fish-group-note">one more!</span>}
                  {group.map((c) => (
                    <button
                      key={c}
                      className="fish-card"
                      disabled={!ask || busy}
                      onClick={() => setPicked({ rank: c[0]!, target })}
                      aria-label={`${rankName(c[0]!)} of ${c[1]}`}
                      aria-pressed={rank === c[0]}
                      data-card={c}
                      style={arrivalStyle(motion.cards.get(c))}
                    >
                      <PlayingCard card={c} picked={rank === c[0]} />
                    </button>
                  ))}
                </div>
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
      <Flights flights={motion.flights} onLand={motion.land} />
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
  /** When a book that's on its way lands, in seconds. */
  bookAt(rank: string): number | undefined;
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
        <Books ranks={p.books} arriving={props.bookAt} />
        {turn && <TurnTimer deadline={view.turnDeadline} totalMs={awayOrClock(view, p.seat)} serverNow={props.serverNow} />}
      </PlayerPlate>
    </div>
  );
}

function Books({ ranks, arriving }: { ranks: string[]; arriving(rank: string): number | undefined }) {
  if (!ranks.length) return <div className="plate-line status">no books yet</div>;
  return (
    <div className="fish-books" title={`${ranks.length} ${ranks.length === 1 ? "book" : "books"}`}>
      {ranks.map((r) => (
        <span key={r} className="fish-book num" data-rank={r} style={bookPop(arriving(r))}>
          {rankLabel(r)}
        </span>
      ))}
    </div>
  );
}

/** A pond with face-down cards floating in it, scattered the same way every render. */
function Lake({ count, splash }: { count: number; splash: { key: number; at: number } | null }) {
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
      {splash && <div key={splash.key} className="fish-splash" style={{ animationDelay: `${splash.at}s` }} aria-hidden />}
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

// --- motion ------------------------------------------------------------------

const SUIT_ORDER = ["s", "h", "d", "c"];

/** Your hand (sorted by rank) in runs of one rank. */
function groupByRank(hand: Card[]): Card[][] {
  const groups: Card[][] = [];
  for (const c of hand) {
    if (groups.at(-1)?.[0]![0] === c[0]) groups.at(-1)!.push(c);
    else groups.push([c]);
  }
  return groups;
}

/** A book that's on its way pops into place when it lands. */
const bookPop = (at: number | undefined) => (at === undefined ? undefined : { animation: `book-pop 420ms cubic-bezier(.3,1.6,.5,1) ${at}s both` });

/**
 * Animates the events since the last view, one after the other, live only (a refresh
 * shows the table as it is): the deal, cards handed over after an ask, catches from
 * the lake (a splash for "Finns i sjön!"), and books laid down. What's coming to your
 * hand, and new books, show up as they land.
 */
function useFishMotion(view: FishView, me: string) {
  const { flights, launch, land } = useFlights();
  const [state, setState] = useState<{ cards: Map<Card, number>; books: Map<string, number>; splash: { key: number; at: number } | null }>({
    cards: new Map(),
    books: new Map(),
    splash: null,
  });
  const before = useRef<{ game: number; logged: number } | undefined>(undefined);

  useLayoutEffect(() => {
    const prev = before.current;
    before.current = { game: view.game, logged: view.logged };
    if (!prev || view.phase === "lobby" || reducedMotion()) return;
    const lake = rectOf('[data-testid="fish-lake"]');
    const hand = rectOf('[data-testid="fish-me"] .fish-hand');
    const seat = (id: string) => view.players.find((p) => p.playerId === id && !p.left)?.seat;
    const at = (id: string) => (id === me ? hand : seat(id) === undefined ? null : seatRect(seat(id)!));
    const myCard = (c: Card) => rectOf(`[data-testid="fish-me"] [data-card="${c}"]`) ?? hand;
    const mine = view.players.find((p) => p.playerId === me && !p.left);
    const cards = new Map<Card, number>();
    const books = new Map<string, number>();
    const plans: (FlightPlan | null)[] = [];
    let splash: { key: number; at: number } | null = null;
    let t = 0;
    const fly = (node: ReactNode, from: DOMRect | null, to: DOMRect | null, delay: number, card?: Card) => {
      plans.push(from && to ? { node, from, to, delay, duration: FLIGHT_SECONDS } : null);
      if (card && from && to) cards.set(card, delay + FLIGHT_SECONDS);
    };

    if (prev.game !== view.game) {
      // The deal: round after round from the lake, at most a few cards each.
      const dealt = view.players.filter((p) => !p.left);
      dealt.forEach((p, k) => {
        const yours = p.playerId === me ? (mine?.hand ?? []) : [];
        for (let i = 0; i < Math.min(p.cardCount, 7); i++) {
          const delay = (i * dealt.length + k) * 0.06;
          if (yours[i]) fly(<CardBack size="sm" />, lake, myCard(yours[i]!), delay, yours[i]);
          else fly(<CardBack size="sm" />, lake, at(p.playerId), delay);
        }
      });
    } else if (view.logged > prev.logged) {
      for (const e of view.log.slice(-Math.min(view.logged - prev.logged, view.log.length))) {
        if (e.type === "ask" && e.got > 0) {
          // Handed over in plain view.
          e.cards.forEach((c, i) => fly(<PlayingCard card={c} size="sm" />, at(e.to), e.from === me ? myCard(c) : at(e.from), t + i * 0.08, e.from === me ? c : undefined));
          t += 0.35 + e.cards.length * 0.08;
        } else if (e.type === "ask") {
          splash = { key: view.logged, at: t };
          t += 0.3;
        } else if (e.type === "fish" || e.type === "draw") {
          // Your own catch you see; someone else's only when it was what they asked for.
          const card = e.who === me ? (mine?.lastDrawn ?? null) : e.type === "fish" && e.lucky ? e.card : null;
          fly(card ? <PlayingCard card={card} size="sm" /> : <CardBack size="sm" />, lake, e.who === me && card ? myCard(card) : at(e.who), t, e.who === me && card ? card : undefined);
          t += 0.45;
        } else if (e.type === "book") {
          const to = seat(e.who) === undefined ? null : rectOf(`[data-seat="${seat(e.who)}"] .fish-book[data-rank="${e.rank}"]`);
          SUIT_ORDER.forEach((suit, i) => fly(<PlayingCard card={`${e.rank}${suit}`} size="xs" />, at(e.who), to, t + i * 0.06));
          if (to) books.set(`${e.who}:${e.rank}`, t + 0.18 + FLIGHT_SECONDS);
          t += 0.6;
        }
      }
    }
    launch(plans);
    setState({ cards, books, splash });
    // Only new events matter; the rest of the view is read as it is now.
  }, [view.game, view.logged]);

  return { flights, land, ...state };
}
