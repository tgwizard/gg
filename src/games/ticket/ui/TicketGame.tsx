import { type ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Button, busyWhy, play, playerStyle, usePlayerColors } from "../../../ui";
import { Flights, useFlights, useOnChange } from "../../kit/ui/Flights";
import { GameOver } from "../../kit/ui/GameOver";
import { ActionTray, GameLog, Herald, TableFooter } from "../../kit/ui/GameParts";
import { PlayerPlate } from "../../kit/ui/PlayerPlate";
import { TurnTimer } from "../../kit/ui/TurnTimer";
import type { GameUIProps } from "../../ui";
import { AUTO_PLAY_DELAY_MS, type Hand, type TicketView, type TtrEvent, type TtrPlayerView, type TtrView } from "../engine";
import { routeOpen } from "../graph";
import { CARD_COLORS, type CardColor, cityName, ROUTE_POINTS, ROUTES, type Route, routeById, routeName, type Ticket, ticketById, TRAIN_COLORS } from "../map";
import type { TtrOp } from "../index";
import { TRACKS, VIEWBOX } from "./geometry";
import { TicketMap } from "./TicketMap";
import { cardName, DeckPile, TrainCard } from "./TrainCards";
import "./ticket.css";

type Props = GameUIProps<TtrView, TtrOp>;

interface Payment {
  color: CardColor;
  locos: number;
}

/** Every way to pay for a route from a hand: each usable color with any number of locomotives, or locomotives only. */
export function payments(hand: Hand, route: Route): Payment[] {
  const n = route.length;
  const colors = route.color === "gray" ? TRAIN_COLORS : [route.color];
  const out: Payment[] = [];
  for (const color of colors) {
    for (let locos = Math.max(0, n - hand[color]); locos < n && locos <= hand.loco; locos++) out.push({ color, locos });
  }
  if (hand.loco >= n) out.push({ color: "loco", locos: n });
  return out;
}

export function TicketGame({ view, me, members, connected, sendOp, serverNow }: Props) {
  const colorOf = usePlayerColors();
  const nameOf = (id: string) => (id === me ? "You" : (members.get(id)?.name ?? "Player"));
  const plainName = (id: string) => members.get(id)?.name ?? "Player";
  const [busy, setBusy] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const [keepSel, setKeepSel] = useState<number[]>([]);
  const [hovered, setHovered] = useState<Ticket | null>(null);
  const [hoveredPlayer, setHoveredPlayer] = useState<string | null>(null);
  const flights = useCardFlights(view.game, view.you.hand);

  const mine = view.players.find((p) => p.playerId === me && !p.left);
  const current = view.players.find((p) => p.seat === view.turn && !p.left);
  const myTurn = !!mine && current === mine && view.phase === "playing";
  const hand = view.you.hand;
  // No disabled buttons: one that can't be used this moment says why when pressed.
  const why = busyWhy({ busy, connected });
  const turnWhy = myTurn ? null : current ? `It's ${plainName(current.playerId)}'s turn.` : "It's not your turn.";

  const claimable = useMemo(() => {
    const out = new Set<string>();
    if (!myTurn || view.stage !== "start" || !hand || !mine) return out;
    for (const r of ROUTES) {
      if (mine.trains >= r.length && routeOpen(view.claims, r, me, view.bothTracks) && payments(hand, r).length) out.add(r.id);
    }
    return out;
  }, [myTurn, view.stage, view.claims, view.bothTracks, hand, mine, me]);
  const route = picked && claimable.has(picked) ? routeById.get(picked)! : null;

  const offered = view.you.offered;
  const keeping = offered ? keepSel.filter((id) => offered.some((t) => t.id === id)) : [];

  const send = async (op: TtrOp) => {
    setBusy(true);
    const ok = await sendOp(op);
    setBusy(false);
    if (ok) {
      setPicked(null);
      if (op.type === "keep") setKeepSel([]);
    }
    return ok;
  };

  const marked = useMemo(() => new Set(view.you.tickets.filter((t) => !t.done).flatMap((t) => [t.a, t.b])), [view.you.tickets]);
  const lastClaim = [...view.log].reverse().find((e) => e.type === "claim");
  useOnChange(lastClaim?.type === "claim" ? `${view.game}:${lastClaim.route}` : null, () => play("claim"));
  const inGame = view.phase !== "lobby";
  const lines = summarize(view.log);
  // Your own latest draw: the cards you drew blind are yours to see.
  const myLast = lines.findLast((l) => l.type === "cards" && l.who === me);
  const story = (line: Line): ReactNode =>
    line.type === "cards" ? (
      <CardsStory line={line} nameOf={nameOf} blind={line === myLast ? view.you.drawn : []} />
    ) : line.type === "claim" ? (
      <ClaimStory e={line} nameOf={nameOf} />
    ) : (
      describe(line, nameOf)
    );

  return (
    <div className="ttr">
      <div className="ttr-grid">
        <div className="ttr-board">
          <TicketMap
            claims={view.claims}
            bothTracks={view.bothTracks}
            colorOf={colorOf}
            nameOf={plainName}
            claimable={claimable}
            selected={route?.id ?? null}
            onSelect={(id) => setPicked(id === picked ? null : id)}
            marked={marked}
            focus={hovered ? [hovered.a, hovered.b] : undefined}
            recent={lastClaim?.type === "claim" ? lastClaim.route : null}
            owner={hoveredPlayer}
            picking={!!route}
          >
            {route && hand && (
              <ClaimPopover
                route={route}
                hand={hand}
                why={why}
                onPay={(p) => send({ type: "claim", route: route.id, color: p.color, locos: p.locos })}
                onCancel={() => setPicked(null)}
              />
            )}
          </TicketMap>
        </div>

        <Result view={view} me={me} name={plainName} start={view.canStart && view.you.seat !== null ? () => send({ type: "start" }) : null} why={why} />

        {/* Your side of the table: beside the map when there's room, under it otherwise. */}
        <div className="ttr-side">
          <Players view={view} me={me} members={members} connected={connected} busy={busy} send={send} serverNow={serverNow} onHover={setHoveredPlayer} />
          {inGame ? (
            <News view={view} lines={lines.slice(-2)} story={story} />
          ) : (
            <Herald testId="ttr-news">
              <span>{view.seats.filter(Boolean).length < 2 ? "Take a seat. Two to five can play." : "Start when everyone's seated."}</span>
            </Herald>
          )}

          <ActionTray aside={<Controls view={view} connected={connected} busy={busy} send={send} />} testId="ttr-tray">
            {offered ? (
              <TicketChoice
                offered={offered}
                keepAtLeast={view.you.keepAtLeast}
                selected={keeping}
                onToggle={(id) => setKeepSel(keeping.includes(id) ? keeping.filter((x) => x !== id) : [...keeping, id])}
                onHover={setHovered}
                deadline={view.phase === "choosing" ? view.setupDeadline : view.turnDeadline}
                totalMs={view.phase === "choosing" ? view.config.turnSeconds * 2000 : view.config.turnSeconds * 1000}
                serverNow={serverNow}
                why={why}
                onKeep={() => send({ type: "keep", tickets: keeping })}
              />
            ) : mine && hand && view.phase === "playing" ? (
              <div className="ttr-me">
                <Market view={view} turnWhy={turnWhy} why={why} send={send} onTake={flights.takeFrom} />
                {
                  <div className="ttr-hint" data-testid="ttr-hint">
                    {route
                      ? `Choose how to pay for ${routeName(route)}, on the map.`
                      : myTurn
                        ? view.stage === "second"
                          ? "Take one more card (not a face-up locomotive)."
                          : claimable.size
                            ? "Draw cards, take tickets, or click a highlighted route on the map to claim it."
                            : "Draw cards or take tickets."
                        : view.phase === "playing" && current
                          ? `${nameOf(current.playerId)} ${current.playerId === me ? "are" : "is"} playing…`
                          : null}
                  </div>
                }
                <HandView hand={hand} drawn={myTurn && view.stage !== "start" ? [] : view.you.drawn} />
              </div>
            ) : (
              <Status view={view} />
            )}
          </ActionTray>

          {view.you.tickets.length > 0 && view.phase !== "over" && <YourTickets tickets={view.you.tickets} onHover={setHovered} />}
        </div>

        <TableFooter
          log={
            view.log.length > 0 && (
              <GameLog title="What happened">
                {lines.map((line, i) => (
                  <li key={i} className="ttr-story">
                    {story(line)}
                  </li>
                ))}
              </GameLog>
            )
          }
          actions={<SeatActions view={view} connected={connected} busy={busy} send={send} />}
        />
      </div>
      <Flights flights={flights.flights} onLand={flights.land} />
    </div>
  );
}

/**
 * Cards you take fly from where they were (a face-up slot, or the deck) to your hand.
 * Watches your hand: whatever it gains (in the same game) is a card you took.
 */
function useCardFlights(game: number, hand: Hand | null) {
  const { flights, launch, land } = useFlights();
  const from = useRef<{ rect: DOMRect; at: number } | null>(null);
  const before = useRef<{ game: number; hand: Hand } | null>(null);

  useLayoutEffect(() => {
    const prev = before.current;
    before.current = hand ? { game, hand } : null;
    if (!hand || !prev || prev.game !== game) return;
    const gained = CARD_COLORS.flatMap((c) => Array<CardColor>(Math.max(0, hand[c] - prev.hand[c])).fill(c));
    // Only draws (one or two cards); a new deal or anything bigger isn't animated.
    if (!gained.length || gained.length > 2) return;
    const deck = document.querySelector('[data-testid="ttr-deck"]');
    const start = from.current && Date.now() - from.current.at < 5000 ? from.current.rect : deck?.getBoundingClientRect();
    from.current = null;
    if (!start) return;
    launch(
      gained.map((color, i) => {
        const to = document.querySelector(`[data-testid="ttr-hand"] [data-color="${color}"]`)?.getBoundingClientRect();
        return to ? { node: <TrainCard color={color} />, from: start, to, delay: i * 0.12, duration: 0.62, sound: "card" as const } : null;
      }),
    );
  }, [game, hand]);

  return {
    flights,
    takeFrom: (el: Element) => (from.current = { rect: el.getBoundingClientRect(), at: Date.now() }),
    land,
  };
}

// --- players ------------------------------------------------------------------

function Players({
  view,
  me,
  members,
  connected,
  busy,
  send,
  serverNow,
  onHover,
}: Pick<Props, "view" | "me" | "members" | "connected" | "serverNow"> & { busy: boolean; send(op: TtrOp): void; onHover(playerId: string | null): void }) {
  const inGame = view.phase !== "lobby";
  return (
    <div className="ttr-players">
      {view.seats.map((seat, i) => {
        const p = inGame ? view.players.find((x) => x.seat === i && !x.left) : undefined;
        if (p)
          return (
            // Hovering a player shows their railway on the map.
            <div key={i} className="ttr-plate-hover" onMouseEnter={() => onHover(p.playerId)} onMouseLeave={() => onHover(null)}>
              <InGamePlate
                p={p}
                view={view}
                me={me}
                name={members.get(p.playerId)?.name ?? "Player"}
                online={members.get(p.playerId)?.online ?? false}
                serverNow={serverNow}
              />
            </div>
          );
        if (seat) {
          return (
            <PlayerPlate
              key={i}
              playerId={seat.playerId}
              name={members.get(seat.playerId)?.name ?? "Player"}
              you={seat.playerId === me}
              online={members.get(seat.playerId)?.online ?? false}
              dim={seat.sittingOut}
              testId={`ttr-seat-${i}`}
            >
              <div className="plate-line status">
                {seat.gamesWon} {seat.gamesWon === 1 ? "win" : "wins"}
                {seat.sittingOut ? " · away" : view.phase === "playing" || view.phase === "choosing" ? " · next game" : ""}
              </div>
            </PlayerPlate>
          );
        }
        // Empty seats only matter when someone can sit down for a game.
        if (view.phase === "playing" || view.phase === "choosing") return null;
        return (
          <div key={i} className="seat-open ttr-seat-open" data-testid={`ttr-seat-${i}`}>
            {view.you.seat === null ? (
              <Button className="btn small" why={busyWhy({ busy, connected })} onClick={() => send({ type: "sit", seat: i })}>
                Sit here
              </Button>
            ) : (
              <span className="label">Open seat</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

function InGamePlate({
  p,
  view,
  me,
  name,
  online,
  serverNow,
}: {
  p: TtrPlayerView;
  view: TtrView;
  me: string;
  name: string;
  online: boolean;
  serverNow: number;
}) {
  const turn = view.turn === p.seat && view.phase === "playing";
  const seat = view.seats[p.seat];
  const away = seat?.playerId === p.playerId && seat.sittingOut;
  const won = view.phase === "over" && !!view.result?.winners.includes(p.playerId);
  const score = view.phase === "over" ? view.result?.scores.find((x) => x.playerId === p.playerId) : undefined;
  const color = usePlayerColors()(p.playerId);
  return (
    <PlayerPlate
      playerId={p.playerId}
      name={name}
      you={p.playerId === me}
      online={online}
      active={turn || (view.phase === "choosing" && p.choosing)}
      dim={away}
      winner={won}
      tags={away && <span className="tag">away</span>}
      testId={`ttr-seat-${p.seat}`}
      className="ttr-plate"
    >
      <div className="ttr-plate-line">
        <div className="ttr-stats">
          <span title="Trains left">
            <TrainSwatch color={color} />
            <span className="num">{p.trains}</span>
          </span>
          <span title="Train cards">
            <span className="ttr-mini-card" />
            <span className="num">{p.cards}</span>
          </span>
          <span title="Tickets">
            <span className="ttr-mini-ticket" />
            <span className="num">{p.tickets}</span>
          </span>
        </div>
        {/* At the end, the final score (tickets and the longest railway counted); before, points from routes. */}
        {score ? (
          <span className="ttr-points final" title="Final score">
            <span className="num">{score.total}</span> pts
          </span>
        ) : (
          <span className="ttr-points" title="Points from routes">
            <span className="num">{p.points}</span> pts
          </span>
        )}
      </div>
      {/* One line for whatever's going on, kept even when empty so every plate is the same size. */}
      <div className="ttr-plate-foot">
        {turn && view.turnDeadline !== null ? (
          <TurnTimer deadline={view.turnDeadline} totalMs={away ? AUTO_PLAY_DELAY_MS : view.config.turnSeconds * 1000} serverNow={serverNow} />
        ) : view.phase === "choosing" && p.choosing ? (
          <div className="plate-line status">choosing tickets</div>
        ) : view.finalTurns?.includes(p.playerId) ? (
          <div className="plate-line status good">last turn</div>
        ) : null}
      </div>
    </PlayerPlate>
  );
}

/** A little train car in the player's color. */
function TrainSwatch({ color }: { color: number }) {
  return <span className="ttr-swatch" style={playerStyle(color)} />;
}

// --- your turn ------------------------------------------------------------------

function Market({
  view,
  turnWhy,
  why,
  send,
  onTake,
}: {
  view: TtrView;
  /** Whose turn it is, when it isn't yours (null on your turn). */
  turnWhy: string | null;
  why: string | null;
  send(op: TtrOp): void;
  /** Where a card is being taken from, for its flight to your hand. */
  onTake(from: Element): void;
}) {
  const second = view.stage === "second";
  const deckLeft = view.deckCount + view.discardCount;
  const stageWhy = view.stage === "tickets" ? "Choose your tickets first." : null;
  const ticketsWhy = view.stage === "second" ? "Take your second card first." : stageWhy;
  return (
    <div className="ttr-market" data-testid="ttr-market">
      <div className="ttr-faceup">
        {view.faceUp.map((c, i) => (
          <Button
            key={i}
            className="ttr-take"
            why={!c ? "There's no card here." : (turnWhy ?? stageWhy ?? (second && c === "loco" ? "A face-up locomotive counts as two cards: take a different one." : why))}
            onClick={(e) => {
              onTake(e.currentTarget);
              send({ type: "draw", from: i });
            }}
            aria-label={c ? `Take the face-up ${cardName(c)}` : "Empty"}
            data-testid={`ttr-faceup-${i}`}
          >
            <TrainCard color={c} />
          </Button>
        ))}
      </div>
      <Button
        className="ttr-take"
        why={turnWhy ?? stageWhy ?? (deckLeft === 0 ? "The deck is empty." : why)}
        onClick={(e) => {
          onTake(e.currentTarget);
          send({ type: "draw", from: "deck" });
        }}
        data-testid="ttr-deck"
      >
        <DeckPile count={view.deckCount} label="Deck" />
      </Button>
      <Button
        className="ttr-take ttr-tickets-pile"
        why={turnWhy ?? ticketsWhy ?? (view.ticketCount === 0 ? "There are no tickets left." : why)}
        onClick={() => send({ type: "tickets" })}
        data-testid="ttr-draw-tickets"
      >
        <span className="ttr-ticket-back" />
        <span className="ttr-pile-label">
          Tickets<span className="num">{view.ticketCount}</span>
        </span>
      </Button>
    </div>
  );
}

function HandView({ hand, drawn }: { hand: Hand; drawn: CardColor[] }) {
  const held = CARD_COLORS.filter((c) => hand[c] > 0);
  return (
    <div className="ttr-hand" data-testid="ttr-hand">
      <span className="label">Your cards</span>
      <div className="ttr-hand-cards">
        {held.length ? held.map((c) => <TrainCard key={c} color={c} count={hand[c]} />) : <span className="muted">No cards.</span>}
      </div>
      {drawn.length > 0 && <span className="ttr-drawn muted">From the deck last turn: {drawn.map((c) => cardName(c)).join(", ")}</span>}
    </div>
  );
}

/**
 * Choosing how to pay for a route: a bubble on the map by the route, with the rest of
 * the board dimmed. Escape, Cancel or a click elsewhere on the map backs out.
 */
function ClaimPopover({ route, hand, why, onPay, onCancel }: { route: Route; hand: Hand; why: string | null; onPay(p: Payment): void; onCancel(): void }) {
  const options = payments(hand, route);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onCancel();
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [onCancel]);
  const { mid } = TRACKS.get(route.id)!;
  const x = ((mid.x - VIEWBOX.x) / VIEWBOX.w) * 100;
  const y = ((mid.y - VIEWBOX.y) / VIEWBOX.h) * 100;
  // Above the route, unless that's off the top; kept inside the board at the sides.
  const place = `${y < 45 ? "below" : "above"} ${x < 22 ? "start" : x > 78 ? "end" : "center"}`;
  const points = ROUTE_POINTS[route.length]!;
  return (
    <>
      <div className="ttr-claim-catch" onClick={onCancel} />
      <div
        className={`ttr-claim-pop box ${place}`}
        style={{ left: `${x}%`, top: `${y}%` }}
        role="dialog"
        aria-label={`Claim ${routeName(route)}`}
        data-testid="ttr-claim"
      >
        <div className="ttr-claim-head">
          <strong>{routeName(route)}</strong>
          <span className="muted">
            {route.length} {route.length === 1 ? "train" : "trains"}, {route.color === "gray" ? "any one color" : route.color} · {points}{" "}
            {points === 1 ? "point" : "points"}
          </span>
        </div>
        <span className="label ttr-pay-heading">Choose</span>
        <div className="ttr-pay">
          {options.map((p) => {
            const colored = route.length - p.locos;
            return (
              <Button key={`${p.color}-${p.locos}`} className="btn ttr-pay-btn" why={why} onClick={() => onPay(p)} data-testid="ttr-pay">
                <span className="ttr-pay-cards">
                  {p.color !== "loco" && <TrainCard color={p.color} count={colored} size="sm" />}
                  {p.locos > 0 && <TrainCard color="loco" count={p.locos} size="sm" />}
                </span>
              </Button>
            );
          })}
        </div>
        <button className="btn ghost small ttr-claim-cancel" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </>
  );
}

function TicketChoice(props: {
  offered: Ticket[];
  keepAtLeast: number;
  selected: number[];
  onToggle(id: number): void;
  onHover(t: Ticket | null): void;
  deadline: number | null;
  totalMs: number;
  serverNow: number;
  why: string | null;
  onKeep(): void;
}) {
  const n = props.selected.length;
  const short = props.keepAtLeast - n;
  const keepWhy = short > 0 ? (n === 0 ? `Pick at least ${props.keepAtLeast} ${props.keepAtLeast === 1 ? "ticket" : "tickets"} to keep first.` : `Pick ${short} more ${short === 1 ? "ticket" : "tickets"} to keep first.`) : null;
  return (
    <div className="ttr-choose" data-testid="ttr-choose">
      <div className="ttr-choose-head">
        <strong>Choose your tickets</strong>
        <span className="muted">Keep at least {props.keepAtLeast}. Completed tickets score their points; unfinished ones cost them.</span>
      </div>
      <div className="ttr-ticket-row">
        {props.offered.map((t) => (
          <button
            key={t.id}
            className="ttr-ticket-btn"
            aria-pressed={props.selected.includes(t.id)}
            onClick={() => props.onToggle(t.id)}
            onMouseEnter={() => props.onHover(t)}
            onMouseLeave={() => props.onHover(null)}
            onFocus={() => props.onHover(t)}
            onBlur={() => props.onHover(null)}
            data-testid="ttr-offer"
          >
            <TicketCard ticket={t} />
          </button>
        ))}
      </div>
      <div className="ttr-choose-foot">
        <Button className="btn primary" why={keepWhy ?? props.why} onClick={props.onKeep} data-testid="ttr-keep">
          {n === 0
            ? `Pick at least ${props.keepAtLeast}`
            : n < props.keepAtLeast
              ? `Pick ${props.keepAtLeast - n} more`
              : `Keep ${n} ${n === 1 ? "ticket" : "tickets"}`}
        </Button>
        <div className="ttr-choose-timer">
          <TurnTimer deadline={props.deadline} totalMs={props.totalMs} serverNow={props.serverNow} />
        </div>
      </div>
    </div>
  );
}

function TicketCard({ ticket, done }: { ticket: Ticket; done?: boolean }) {
  return (
    <span className={`ttr-ticket${done ? " done" : ""}`}>
      <span className="ttr-ticket-cities">
        {cityName(ticket.a)} – {cityName(ticket.b)}
      </span>
      <span className="ttr-ticket-points num">{ticket.points}</span>
      {done && (
        <span className="ttr-ticket-done" aria-label="completed">
          ✓
        </span>
      )}
    </span>
  );
}

function YourTickets({ tickets, onHover }: { tickets: TicketView[]; onHover(t: Ticket | null): void }) {
  const done = tickets.filter((t) => t.done).length;
  return (
    <div className="ttr-yours box" data-testid="ttr-tickets">
      <span className="label">
        Your tickets · {done} of {tickets.length} done
      </span>
      <div className="ttr-ticket-row">
        {tickets.map((t) => (
          <span key={t.id} onMouseEnter={() => onHover(t)} onMouseLeave={() => onHover(null)}>
            <TicketCard ticket={t} done={t.done} />
          </span>
        ))}
      </div>
    </div>
  );
}

// --- news, results, housekeeping ---------------------------------------------------

/** Log lines: a turn's card draws are one line. */
type Line = TtrEvent | { type: "cards"; who: string; cards: (CardColor | null)[] };

function summarize(log: TtrEvent[]): Line[] {
  const out: Line[] = [];
  for (const e of log) {
    const last = out.at(-1);
    if (e.type === "card" && last?.type === "cards" && last.who === e.who && last.cards.length === 1 && last.cards[0] !== "loco") last.cards.push(e.card);
    else out.push(e.type === "card" ? { type: "cards", who: e.who, cards: [e.card] } : e);
  }
  return out;
}

function describe(e: Line, nameOf: (id: string) => string): string {
  const who = (id: string) => nameOf(id);
  switch (e.type) {
    case "cards": {
      const blind = e.cards.filter((c) => c === null).length;
      const shown = e.cards.filter((c): c is CardColor => c !== null).map((c) => (c === "loco" ? "a locomotive" : `${c === "orange" ? "an" : "a"} ${c} card`));
      const parts = [...shown, ...(blind ? [blind === 1 ? "one from the deck" : `${blind} from the deck`] : [])];
      return `${who(e.who)} took ${parts.join(" and ")}.`;
    }
    case "card":
      return `${who(e.who)} took a card.`;
    case "claim": {
      const r = routeById.get(e.route)!;
      return `${who(e.who)} claimed ${routeName(r)} (${r.length} ${r.length === 1 ? "train" : "trains"}, ${ROUTE_POINTS[r.length]} points).`;
    }
    case "tickets":
      return `${who(e.who)} drew ${e.drew} tickets and kept ${e.kept}.`;
    case "reset":
      return "Three locomotives face up: all five cards were replaced.";
    case "lastRound":
      return `${who(e.who)} ${nameOf(e.who) === "You" ? "have" : "has"} 2 or fewer trains left: last round!`;
    case "pass":
      return `${who(e.who)} couldn't do anything and passed.`;
    case "left":
      return `${who(e.who)} left the game.`;
  }
}

/** The last two things that happened, with the cards in them. */
function News({ view, lines, story }: { view: TtrView; lines: Line[]; story(line: Line): ReactNode }) {
  return (
    <Herald testId="ttr-news" className="ttr-news">
      {view.phase === "choosing" ? (
        <span>Game {view.game}: everyone's choosing their tickets.</span>
      ) : lines.length ? (
        <>
          {lines.length > 1 && <span className="ttr-story muted">{story(lines[0]!)}</span>}
          <span className="ttr-story ttr-latest">{story(lines.at(-1)!)}</span>
        </>
      ) : (
        <span>Game {view.game} is on. Good luck!</span>
      )}
      {view.finalTurns && (
        <span className="ttr-last-round">
          Last round: {view.finalTurns.length} {view.finalTurns.length === 1 ? "turn" : "turns"} to go.
        </span>
      )}
    </Herald>
  );
}

/** "Bob took [red] [card back]": the cards drawn, face up ones in color, blind ones as backs (yours in color). */
function CardsStory({ line, nameOf, blind }: { line: Extract<Line, { type: "cards" }>; nameOf(id: string): string; blind: CardColor[] }) {
  const hidden = line.cards.filter((c) => c === null).length;
  // Only when they're this draw's cards (the count matches): a new turn starts with none drawn.
  const seen = blind.length === hidden ? blind : [];
  let k = 0;
  return (
    <>
      {nameOf(line.who)} took
      <span className="ttr-story-cards">
        {line.cards.map((c, i) => {
          const card = c ?? seen[k++] ?? null;
          return card ? <TrainCard key={i} color={card} size="xs" /> : <span key={i} className="ttr-card back xs" title="From the deck" />;
        })}
      </span>
      {hidden > 0 && (
        <span className="ttr-story-note">{hidden === line.cards.length ? (hidden === 1 ? "from the deck" : "both from the deck") : "one from the deck"}</span>
      )}
    </>
  );
}

/** "Ann claimed Seattle–Helena with [cards] · 15 points": the cards paid are shown, as at the table. */
function ClaimStory({ e, nameOf }: { e: Extract<Line, { type: "claim" }>; nameOf(id: string): string }) {
  const r = routeById.get(e.route)!;
  const cards: CardColor[] = [...Array<CardColor>(r.length - e.locos).fill(e.color), ...Array<CardColor>(e.locos).fill("loco")];
  return (
    <>
      {nameOf(e.who)} claimed {routeName(r)} with
      <span className="ttr-story-cards">
        {cards.map((c, i) => (
          <TrainCard key={i} color={c} size="xs" />
        ))}
      </span>
      <span className="ttr-story-note">
        {ROUTE_POINTS[r.length]} {ROUTE_POINTS[r.length] === 1 ? "point" : "points"}
      </span>
    </>
  );
}

/** The end: everyone's score (routes, tickets, the longest railway), over the map. */
function Result({ view, me, name, start, why }: { view: TtrView; me: string; name(id: string): string; start: (() => void) | null; why: string | null }) {
  const result = view.result;
  const ranked = result ? [...result.scores].sort((a, b) => b.total - a.total) : [];
  const winners = result?.winners ?? [];
  const longest = ranked.find((s) => s.bonus > 0);
  const title = winners.includes(me) ? (winners.length > 1 ? "You share the win!" : "You win!") : `${winners.map(name).join(" & ")} ${winners.length > 1 ? "share the win!" : "wins!"}`;
  return (
    <GameOver
      open={view.phase === "over" && !!result}
      gameKey={view.game}
      me={me}
      testId="ttr-result"
      className="ttr-result"
      title={title}
      subtitle={
        ranked[0] && (
          <>
            {ranked[0].total} points
            {longest && ` · longest railway: ${longest.playerId === me ? "you" : name(longest.playerId)} (${longest.longest} trains, +${longest.bonus})`}
          </>
        )
      }
      columns={["Routes", "Tickets", "Longest", "Total"]}
      rows={ranked.map((s) => ({
        playerId: s.playerId,
        name: name(s.playerId),
        winner: winners.includes(s.playerId),
        left: s.left,
        cells: [s.routePoints, s.ticketPoints > 0 ? `+${s.ticketPoints}` : s.ticketPoints, s.bonus ? `${s.longest} (+${s.bonus})` : s.longest, s.total],
        detail: s.tickets.length > 0 && (
          <span className="ttr-score-tickets">
            {s.tickets.map((t) => {
              const ticket = ticketById.get(t.id)!;
              return (
                <span key={t.id} className={t.done ? "done" : "missed"}>
                  {t.done ? "✓" : "✗"} {cityName(ticket.a)}–{cityName(ticket.b)} {t.done ? "+" : "−"}
                  {ticket.points}
                </span>
              );
            })}
          </span>
        ),
      }))}
      actions={
        start && (
          <Button className="btn primary" why={why} onClick={start}>
            Play again
          </Button>
        )
      }
    />
  );
}

function Status({ view }: { view: TtrView }) {
  const seat = view.you.seat;
  const s = seat === null ? null : view.seats[seat];
  const running = view.phase === "playing" || view.phase === "choosing";
  if (view.phase === "choosing" && view.you.inGame) return <span className="muted">Waiting for the others to choose their tickets…</span>;
  if (view.seats.filter(Boolean).length < 2) return <span className="muted">Waiting for players to sit down…</span>;
  if (!s && running) return <span className="muted">You're watching. Take an open seat to play the next game.</span>;
  if (s && !view.you.inGame && running) return <span className="muted">You're in the next game.</span>;
  if (!s) return <span className="muted">Take an open seat to play.</span>;
  return null;
}

/** The big buttons: start, play again, come back. */
function Controls({ view, connected, busy, send }: { view: TtrView; connected: boolean; busy: boolean; send(op: TtrOp): void }) {
  const seat = view.you.seat;
  const s = seat === null ? null : view.seats[seat];
  const why = busyWhy({ busy, connected });
  if (!s) return null;
  return (
    <>
      {view.canStart && view.phase !== "over" && (
        <Button className="btn primary" why={why} onClick={() => send({ type: "start" })} data-testid="ttr-start">
          {view.game === 0 ? "Start" : "Play again"}
        </Button>
      )}
      {s.sittingOut && (
        <Button className="btn" why={why} onClick={() => send({ type: "sitIn" })}>
          I'm back
        </Button>
      )}
    </>
  );
}

/** Quiet housekeeping under the map: step away, leave. */
function SeatActions({ view, connected, busy, send }: { view: TtrView; connected: boolean; busy: boolean; send(op: TtrOp): void }) {
  const seat = view.you.seat;
  const s = seat === null ? null : view.seats[seat];
  const why = busyWhy({ busy, connected });
  const running = view.phase === "playing" || view.phase === "choosing";
  if (!s) return null;
  return (
    <>
      {!s.sittingOut && running && view.you.inGame && (
        <Button className="btn ghost small" why={why} onClick={() => send({ type: "sitOut" })}>
          Step away
        </Button>
      )}
      <Button className="btn ghost small" why={why} onClick={() => send({ type: "leave" })}>
        {running && view.you.inGame ? "Leave game" : "Leave seat"}
      </Button>
    </>
  );
}
