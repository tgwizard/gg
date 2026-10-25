import { type CSSProperties, type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { play, useNarrow } from "../../../ui";
import { type Card, rankValue } from "../../kit/cards";
import { CardTable, type TableSeat } from "../../kit/ui/CardTable";
import { CardBack, CardFan, PlayingCard } from "../../kit/ui/Cards";
import { DealerButton } from "../../kit/ui/Chips";
import { arrivalStyle, FLIGHT_SECONDS, type FlightPlan, Flights, rectOf, reducedMotion, seatRect, useFlights } from "../../kit/ui/Flights";
import { GameOver } from "../../kit/ui/GameOver";
import { ActionTray, GameLog, Herald, TableFooter } from "../../kit/ui/GameParts";
import { PlayerPlate } from "../../kit/ui/PlayerPlate";
import { TurnTimer } from "../../kit/ui/TurnTimer";
import { useSend } from "../../kit/ui/useSend";
import type { GameUIProps } from "../../ui";
import { AUTO_PLAY_DELAY_MS, type FemEvent, type FemPlayerView, type FemView, type Trick } from "../engine";
import type { FemOp } from "../index";
import { cardText, HAND_SIZE, type Play, suitName, suitSymbol, winningPlay } from "../rules";
import "./femkort.css";

type Props = GameUIProps<FemView, FemOp>;

export function FemKortGame({ view, me, members, connected, sendOp, serverNow }: Props) {
  const narrow = useNarrow();
  const name = (id: string) => members.get(id)?.name ?? "Player";
  /** "You" for you, for the start of a sentence. */
  const who = (id: string) => (id === me ? "You" : name(id));
  const { busy, send } = useSend(sendOp);

  const playing = view.phase !== "lobby";
  const mine = view.players.find((p) => p.playerId === me && !p.left);
  // Once a game is on, the table closes up around who's playing (open seats only matter to someone watching).
  const compact = playing && view.you.seat !== null;
  const order = view.seats.flatMap((s, i) => (!compact || s ? [i] : []));
  const motion = useFemMotion(view, me, (seat) => order.indexOf(seat));

  // The cards in front of each seat: the trick being played, or the one just taken (until it's gathered, or the next deal).
  const shown: { plays: Play[]; winner: number | null } | null = view.trick.length
    ? { plays: view.trick, winner: null }
    : (motion.held ?? (view.dealOver ? view.tricks.at(-1)! : null));
  const leading = shown && shown.winner === null ? winningPlay(shown.plays) : null;
  const lastTrick = view.phase === "playing" && (view.trickNo === HAND_SIZE || view.dealOver);

  // Your card leaves your hand at once; it's back if the server says no.
  const [pending, setPending] = useState<Card | null>(null);
  const hand = (mine?.hand ?? []).filter((c) => c !== pending);
  useEffect(() => setPending(null), [mine?.hand?.length, view.deal]);
  const playCard = async (card: Card, el: HTMLElement) => {
    motion.leaving.current = { card, rect: el.getBoundingClientRect() };
    setPending(card);
    if (!(await send({ type: "play", card }))) setPending(null);
  };

  const seats: TableSeat[] = order.map((i) => {
    const seat = view.seats[i]!;
    const p = playing ? view.players.find((x) => x.seat === i && !x.left) : undefined;
    const isMe = (p?.playerId ?? seat?.playerId) === me;
    const card = shown?.plays.find((x) => x.seat === i);
    const took = !!card && shown!.winner === i;
    return {
      key: i,
      testId: `fem-seat-${i}`,
      className: isMe ? "me" : undefined,
      bet: card && (
        <span
          className={`fem-played ${took ? "took" : ""} ${took && view.dealOver ? "deal" : ""}`}
          style={arrivalStyle(motion.arrivals.get(card.card))}
          data-testid={`fem-played-${i}`}
        >
          <PlayingCard card={card.card} size={narrow ? "sm" : "md"} highlight={took || leading?.seat === i} />
        </span>
      ),
      node: p ? (
        <InGamePlate
          p={p}
          view={view}
          isMe={isMe}
          name={name(p.playerId)}
          online={members.get(p.playerId)?.online ?? false}
          serverNow={serverNow}
          starAt={motion.star?.playerId === p.playerId ? motion.star.at : undefined}
        />
      ) : seat ? (
        <PlayerPlate playerId={seat.playerId} name={name(seat.playerId)} you={isMe} online={members.get(seat.playerId)?.online ?? false} dim={seat.sittingOut}>
          <div className="plate-line status">
            {seat.gamesWon} {seat.gamesWon === 1 ? "win" : "wins"}
            {seat.sittingOut ? " · away" : view.phase === "playing" ? " · next deal" : ""}
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
    <div className="fem">
      <CardTable
        className={`fem-table ${lastTrick ? "fem-last" : ""}`}
        seats={seats}
        // Played cards are big: in toward the middle, clear of each seat's hand.
        betAt={0.48}
        testId="fem-table"
        center={
          <div className="fem-center" data-testid="fem-center">
            {playing ? (
              <Center view={view} who={who} live={motion.lastLive} />
            ) : (
              <>
                <p className="display fem-title">Fem kort</p>
                <p>{view.seats.filter(Boolean).length < 2 ? "Take a seat. Two to six can play." : "Deal when everyone's seated."}</p>
              </>
            )}
          </div>
        }
      />

      {playing && view.phase === "playing" && <News view={view} me={me} who={who} />}
      <Result
        view={view}
        me={me}
        name={name}
        start={view.canStart && view.you.seat !== null ? () => send({ type: "start" }) : null}
        disabled={busy || !connected}
      />

      {!(view.phase === "over" && view.you.seat !== null) && (
        <ActionTray aside={<Controls view={view} connected={connected} busy={busy} send={send} />} testId="fem-tray">
          {mine && view.phase === "playing" ? (
            <div className="fem-me" data-testid="fem-me">
              <Hint view={view} me={me} who={who} hand={mine.hand ?? []} serverNow={serverNow} />
              <div className={`fem-hand ${view.you.playable ? "your-turn" : ""}`}>
                {hand.map((c) => {
                  const ok = !!view.you.playable?.includes(c);
                  const restricted = !!view.you.playable && view.you.playable.length < (mine.hand?.length ?? 0);
                  return (
                    <button
                      key={c}
                      className="fem-card"
                      disabled={!ok || busy || !connected}
                      onClick={(e) => playCard(c, e.currentTarget)}
                      aria-label={`Play ${cardText(c)}`}
                      data-card={c}
                      data-playable={ok || undefined}
                      style={arrivalStyle(motion.arrivals.get(c))}
                    >
                      <PlayingCard card={c} size={narrow ? "md" : "lg"} dim={!!view.you.playable && !ok} highlight={restricted && ok} />
                    </button>
                  );
                })}
                {hand.length === 0 && !view.dealOver && <span className="muted">No cards in hand.</span>}
              </div>
              <VoteBar view={view} who={who} me={me} busy={busy || !connected} send={send} serverNow={serverNow} />
            </div>
          ) : (
            <Status view={view} />
          )}
        </ActionTray>
      )}

      <TableFooter
        log={
          view.log.length > 0 && (
            <GameLog title="What happened">
              {view.log.map((e, i) => (
                <li key={i}>{describe(e, who)}</li>
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

// --- the table ----------------------------------------------------------------

function InGamePlate(props: { p: FemPlayerView; view: FemView; isMe: boolean; name: string; online: boolean; serverNow: number; starAt?: number }) {
  const { p, view } = props;
  const turn = view.turn === p.seat && view.phase === "playing" && !view.vote;
  const seat = view.seats[p.seat];
  const away = seat?.playerId === p.playerId && seat.sittingOut;
  const won = view.phase === "over" && !!view.result?.winners.includes(p.playerId);
  const asking = view.vote?.by === p.playerId;
  const answering = view.vote?.waiting.includes(p.playerId);
  return (
    <div className="fem-spot">
      {!props.isMe && <div className="fem-fan">{p.cardCount > 0 ? <CardFan count={p.cardCount} max={5} /> : null}</div>}
      <PlayerPlate
        playerId={p.playerId}
        name={props.name}
        you={props.isMe}
        online={props.online}
        active={turn || !!answering}
        dim={away}
        winner={won}
        tags={away && <span className="tag">away</span>}
      >
        <Stars won={p.deals} of={view.config.dealsToWin} popAt={props.starAt} dealer={view.phase === "playing" && view.dealer === p.seat} />
        {asking && <div className="plate-line status good">wants new cards</div>}
        {view.vote?.yes.includes(p.playerId) && <div className="plate-line status good">yes, deal again</div>}
        {turn && <TurnTimer deadline={view.turnDeadline} totalMs={away ? AUTO_PLAY_DELAY_MS : view.config.turnSeconds * 1000} serverNow={props.serverNow} />}
      </PlayerPlate>
    </div>
  );
}

/** Deals won, out of the deals it takes: filled stars, the newest popping in as the deal is won. */
function Stars({ won, of, popAt, dealer }: { won: number; of: number; popAt?: number; dealer: boolean }) {
  return (
    <div className="plate-line fem-stars" title={`${won} of ${of} ${of === 1 ? "deal" : "deals"} won`} data-deals={won}>
      {dealer && <DealerButton />}
      {Array.from({ length: Math.max(of, won) }, (_, i) => (
        <span key={i} className={`fem-star ${i < won ? "on" : ""}`} style={i === won - 1 && popAt !== undefined ? ({ "--pop-at": `${popAt}s` } as CSSProperties) : undefined} data-pop={i === won - 1 && popAt !== undefined ? "" : undefined}>
          ★
        </span>
      ))}
    </div>
  );
}

/** The middle of the table: five tricks as pips (the last one gold), and what's going on. */
function Center({ view, who, live }: { view: FemView; who(id: string): string; live: boolean }) {
  const done = view.tricks.length;
  const winner = view.dealOver ? view.tricks.at(-1)?.plays.find((p) => p.seat === view.tricks.at(-1)!.winner) : undefined;
  return (
    <>
      <ol className="fem-pips" aria-label={`Trick ${view.trickNo} of ${HAND_SIZE}`}>
        {Array.from({ length: HAND_SIZE }, (_, i) => (
          <li key={i} className={`fem-pip ${i < done ? "done" : ""} ${i === done && !view.dealOver ? "now" : ""} ${i === HAND_SIZE - 1 ? "last" : ""}`}>
            {i === HAND_SIZE - 1 ? "★" : i + 1}
          </li>
        ))}
      </ol>
      {view.phase === "over" ? (
        <p className="fem-center-line">Game over</p>
      ) : view.dealOver && winner ? (
        <p className="fem-center-line fem-deal-won" data-testid="fem-deal-won">
          <strong className="display">{who(winner.playerId)}</strong> {who(winner.playerId) === "You" ? "win" : "wins"} deal {view.deal}
        </p>
      ) : view.trickNo === HAND_SIZE ? (
        <p key={view.deal} className={`fem-center-line fem-last-label display ${live ? "pop" : ""}`} data-testid="fem-last-trick">
          Last trick!
        </p>
      ) : (
        <p className="fem-center-line label">
          Deal {view.deal} · trick {view.trickNo} of {HAND_SIZE}
        </p>
      )}
      {view.led && !view.dealOver && (
        <p className={`fem-led ${view.led === "h" || view.led === "d" ? "red" : ""}`} data-testid="fem-led">
          <span className="fem-led-suit">{suitSymbol(view.led)}</span> led
        </p>
      )}
    </>
  );
}

/** What just happened, in a line. */
function News({ view, me, who }: { view: FemView; me: string; who(id: string): string }) {
  const whom = (id: string) => (id === me ? "you" : who(id));
  const last = view.log.at(-1);
  let text: ReactNode;
  if (view.vote) {
    text = (
      <>
        <strong>{who(view.vote.by)}</strong> {view.vote.by === me ? "ask" : "asks"} for better cards. {view.vote.by === me ? "Waiting for the others…" : "Deal again?"}
      </>
    );
  } else if (view.dealOver) {
    const t = view.tricks.at(-1)!;
    const win = t.plays.find((p) => p.seat === t.winner)!;
    text = (
      <>
        <strong>{who(win.playerId)}</strong> took the last trick with <InlineCard card={win.card} /> and {win.playerId === me ? "win" : "wins"} deal {view.deal}!
      </>
    );
  } else if (view.trick.length === 0 && last?.type === "vote" && !last.passed && last.deal === view.deal) {
    text = last.against.length ? <>{last.against.map(who).join(" & ")} said no to new cards: play on.</> : <>No new cards: play on.</>;
  } else if (view.trick.length === 0 && view.tricks.length === 0) {
    const lead = view.players.find((p) => p.seat === view.turn);
    const dealer = view.players.find((p) => p.seat === view.dealer);
    text = (
      <>
        Deal {view.deal}. {dealer ? `${who(dealer.playerId)} dealt; ` : ""}
        {lead && (lead.playerId === me ? "your lead." : `${who(lead.playerId)} leads.`)}
      </>
    );
  } else if (view.trick.length === 0) {
    const t = view.tricks.at(-1)!;
    const win = t.plays.find((p) => p.seat === t.winner)!;
    const next = view.tricks.length === HAND_SIZE - 1 ? "the last trick" : `trick ${view.tricks.length + 1}`;
    text = (
      <>
        <strong>{who(win.playerId)}</strong> took trick {view.tricks.length} with <InlineCard card={win.card} /> and {win.playerId === me ? "lead" : "leads"} {next}.
      </>
    );
  } else {
    const lead = view.trick[0]!;
    const best = winningPlay(view.trick)!;
    text = (
      <>
        {who(lead.playerId)} led <InlineCard card={lead.card} />
        {view.trick.length > 1 &&
          (best === lead ? (
            <>, still the best.</>
          ) : (
            <>
              ; {whom(best.playerId) === "you" ? "your" : `${who(best.playerId)}'s`} <InlineCard card={best.card} /> is winning.
            </>
          ))}
      </>
    );
  }
  return (
    <Herald testId="fem-news" className={`fem-news ${view.trickNo === HAND_SIZE || view.dealOver ? "last" : ""}`}>
      <span className="fem-news-line">{text}</span>
    </Herald>
  );
}

function InlineCard({ card }: { card: Card }) {
  return (
    <span className="fem-inline-card">
      <PlayingCard card={card} size="xs" />
    </span>
  );
}

// --- your hand ------------------------------------------------------------------

/** Whose turn it is and what you must do: the suit to follow, and whether you must beat. */
function Hint({ view, me, who, hand, serverNow }: { view: FemView; me: string; who(id: string): string; hand: Card[]; serverNow: number }) {
  const last = view.trickNo === HAND_SIZE;
  let text: ReactNode;
  if (view.dealOver) {
    const secs = view.nextDealAt ? Math.max(0, Math.ceil((view.nextDealAt - serverNow) / 1000)) : null;
    text = <>Next deal{secs !== null ? ` in ${secs}s` : ""}…</>;
  } else if (view.vote) {
    text = view.vote.by === me ? <>You asked for better cards. Waiting for the others…</> : <>{who(view.vote.by)} asks for better cards.</>;
  } else if (view.you.playable) {
    const led = view.led;
    const best = winningPlay(view.trick);
    const suit = led && hand.some((c) => c[1] === led);
    if (!led) {
      text = last ? (
        <>
          <strong>Your lead to the last trick.</strong> It takes the deal unless someone beats it in its suit.
        </>
      ) : (
        <>
          <strong>Your lead:</strong> any card.{view.trickNo === HAND_SIZE - 1 ? " Take this trick and you lead the last one." : " Keep a strong card for the last trick."}
        </>
      );
    } else if (!suit) {
      text = (
        <>
          <strong>No {suitName(led)}:</strong> play any card.{last ? " It can't take the trick." : ""}
        </>
      );
    } else if (view.config.mustBeat && best && canBeat(hand, led, best.card)) {
      text = (
        <>
          <strong>
            Follow {suitName(led)} and beat the {cardText(best.card)}:
          </strong>{" "}
          you have to if you can.
        </>
      );
    } else {
      text = (
        <>
          <strong>Follow {suitName(led)}</strong>
          {best && view.config.mustBeat ? `: you can't beat the ${cardText(best.card)}.` : "."}
        </>
      );
    }
    if (last && led) {
      text = (
        <>
          <span className="fem-hint-last">Last trick!</span> {text}
        </>
      );
    }
  } else {
    const turn = view.players.find((p) => p.seat === view.turn);
    text = <span className="muted">{turn ? `Waiting for ${who(turn.playerId)}…` : "…"}</span>;
  }
  return (
    <div className={`fem-hint ${view.you.playable ? "your-turn" : ""} ${last && !view.dealOver ? "last" : ""}`} data-testid="fem-hint">
      {text}
    </div>
  );
}

const canBeat = (hand: Card[], led: string, best: Card) => hand.some((c) => c[1] === led && rankValue(c) > rankValue(best));

/** Bättre kort: ask on your lead, or answer someone who asked. */
function VoteBar({ view, who, me, busy, send, serverNow }: { view: FemView; who(id: string): string; me: string; busy: boolean; send(op: FemOp): void; serverNow: number }) {
  if (view.you.canVote && view.vote) {
    const secs = view.vote.deadline ? Math.max(0, Math.ceil((view.vote.deadline - serverNow) / 1000)) : null;
    return (
      <div className="fem-vote" data-testid="fem-vote">
        <span>
          <strong>{who(view.vote.by)}</strong> asks for better cards. Deal again?{secs !== null && <span className="muted"> ({secs}s)</span>}
        </span>
        <button className="btn primary small" disabled={busy} onClick={() => send({ type: "vote", yes: true })}>
          Yes, new cards
        </button>
        <button className="btn small" disabled={busy} onClick={() => send({ type: "vote", yes: false })}>
          No, play on
        </button>
      </div>
    );
  }
  if (view.vote && view.vote.by !== me && !view.you.canVote && view.vote.yes.includes(me)) return <div className="fem-vote muted">You said yes. Waiting for the others…</div>;
  if (!view.you.canAsk) return null;
  return (
    <div className="fem-vote">
      <button className="btn subtle small" disabled={busy} onClick={() => send({ type: "betterCards" })} data-testid="fem-ask">
        Ask for better cards
      </button>
      <span className="muted">If everyone agrees, the cards are dealt again. Once a deal.</span>
    </div>
  );
}

// --- the end --------------------------------------------------------------------

function Result({ view, me, name, start, disabled }: { view: FemView; me: string; name(id: string): string; start: (() => void) | null; disabled: boolean }) {
  const result = view.result;
  const winners = result?.winners ?? [];
  const ranking = [...view.players].sort((a, b) => Number(b.left === false) - Number(a.left === false) || b.deals - a.deals);
  const title = winners.includes(me) ? "You win!" : winners.length ? `${winners.map(name).join(" & ")} ${winners.length > 1 ? "win!" : "wins!"}` : "Game over";
  const winner = view.players.find((p) => p.playerId === winners[0]);
  const subtitle =
    result?.reason === "left"
      ? "Everyone else left the table."
      : result?.reason === "streak"
        ? `Two deals in a row, the last taken with the ${cardText(winner?.wonWith.at(-1) ?? "")}.`
        : `First to ${view.config.dealsToWin} ${view.config.dealsToWin === 1 ? "deal" : "deals"}${winner?.wonWith.length ? `, the last taken with the ${cardText(winner.wonWith.at(-1)!)}` : ""}.`;
  return (
    <GameOver
      open={view.phase === "over" && !!result}
      gameKey={view.game}
      me={me}
      testId="fem-result"
      title={title}
      subtitle={subtitle}
      columns={["Deals"]}
      rows={ranking.map((p) => ({
        playerId: p.playerId,
        name: name(p.playerId),
        winner: winners.includes(p.playerId),
        left: p.left,
        cells: [p.deals],
        detail: p.wonWith.length > 0 && (
          <span className="fem-won-with">
            Last tricks taken with{" "}
            {p.wonWith.map((c, i) => (
              <PlayingCard key={i} card={c} size="xs" />
            ))}
          </span>
        ),
      }))}
      actions={
        start && (
          <button className="btn primary" disabled={disabled} onClick={start}>
            Play again
          </button>
        )
      }
    />
  );
}

function Status({ view }: { view: FemView }) {
  const seat = view.you.seat;
  const s = seat === null ? null : view.seats[seat];
  if (view.seats.filter(Boolean).length < 2) return <span className="muted">Waiting for players to sit down…</span>;
  if (!s && view.phase === "playing") return <span className="muted">You're watching. Take an open seat to be dealt in.</span>;
  if (s && !view.you.inGame && view.phase === "playing") return <span className="muted">You're dealt in from the next deal.</span>;
  if (!s) return <span className="muted">Take an open seat to play.</span>;
  return null;
}

/** The big buttons: deal, play again, come back. */
function Controls({ view, connected, busy, send }: { view: FemView; connected: boolean; busy: boolean; send(op: FemOp): void }) {
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
function SeatActions({ view, connected, busy, send }: { view: FemView; connected: boolean; busy: boolean; send(op: FemOp): void }) {
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

function describe(e: FemEvent, who: (id: string) => string): string {
  switch (e.type) {
    case "trick":
      return `Deal ${e.deal}: ${who(e.winner)} took trick ${e.n} with the ${cardText(e.card)}.`;
    case "deal":
      return `Deal ${e.deal}: ${who(e.winner)} took the last trick with the ${cardText(e.card)} and won the deal!`;
    case "ask":
      return `Deal ${e.deal}: ${who(e.who)} asked for better cards.`;
    case "vote":
      return e.passed ? "Everyone agreed: new cards." : `${e.against.length ? e.against.map(who).join(" & ") : "Not everyone"} said no: play on.`;
    case "left":
      return `${who(e.who)} left the game${e.redeal ? ", so the cards were dealt again" : ""}.`;
  }
}

// --- motion ------------------------------------------------------------------

/** How long a taken trick stays on the table before it's gathered to its winner, after the last card lands. */
const HOLD_SECONDS = 0.9;

/**
 * Animates what changed since the last view, live only (a refresh shows the table as it
 * is): the deal (three cards, then two, from the middle of the table), each card played
 * (from the player's seat, or your hand, to the felt in front of them), a taken trick
 * held a moment and gathered to its winner, and the last trick: a gold banner as it
 * starts and the winner's star popping in.
 */
function useFemMotion(view: FemView, me: string, slot: (seat: number) => number) {
  const { flights, launch, land } = useFlights();
  const [arrivals, setArrivals] = useState<Map<Card, number>>(new Map());
  const [held, setHeld] = useState<Trick | null>(null);
  const [star, setStar] = useState<{ playerId: string; at: number } | null>(null);
  const [lastLive, setLastLive] = useState(false);
  const holding = useRef<{ trick: Trick; timer: ReturnType<typeof setTimeout> } | null>(null);
  /** Where your last card left from (measured on the click, as it's gone from your hand by the time the view comes). */
  const leaving = useRef<{ card: Card; rect: DOMRect } | null>(null);
  const before = useRef<{ game: number; deal: number; trick: number; tricks: number } | undefined>(undefined);
  /** Where a seat is on the table now (the table closes up around who's playing). */
  const slotOf = useRef(slot);
  slotOf.current = slot;
  const spot = (seat: number) => rectOf(`[data-bet-spot="${slotOf.current(seat)}"]`);
  const at = (seat: number, inner?: string) => seatRect(slotOf.current(seat), inner);

  /** Sweep the held trick to whoever took it. */
  const gather = (fly = true) => {
    const h = holding.current;
    if (!h) return;
    clearTimeout(h.timer);
    holding.current = null;
    const to = at(h.trick.winner);
    if (fly && !reducedMotion()) {
      launch(
        h.trick.plays.map((p, i) => {
          const from = rectOf(`[data-bet-spot="${slotOf.current(p.seat)}"] .fem-played`) ?? spot(p.seat);
          return from && to ? { node: <PlayingCard card={p.card} size="sm" />, from, to, delay: i * 0.05, duration: 0.45, scale: [1, 0.6] as [number, number], sound: "card" as const } : null;
        }),
      );
    }
    setHeld(null);
  };
  useEffect(() => () => clearTimeout(holding.current?.timer), []);

  useLayoutEffect(() => {
    const prev = before.current;
    before.current = { game: view.game, deal: view.deal, trick: view.trick.length, tricks: view.tricks.length };
    if (!prev || view.phase === "lobby") return;
    const motion = !reducedMotion();
    const active = view.players.filter((p) => !p.left).sort((a, b) => a.seat - b.seat);
    const arriving = new Map<Card, number>();
    const plans: (FlightPlan | null)[] = [];

    if (prev.game !== view.game || prev.deal !== view.deal) {
      gather(false);
      setStar(null);
      setLastLive(false);
      if (view.phase !== "playing" || !motion) return;
      // Three each, then two, from the dealer's left.
      const center = rectOf('[data-testid="fem-center"]');
      const order = [...active.filter((p) => p.seat > (view.dealer ?? -1)), ...active.filter((p) => p.seat <= (view.dealer ?? -1))];
      const myHand = active.find((p) => p.playerId === me)?.hand ?? [];
      // Your cards land in your hand in no particular order, as dealt cards do.
      const yours = [...myHand].sort((a, b) => hashCard(a) - hashCard(b));
      let t = 0;
      let given = 0;
      for (const packet of [3, 2]) {
        for (const p of order) {
          for (let j = 0; j < packet; j++) {
            const delay = t + j * 0.06;
            if (p.playerId === me) {
              const card = yours[given++];
              const to = card ? rectOf(`[data-testid="fem-me"] [data-card="${card}"]`) : null;
              plans.push(center && to ? { node: <CardBack size="sm" />, from: center, to, delay, duration: 0.42, scale: [0.7, 1.4], sound: "card" } : null);
              if (card && center && to) arriving.set(card, delay + 0.42);
            } else {
              const to = at(p.seat, ".card-fan") ?? at(p.seat);
              plans.push(center && to ? { node: <CardBack size="sm" />, from: center, to, delay, duration: 0.42, sound: "card" } : null);
            }
          }
          t += 0.1 + packet * 0.06;
        }
      }
      launch(plans);
      setArrivals(arriving);
      return;
    }

    const taken = view.tricks.length - prev.tricks;
    if (taken < 0 || taken > 1) return;
    const completed = taken === 1 ? view.tricks.at(-1)! : null;
    const fresh = completed ? [...completed.plays.slice(prev.trick), ...view.trick] : view.trick.slice(prev.trick);
    if (!fresh.length) return;
    // A new lead before the last trick was gathered: gather it now.
    if (holding.current) gather();
    let t = 0;
    for (const p of fresh) {
      const to = spot(p.seat);
      const mineLeft = p.playerId === me && leaving.current?.card === p.card ? leaving.current.rect : null;
      const from = p.playerId === me ? (mineLeft ?? rectOf('[data-testid="fem-me"] .fem-hand')) : (at(p.seat, ".card-fan") ?? at(p.seat));
      plans.push(motion && from && to ? { node: <PlayingCard card={p.card} size="md" />, from, to, delay: t, duration: FLIGHT_SECONDS, scale: [p.playerId === me ? 1.3 : 0.7, 1], sound: "card" } : null);
      if (motion && from && to) arriving.set(p.card, t + FLIGHT_SECONDS);
      t += 0.32;
    }
    const lands = motion ? t - 0.32 + FLIGHT_SECONDS : 0;
    if (completed && view.tricks.length < HAND_SIZE) {
      setHeld(completed);
      holding.current = { trick: completed, timer: setTimeout(() => gather(), (lands + HOLD_SECONDS) * 1000) };
      // The fourth trick taken: the last one starts.
      if (view.tricks.length === HAND_SIZE - 1) {
        setLastLive(true);
        play("check", lands + 0.2);
      }
    } else if (completed) {
      // The last trick: the deal is won.
      const win = completed.plays.find((p) => p.seat === completed.winner)!;
      setStar({ playerId: win.playerId, at: lands + 0.5 });
      play(win.playerId === me ? "good" : "flip", lands + 0.3);
    }
    launch(plans);
    setArrivals(arriving);
    // Only new cards matter; the rest of the view is read as it is now.
  }, [view.game, view.deal, view.trick.length, view.tricks.length]);

  return { flights, land, arrivals, held, star, lastLive, leaving };
}

/** A stable shuffle key for a card. */
const hashCard = (c: Card) => ((c.charCodeAt(0) * 31 + c.charCodeAt(1) * 17) % 53) / 53;
